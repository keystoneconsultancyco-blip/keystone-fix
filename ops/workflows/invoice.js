'use strict';
// KS-01 Invoice Automation. One workflow serves every client.
// Production trigger: polls the Airtable Jobs table every 15 minutes for Status = Completed
// (and queued jobs whose send window has opened). The job-intake webhook lets clients on
// "Webhook" or "Tradify" job sources push completed jobs into the same table.
const n = require('../scripts/n8n');
const T = n.AIRTABLE.tables;
const L = ['registry', 'invoice', 'time', 'requests', 'log', 'agent', 'render'];

const nodes = [
  n.schedule('Every 15 minutes', '*/15 * * * *'),
  n.manual('Manual run'),
  n.code('Prepare job query', `
const R = KS.requests;
return [{ json: { req: R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.jobs, { formula: "OR({Status}='Completed',{Status}='Queued (out of window)')", maxRecords: 50 }) } }];`, { libs: L }),
  n.airtableHttp('Get jobs', 'GET'),
  n.code('Prepare client query', `
return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clients, { maxRecords: 100 }) } }];`, { libs: L }),
  n.airtableHttp('Get clients', 'GET'),
  n.code('Prepare discount query', `
return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.discounts, { formula: '{Active}', maxRecords: 100 }) } }];`, { libs: L }),
  n.airtableHttp('Get discounts', 'GET'),
  n.code('Prepare recent query', `
return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.jobs, { formula: "AND({Status}='Invoiced (draft)', IS_AFTER({Processed at}, DATEADD(NOW(), -30, 'days')))", maxRecords: 100 }) } }];`, { libs: L }),
  n.airtableHttp('Get recent invoices', 'GET'),

  // The gate + fixed-core assessment. Every job is scoped to exactly one client row.
  n.code('Assess jobs', `
const { registry: Rg, invoice: I, time: Tm, requests: R, log: Lg } = KS;
const body = (name) => { const r = $(name).first().json; if (!R.ok(r)) throw new Error(name + ' failed: ' + r.statusCode + ' ' + JSON.stringify(r.body).slice(0, 300)); return r.body.records || []; };
const jobs = body('Get jobs'), clientRows = body('Get clients'), discounts = body('Get discounts'), recentRows = body('Get recent invoices');
const now = ($now && $now.toJSDate) ? $now.toJSDate() : new Date();
const out = [];
for (const rec of jobs.slice(0, 20)) {
  const job = I.normalizeJob(rec);
  const { client, error } = Rg.resolveClient(clientRows, { clientId: job.clientId });
  const g = client ? Rg.gate(client, 'invoicing') : { ok: false, reason: error };
  if (!g.ok) { out.push({ json: { route: 4, job, client, reason: g.reason } }); continue; }
  const open = Tm.inSendWindow(now, client.invoice.sendWindowStart, client.invoice.sendWindowEnd, client.timezone);
  if (!open) {
    if (job.status !== 'Queued (out of window)') out.push({ json: { route: 3, job, client, nextOpen: Tm.nextWindowOpen(now, client.invoice.sendWindowStart, client.invoice.sendWindowEnd, client.timezone).toISOString() } });
    continue;
  }
  const recentInvoices = recentRows.map((r) => I.normalizeJob(r)).filter((j) => j.clientId === client.clientId && j.recordId !== job.recordId)
    .map((j) => ({ jobId: j.jobId, customerName: j.customerName, customerEmail: j.customerEmail, value: j.value, description: j.description }));
  const a = I.assessJob(job, { client, recentInvoices });
  const discount = I.findDiscount(job, discounts, client, now);
  const routeIdx = { core: 0, agent: 1, skip: 2 }[a.route];
  out.push({ json: { route: routeIdx, job, client, issues: a.issues, discount, recentInvoices, realXero: R.useRealXero(client) } });
}
return out;`, { libs: L }),
  n.route('Route job', 5),

  // ---- exception agent ----
  n.code('Build agent request', `
const { invoice: I, agent: A } = KS;
const req = A.buildClaudeRequest({ system: I.EXCEPTION_AGENT_SYSTEM, prompt: I.exceptionAgentPrompt($json.job, $json.issues, { recentInvoices: $json.recentInvoices, client: $json.client }), schema: I.EXCEPTION_AGENT_SCHEMA, effort: 'medium', maxTokens: 6000 });
return { json: { ...$json, req: { url: req.url, method: 'POST', body: req.body } } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.claudeHttp('Exception agent'),
  n.code('Apply agent decision', `
const { invoice: I, agent: A, requests: R } = KS;
const ctx = $('Build agent request').item.json;
const parsed = R.ok($json) ? A.parseClaudeJson($json.body) : { ok: false, error: 'http_' + $json.statusCode };
const d = I.applyAgentDecision(ctx.job, parsed, ctx.issues);
const base = { job: ctx.job, client: ctx.client, issues: ctx.issues, discount: ctx.discount, realXero: ctx.realXero, agent: parsed.ok ? parsed.data : null, agentError: parsed.ok ? null : parsed.error, reason: d.reason, confidence: d.confidence };
if (d.action === 'draft') return { json: { ...base, route: 0, job: d.job, forceMultiLine: d.forceMultiLine, note: d.note, viaAgent: true } };
if (d.action === 'skip') return { json: { ...base, route: 2, skipReason: 'Agent: likely duplicate. ' + d.reason } };
return { json: { ...base, route: 1 } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.route('Agent outcome', 3),

  // ---- Xero DRAFT path (fixed core) ----
  n.iff('Real Xero?', 'realXero'),
  n.code('Find contact request', `
const { requests: R } = KS;
const name = $json.job.customerName.replace(/"/g, '');
return { json: { ...$json, req: R.xero($json.client, 'GET', 'Contacts?where=' + encodeURIComponent('Name.StartsWith("' + name + '")')) } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.xeroHttp('Xero find contact', 'GET'),
  n.code('Choose contact', `
const { invoice: I, requests: R } = KS;
const ctx = $('Find contact request').item.json;
if (!R.ok($json)) return { json: { ...ctx, xeroError: { step: 'find contact', statusCode: $json.statusCode, body: $json.body }, req: R.xero(ctx.client, 'POST', 'Contacts', { Contacts: [] }) } };
const c = I.chooseContact(ctx.job, ($json.body && $json.body.Contacts) || []);
// Always POST: create, or a no-op update by ContactID, so the path stays linear and the response carries the ContactID.
const body = c.action === 'reuse' ? { Contacts: [{ ContactID: c.contactId }] } : { Contacts: [c.contact] };
return { json: { ...ctx, contactChoice: c, req: R.xero(ctx.client, 'POST', 'Contacts', body) } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.xeroHttp('Xero ensure contact', 'POST'),
  n.code('Build draft invoice', `
const { invoice: I, requests: R } = KS;
const ctx = $('Choose contact').item.json;
const contactId = R.ok($json) && $json.body.Contacts && $json.body.Contacts[0] && $json.body.Contacts[0].ContactID;
if (ctx.xeroError || !contactId) return { json: { ...ctx, xeroError: ctx.xeroError || { step: 'ensure contact', statusCode: $json.statusCode, body: $json.body }, req: R.xero(ctx.client, 'POST', 'Invoices', { Invoices: [] }) } }; // harmless no-op keeps the path linear
const lines = I.buildLineItems(ctx.job, ctx.client, ctx.discount, { forceMultiLine: ctx.forceMultiLine });
const payload = I.buildXeroDraftInvoice({ job: ctx.job, client: ctx.client, contactId, lineItems: lines, note: ctx.note });
I.assertDraft(payload);
return { json: { ...ctx, contactId, req: R.xero(ctx.client, 'POST', 'Invoices', payload) } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.xeroHttp('Xero create DRAFT invoice', 'POST'),
  n.code('Read Xero result', `
const { requests: R } = KS;
const ctx = $('Build draft invoice').item.json;
if (ctx.xeroError) return { json: { ...ctx, result: { ok: false, ...ctx.xeroError } } };
const inv = R.ok($json) && $json.body.Invoices && $json.body.Invoices[0];
if (!inv || inv.Status !== 'DRAFT') return { json: { ...ctx, result: { ok: false, step: 'create invoice', statusCode: $json.statusCode, body: $json.body } } };
return { json: { ...ctx, result: { ok: true, invoiceId: inv.InvoiceID, invoiceNumber: inv.InvoiceNumber, total: inv.Total, simulated: false } } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.code('Simulate Xero (demo)', `
const { invoice: I } = KS;
const lines = I.buildLineItems($json.job, $json.client, $json.discount, { forceMultiLine: $json.forceMultiLine });
const payload = I.buildXeroDraftInvoice({ job: $json.job, client: $json.client, contactId: 'DEMO-CONTACT', lineItems: lines, note: $json.note });
const net = lines.reduce((s, l) => s + l.UnitAmount * (1 - (l.DiscountRate || 0) / 100), 0);
const total = Math.round((payload.Invoices[0].LineAmountTypes === 'Exclusive' ? net * (1 + $json.client.invoice.vatRatePct / 100) : net) * 100) / 100;
return { json: { ...$json, payload, result: { ok: true, invoiceId: 'DEMO-' + $json.job.jobId, invoiceNumber: 'DEMO-DRAFT-' + $json.job.jobId, total, simulated: true } } };`, { libs: L, mode: 'runOnceForEachItem' }),

  // ---- outcomes -> writes ----
  n.code('Draft outcome writes', `
const { requests: R, log: Lg, render: Rn, registry: Rg } = KS;
const out = [];
for (const it of $input.all()) {
  const x = it.json, j = x.job, c = x.client, now = new Date().toISOString();
  const W = [];
  if (x.result.ok) {
    W.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.jobs, [{ id: j.recordId, fields: { 'Status': 'Invoiced (draft)', 'Xero invoice ID': x.result.invoiceId, 'Invoice number': x.result.invoiceNumber, 'Processed at': now, 'Agent note': x.note || '', 'Error message': '' } }])));
    W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [Lg.logRecord({ clientId: c.clientId, service: 'invoicing', event: x.viaAgent ? 'invoice_agent_fixed' : 'invoice_draft_created', outcome: 'Draft created', decision: 'Xero DRAFT ' + x.result.invoiceNumber + (x.result.simulated ? ' (demo, simulated)' : ''), reasoning: x.viaAgent ? x.reason : 'Clean data: fixed core', confidence: x.confidence, reference: j.jobId, workflow: 'KS-01 Invoice Automation', executionId: $execution.id, details: { issues: x.issues, discount: x.discount, total: x.result.total } })])));
    const to = Rg.safeRecipients(c, [c.businessEmail]);
    if (to.length) W.push(R.write.email(R.email({ to, subject: 'Draft invoice ready: ' + j.customerName + ' (' + j.jobId + ')', html: Rn.invoiceDraftEmail(c, { job: j, invoiceNumber: x.result.invoiceNumber, total: x.result.total, note: x.note }) })));
  } else {
    // Fail safe: the job is never lost. A transient error gets one automatic retry on the next poll; anything else goes to review.
    const transient = [0, 408, 429, 500, 502, 503, 504].includes(Number(x.result.statusCode));
    const retried = /\\[retry 1\\]/.test(j.errorMessage || '');
    const msg = 'Xero ' + x.result.step + ' failed (' + x.result.statusCode + '): ' + JSON.stringify(x.result.body || '').slice(0, 400);
    if (transient && !retried) {
      W.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.jobs, [{ id: j.recordId, fields: { 'Status': 'Completed', 'Error message': '[retry 1] ' + msg } }])));
      W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [Lg.logRecord({ clientId: c.clientId, service: 'invoicing', event: 'invoice_retry_scheduled', outcome: 'Auto-fixed', decision: 'Approved fix transient-api-error: retry on next poll', reasoning: msg, reference: j.jobId, workflow: 'KS-01 Invoice Automation', executionId: $execution.id })])));
    } else {
      W.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.jobs, [{ id: j.recordId, fields: { 'Status': 'Needs review', 'Error message': msg } }])));
      W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.needsReview, [{ 'Title': 'Xero error on ' + j.jobId + ' (' + c.clientName + ')', 'Client ID': c.clientId, 'Service': 'invoicing', 'Status': 'Open', 'Source record': j.recordId, 'Problem': msg, 'Agent reasoning': 'Not auto-fixable (or already retried once).', 'Created': now }])));
      W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [Lg.logRecord({ clientId: c.clientId, service: 'invoicing', event: 'invoice_failed', outcome: 'Escalated', decision: 'Sent to Needs Review', reasoning: msg, reference: j.jobId, workflow: 'KS-01 Invoice Automation', executionId: $execution.id })])));
      W.push(R.write.email(R.email({ to: [Lg.OPS_EMAIL], subject: '[Keystone] Invoice needs you: ' + c.clientId + ' ' + j.jobId, text: msg + '\\n\\nOpen Airtable > Needs Review.' })));
    }
  }
  out.push({ json: { writes: W } });
}
return out;`, { libs: L }),

  n.code('Review writes', `
const { requests: R, log: Lg } = KS;
return $input.all().map((it) => {
  const x = it.json, j = x.job, c = x.client, now = new Date().toISOString();
  const problem = (x.issues || []).map((i) => i.code + ': ' + i.message).join('\\n');
  const reasoning = (x.agentError ? 'Agent unavailable: ' + x.agentError + '. ' : '') + (x.reason || '');
  return { json: { writes: [
    R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.jobs, [{ id: j.recordId, fields: { 'Status': 'Needs review', 'Agent note': reasoning.slice(0, 2000) } }])),
    R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.needsReview, [{ 'Title': 'Invoice check: ' + j.jobId + ' (' + c.clientName + ')', 'Client ID': c.clientId, 'Service': 'invoicing', 'Status': 'Open', 'Source record': j.recordId, 'Problem': problem, 'Agent reasoning': reasoning, 'Suggested fix JSON': x.agent ? JSON.stringify(x.agent.corrected) : '', 'Confidence': x.agent ? x.agent.confidence : null, 'Created': now }])),
    R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [Lg.logRecord({ clientId: c.clientId, service: 'invoicing', event: 'invoice_sent_to_review', outcome: 'Sent to review', decision: 'Needs Review queue', reasoning, confidence: x.agent ? x.agent.confidence : null, reference: j.jobId, workflow: 'KS-01 Invoice Automation', executionId: $execution.id, details: { issues: x.issues } })])),
    R.write.email(R.email({ to: [Lg.OPS_EMAIL], subject: '[Keystone] Invoice needs review: ' + c.clientId + ' ' + j.jobId, text: 'Client: ' + c.clientName + '\\nJob: ' + j.jobId + '\\n\\nProblems:\\n' + problem + '\\n\\nAgent reasoning:\\n' + reasoning + '\\n\\nDecide in Airtable > Needs Review. Nothing has been created in Xero.' })),
  ] } };
});`, { libs: L }),

  n.code('Skip / queue writes', `
const { requests: R, log: Lg } = KS;
return $input.all().map((it) => {
  const x = it.json, j = x.job, c = x.client || { clientId: j.clientId };
  let fields, log;
  if (x.route === 3) {
    fields = { 'Status': 'Queued (out of window)', 'Error message': 'OUT_OF_WINDOW: next send window opens ' + x.nextOpen };
    log = Lg.logRecord({ clientId: c.clientId, service: 'invoicing', event: 'invoice_queued', outcome: 'Success', decision: 'Queued until ' + x.nextOpen, reasoning: 'Outside client send window', reference: j.jobId, workflow: 'KS-01 Invoice Automation', executionId: $execution.id });
  } else {
    const why = x.skipReason || x.reason || (x.issues || []).filter((i) => i.severity === 'skip').map((i) => i.message).join('; ');
    fields = { 'Status': 'Skipped', 'Error message': String(why).slice(0, 1000) };
    log = Lg.logRecord({ clientId: c.clientId, service: 'invoicing', event: 'invoice_skipped', outcome: 'Skipped', decision: 'No invoice created', reasoning: why, reference: j.jobId, workflow: 'KS-01 Invoice Automation', executionId: $execution.id });
  }
  return { json: { writes: [
    R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.jobs, [{ id: j.recordId, fields }])),
    R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [log])),
  ] } };
});`, { libs: L }),

  // ---- job intake webhook (Webhook / Tradify job sources) ----
  n.webhook('Job intake webhook', 'ks-job-completed'),
  n.code('Validate intake', `
const { registry: Rg, requests: R } = KS;
const b = $json.body || $json;
const required = ['clientId', 'jobId'];
const missing = required.filter((k) => !b[k]);
if (missing.length) return [{ json: { response: { ok: false, error: 'missing ' + missing.join(',') }, req: null, valid: false } }];
return [{ json: { valid: true, intake: b, req: R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clients, { formula: '{Client ID} = ' + KS.log.formulaString(b.clientId), maxRecords: 2 }) } }];`, { libs: L }),
  n.iff('Intake valid?', 'valid'),
  n.airtableHttp('Intake client lookup', 'GET'),
  n.code('Intake gate', `
const { registry: Rg, requests: R } = KS;
const b = $('Validate intake').first().json.intake;
const { client, error } = Rg.resolveClient(($json.body && $json.body.records) || [], { clientId: b.clientId });
const g = client ? Rg.gate(client, 'invoicing') : { ok: false, reason: error };
if (!g.ok) return [{ json: { ok: false, response: { ok: false, error: g.reason } } }];
// Shared-secret check: the sender must present the client's dashboard token (per-client secret).
if (!client.dashboardToken || b.token !== client.dashboardToken) return [{ json: { ok: false, response: { ok: false, error: 'bad_token' } } }];
const fields = { 'Job ID': String(b.jobId), 'Client ID': client.clientId, 'Status': 'Completed', 'Customer ID': b.customerId, 'Customer name': b.customerName, 'Customer email': b.customerEmail, 'Customer phone': b.customerPhone, 'Job description': b.jobDescription, 'Job value': b.jobValue === undefined ? undefined : Number(b.jobValue), 'Line items': b.lineItems ? JSON.stringify(b.lineItems) : undefined, 'Payment method': b.paymentMethod, 'Completed at': b.completedAt || new Date().toISOString() };
return [{ json: { ok: true, req: R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.jobs, [fields]), response: { ok: true, queued: true, jobId: b.jobId } } }];`, { libs: L }),
  n.iff('Intake allowed?', 'ok'),
  n.airtableHttp('Create job row', 'POST'),
  n.code('Intake response', `return [{ json: { response: $('Intake gate').first().json.response } }];`),
  n.respond('Respond intake'),
  n.respond('Respond intake rejected'),
];

const tail = n.writesTail();
nodes.push(...tail.nodes);

const edges = [
  ['Every 15 minutes', 'Prepare job query'], ['Manual run', 'Prepare job query'],
  ['Prepare job query', 'Get jobs'], ['Get jobs', 'Prepare client query'], ['Prepare client query', 'Get clients'],
  ['Get clients', 'Prepare discount query'], ['Prepare discount query', 'Get discounts'], ['Get discounts', 'Prepare recent query'],
  ['Prepare recent query', 'Get recent invoices'], ['Get recent invoices', 'Assess jobs'], ['Assess jobs', 'Route job'],
  ['Route job', 'Real Xero?', 0], ['Route job', 'Build agent request', 1], ['Route job', 'Skip / queue writes', 2], ['Route job', 'Skip / queue writes', 3], ['Route job', 'Skip / queue writes', 4],
  ['Build agent request', 'Exception agent'], ['Exception agent', 'Apply agent decision'], ['Apply agent decision', 'Agent outcome'],
  ['Agent outcome', 'Real Xero?', 0], ['Agent outcome', 'Review writes', 1], ['Agent outcome', 'Skip / queue writes', 2],
  ['Real Xero?', 'Find contact request', 0], ['Real Xero?', 'Simulate Xero (demo)', 1],
  ['Find contact request', 'Xero find contact'], ['Xero find contact', 'Choose contact'], ['Choose contact', 'Xero ensure contact'],
  ['Xero ensure contact', 'Build draft invoice'], ['Build draft invoice', 'Xero create DRAFT invoice'], ['Xero create DRAFT invoice', 'Read Xero result'],
  ['Read Xero result', 'Draft outcome writes'], ['Simulate Xero (demo)', 'Draft outcome writes'],
  ['Draft outcome writes', 'Fan out writes'], ['Review writes', 'Fan out writes'], ['Skip / queue writes', 'Fan out writes'],
  ...tail.edges,
  ['Job intake webhook', 'Validate intake'], ['Validate intake', 'Intake valid?'], ['Intake valid?', 'Intake client lookup', 0], ['Intake valid?', 'Respond intake rejected', 1],
  ['Intake client lookup', 'Intake gate'], ['Intake gate', 'Intake allowed?'], ['Intake allowed?', 'Create job row', 0], ['Intake allowed?', 'Respond intake rejected', 1],
  ['Create job row', 'Intake response'], ['Intake response', 'Respond intake'],
];

module.exports = n.workflow('KS-01 Invoice Automation', nodes, edges, { tags: ['keystone', 'invoicing'] });
