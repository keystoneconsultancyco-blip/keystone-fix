'use strict';
// Change 3: upgrades to [Stock] Invoice Automation, added to the existing nodes (same names, same flow, same webhook replies).
//  1. Cash sales -> DRAFT, payment step switched off
//  2. Xero organisation from the client's registry row (not "first connection")
//  3. Milestone / multi-line invoices
//  4. Discounts from Airtable Discounts table (sheet still a fallback)
//  5. Exception agent on invalid data -> DRAFT if confident, else Needs Review + email
//  6. Every outcome logged to Airtable Agent Log
const n = require('../scripts/n8n');
const { H } = require('../scripts/stock');
const L = ['invoice', 'agent', 'registry', 'requests', 'log'];

module.exports = async function modify(w) {
  // ---------- 3. validation understands line items ----------
  H.node(w, 'Validate Job Data').parameters.jsCode = `const job = { ...$input.item.json };
const errors = [];
let lineItems = job.lineItems;
if (typeof lineItems === 'string' && lineItems.trim()) { try { lineItems = JSON.parse(lineItems); } catch (e) { errors.push('INVALID_LINE_ITEMS'); lineItems = null; } }
if (Array.isArray(lineItems)) {
  const bad = lineItems.some((l) => !l || !l.description || !(Number(l.amount) > 0));
  if (bad) errors.push('INVALID_LINE_ITEMS');
  const sum = Math.round(lineItems.reduce((s, l) => s + (Number(l && l.amount) || 0), 0) * 100) / 100;
  const v = Number(job.jobValue);
  if ((job.jobValue === undefined || job.jobValue === null || job.jobValue === '' || isNaN(v)) && sum > 0 && !bad) job.jobValue = sum;
  else if (!isNaN(v) && v > 0 && Math.abs(sum - v) > 0.01) errors.push('LINE_ITEMS_DONT_MATCH_VALUE');
  job.lineItems = lineItems;
}
if (!job.jobId) errors.push('MISSING_JOB_ID');
if (!job.customerId) errors.push('MISSING_CUSTOMER_ID');
if (!job.customerName) errors.push('MISSING_CUSTOMER_NAME');
const jobValueNum = Number(job.jobValue);
const jobValueInvalid = job.jobValue === undefined || job.jobValue === null || job.jobValue === '' || isNaN(jobValueNum) || jobValueNum <= 0;
if (jobValueInvalid) errors.push('INVALID_JOB_VALUE');
return [{ json: { ...job, jobValue: isNaN(jobValueNum) ? 0 : jobValueNum, hasCustomerEmail: !!job.customerEmail, isValid: errors.length === 0, validationErrors: errors } }];`;

  // ---------- 5. exception agent on the "not valid" branch ----------
  const bv = H.node(w, 'Build Validation Error Result').position;
  H.add(w, n.code('AI check job data', `
const { invoice: I, agent: A } = KS;
const j = $input.item.json;
const job = I.normalizeJob(j);
const issues = (j.validationErrors || []).map((c) => ({ code: c, severity: 'ambiguous', message: c.replace(/_/g, ' ').toLowerCase() }));
const client = { clientName: j.clientName || j.clientId || 'the business', industry: '', invoice: { invoiceLineAmountType: 'as configured' } };
const req = A.buildClaudeRequest({ system: I.EXCEPTION_AGENT_SYSTEM, prompt: I.exceptionAgentPrompt(job, issues, { recentInvoices: [], client }), schema: I.EXCEPTION_AGENT_SCHEMA, effort: 'medium', maxTokens: 6000 });
return { json: { ...j, req: { url: req.url, method: 'POST', body: req.body } } };`, { libs: L, mode: 'runOnceForEachItem' }), [bv[0] - 240, bv[1] + 220]);
  H.add(w, Object.assign(n.claudeHttp('Exception agent (Claude)'), { onError: 'continueRegularOutput' }), [bv[0], bv[1] + 220]);
  H.add(w, n.code('Read AI decision', `
const { invoice: I, agent: A, requests: R } = KS;
const j = $('AI check job data').item.json;
const job = I.normalizeJob(j);
const issues = (j.validationErrors || []).map((c) => ({ code: c, severity: 'ambiguous', message: c }));
// Can't invent a job reference: missing jobId always goes to review.
const parsed = R.ok($json) ? A.parseClaudeJson($json.body) : { ok: false, error: 'http_' + $json.statusCode };
let d = (j.validationErrors || []).includes('MISSING_JOB_ID') ? { action: 'review', reason: 'No job ID, so the invoice reference cannot be set.' } : I.applyAgentDecision(job, parsed, issues);
const base = { ...j, req: undefined };
if (d.action === 'draft') {
  const fixed = { ...base, customerName: d.job.customerName, customerEmail: d.job.customerEmail || j.customerEmail, jobValue: d.job.value, jobDescription: d.job.description,
    lineItems: d.job.lineItems, customerId: j.customerId || ('AUTO-' + String(d.job.customerEmail || d.job.customerName).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)),
    isValid: true, validationErrors: [], aiFixed: true, aiNote: d.note, aiReason: d.reason, aiConfidence: d.confidence, hasCustomerEmail: !!(d.job.customerEmail || j.customerEmail) };
  return { json: { aiOk: true, job: fixed } };
}
return { json: { aiOk: false, job: base, reason: d.reason || 'Agent unavailable', agent: parsed.ok ? parsed.data : null, agentError: parsed.ok ? null : parsed.error } };`, { libs: L, mode: 'runOnceForEachItem' }), [bv[0] + 240, bv[1] + 220]);
  H.add(w, n.iff('AI fixed it?', 'aiOk'), [bv[0] + 480, bv[1] + 220]);
  H.add(w, n.code('Use AI-fixed job', `return { json: $json.job };`, { mode: 'runOnceForEachItem' }), [bv[0] + 720, bv[1] + 120]);
  H.add(w, n.code('Prepare Needs Review', `
const { requests: R, log: Lg } = KS;
const j = $json.job;
const now = new Date().toISOString();
const problem = (j.validationErrors || []).join(', ');
const reasoning = ($json.agentError ? 'Agent unavailable: ' + $json.agentError + '. ' : '') + ($json.reason || '');
const reqs = [
  R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.needsReview, [{ 'Title': 'Invoice check: job ' + (j.jobId || '(no id)') + ' (' + (j.clientId || 'client?') + ')', 'Client ID': j.clientId || '', 'Service': 'invoicing', 'Status': 'Open', 'Source record': 'jobs sheet ' + (j.jobId || ''), 'Problem': problem, 'Agent reasoning': reasoning, 'Suggested fix JSON': $json.agent ? JSON.stringify($json.agent.corrected) : '', 'Confidence': $json.agent ? $json.agent.confidence : null, 'Created': now }]),
  R.email({ to: [Lg.OPS_EMAIL], subject: '[Keystone] Invoice needs review: ' + (j.clientId || '') + ' job ' + (j.jobId || '?'), text: 'Nothing was created in Xero.\\n\\nJob: ' + JSON.stringify({ jobId: j.jobId, customerName: j.customerName, customerEmail: j.customerEmail, jobValue: j.jobValue, jobDescription: j.jobDescription, lineItems: j.lineItems }, null, 1) + '\\n\\nProblems: ' + problem + '\\nAI reasoning: ' + reasoning + '\\n\\nDecide in Airtable > Needs Review, fix the row in the jobs sheet and set it back to Complete.' }),
];
return { json: { ...$json, reviewReqs: reqs } };`, { libs: L, mode: 'runOnceForEachItem' }), [bv[0] + 720, bv[1] + 320]);
  H.add(w, Object.assign(n.http('Save to Needs Review', 'airtable', { method: 'POST' }), { onError: 'continueRegularOutput', parameters: { ...n.http('x', 'airtable').parameters, url: '={{ $json.reviewReqs[0].url }}', jsonBody: '={{ JSON.stringify($json.reviewReqs[0].body) }}' } }), [bv[0] + 960, bv[1] + 320]);
  H.add(w, Object.assign(n.http('Email Bilal (review)', 'resend', { method: 'POST' }), { onError: 'continueRegularOutput', parameters: { ...n.http('x', 'resend').parameters, url: 'https://api.resend.com/emails', jsonBody: "={{ JSON.stringify($('Prepare Needs Review').item.json.reviewReqs[1].body) }}" } }), [bv[0] + 1200, bv[1] + 320]);
  H.add(w, n.code('Build Needs Review Result', `
const j = $('Prepare Needs Review').item.json.job;
return { json: { status: 'needs_review', reason: $('Prepare Needs Review').item.json.reason || 'Sent to Keystone Needs Review', jobId: j.jobId || null, errors: j.validationErrors } };`, { mode: 'runOnceForEachItem' }), [bv[0] + 1440, bv[1] + 320]);
  H.setOut(w, 'Is Valid?', 1, ['AI check job data']);
  H.setOut(w, 'AI check job data', 0, ['Exception agent (Claude)']);
  H.setOut(w, 'Exception agent (Claude)', 0, ['Read AI decision']);
  H.setOut(w, 'Read AI decision', 0, ['AI fixed it?']);
  H.setOut(w, 'AI fixed it?', 0, ['Use AI-fixed job']);
  H.setOut(w, 'AI fixed it?', 1, ['Prepare Needs Review']);
  H.setOut(w, 'Use AI-fixed job', 0, ['Get Client Config']);
  H.setOut(w, 'Prepare Needs Review', 0, ['Save to Needs Review']);
  H.setOut(w, 'Save to Needs Review', 0, ['Email Bilal (review)']);
  H.setOut(w, 'Email Bilal (review)', 0, ['Build Needs Review Result']);
  // "Build Validation Error Result" stays in the workflow but is no longer the end of the invalid branch.

  H.node(w, 'Merge Config + Job').parameters.jsCode = `const config = $input.item.json;
let job;
try { job = $('Use AI-fixed job').item.json; } catch (e) { job = null; }
if (!job) job = $('Validate Job Data').item.json;
return [{ json: { ...job, ...config, invoiceStatus: 'DRAFT' } }];`;

  // ---------- 4. discounts from Airtable (sheet as fallback) ----------
  const cd = H.node(w, 'Check Customer Discount').position;
  H.add(w, n.code('Prepare Airtable discount lookup', `
const d = $('Normalize Payment Method').item.json;
const formula = 'AND({Active}, {Client ID} = ' + KS.log.formulaString(d.clientId || '') + ')';
return { json: { sheet: $input.item.json, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.discounts, { formula, maxRecords: 100 }) } };`, { libs: L, mode: 'runOnceForEachItem' }), [cd[0] + 120, cd[1] + 200]);
  H.add(w, Object.assign(n.airtableHttp('Get Airtable discounts', 'GET'), { onError: 'continueRegularOutput' }), [cd[0] + 360, cd[1] + 200]);
  H.setOut(w, 'Check Customer Discount', 0, ['Prepare Airtable discount lookup']);
  H.setOut(w, 'Prepare Airtable discount lookup', 0, ['Get Airtable discounts']);
  H.setOut(w, 'Get Airtable discounts', 0, ['Match Customer Discount']);
  H.node(w, 'Match Customer Discount').parameters.jsCode = `const prior = $('Normalize Payment Method').item.json;
const resp = $('Prepare Airtable discount lookup').item.json.sheet || {};
const values = resp.values || [];
const headers = values[0] || [];
const rows = values.slice(1).map(row => { const obj = {}; headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; }); return obj; });
const today = new Date().toISOString().slice(0, 10);
const at = (($input.item.json.body || {}).records || []).map((r) => r.fields).filter((f) => {
  if ((f['Client ID'] || '') !== prior.clientId) return false;
  if (f['Valid until'] && f['Valid until'] < today) return false;
  const byId = f['Customer ID'] && String(f['Customer ID']).trim() === String(prior.customerId || '').trim();
  const byName = !f['Customer ID'] && f['Customer name'] && String(f['Customer name']).toLowerCase() === String(prior.customerName || '').toLowerCase() && (!f['Customer email'] || String(f['Customer email']).toLowerCase() === String(prior.customerEmail || '').toLowerCase());
  if (!byId && !byName) return false;
  if (f['Applies to'] && !String(prior.jobDescription || '').toLowerCase().includes(String(f['Applies to']).toLowerCase())) return false;
  return true;
}).map((f) => { const v = Number(f['Discount %']) || 0; return { pct: v <= 1 ? v * 100 : v, rule: f['Rule'] }; }).sort((a, b) => b.pct - a.pct)[0];
const match = rows.find(r => String(r.customerId || '').trim() === String(prior.customerId || '').trim());
let discountPercent, discountSource;
if (at) { discountPercent = at.pct; discountSource = 'airtable: ' + (at.rule || 'customer discount'); }
else if (match && match.discountPercent !== undefined && match.discountPercent !== '') { discountPercent = Number(match.discountPercent); discountSource = 'customer-override (sheet)'; }
else { discountPercent = Number(prior.discountPercent) || 0; discountSource = 'client-default'; }
return [{ json: { ...prior, discountPercent, discountSource } }];`;

  // ---------- 3. milestone / multi-line ----------
  H.node(w, 'Apply Branding, Discount, Payment Options').parameters.jsCode = `const d = $input.item.json;
const discountPercent = Number(d.discountPercent) || 0;
const f = 1 - discountPercent / 100;
const r2 = (x) => Math.round(x * 100) / 100;
const useMilestone = !!(d.milestoneInvoicingEnabled && d.milestoneNumber);
const invoiceReference = useMilestone ? \`\${d.jobId}-M\${d.milestoneNumber}\` : \`\${d.jobId}\`;
const items = Array.isArray(d.lineItems) ? d.lineItems.filter((l) => l && l.description && Number(l.amount) > 0) : [];
let xeroLineItems, lineAmount, lineDescription;
if (items.length > 1 && (d.milestoneInvoicingEnabled || d.aiFixed)) {
  xeroLineItems = items.map((l) => ({ Description: \`\${l.description} - \${d.clientName}\`, Quantity: 1, UnitAmount: r2(Number(l.amount) * f), AccountCode: d.xeroSalesAccountCode }));
  lineAmount = r2(xeroLineItems.reduce((s, l) => s + l.UnitAmount, 0));
  lineDescription = items.map((l) => l.description).join('; ');
} else {
  const rawValue = Number(d.jobValue) || 0;
  lineAmount = r2(rawValue * f);
  const milestoneLabelText = (useMilestone && d.milestoneLabel) ? \` (\${d.milestoneLabel})\` : '';
  lineDescription = \`\${d.jobDescription || 'Completed job'}\${milestoneLabelText} - \${d.clientName}\`;
  xeroLineItems = [{ Description: lineDescription, Quantity: 1, UnitAmount: lineAmount, AccountCode: d.xeroSalesAccountCode }];
}
return [{ json: { ...d, lineAmount, invoiceReference, lineDescription, xeroLineItems, invoiceStatus: 'DRAFT' } }];`;

  for (const name of ['Xero - Create Invoice', 'Xero - Create Invoice (Cash Sale)']) {
    const p = H.node(w, name).parameters;
    p.jsonBody = p.jsonBody.replace(/LineItems: \[\{[^\]]*\}\]/, 'LineItems: $json.xeroLineItems');
    if (!p.jsonBody.includes('$json.xeroLineItems')) throw new Error('could not rewrite LineItems in ' + name);
  }

  // ---------- 1. cash sales: DRAFT, no automatic payment ----------
  const cash = H.node(w, 'Xero - Create Invoice (Cash Sale)').parameters;
  cash.jsonBody = cash.jsonBody.replace("Status: 'AUTHORISED'", "Status: 'DRAFT'").replace('Reference: $json.invoiceReference', "Reference: $json.invoiceReference + ' | PAID CASH - approve and mark paid in Xero'");
  if (!cash.jsonBody.includes("Status: 'DRAFT'")) throw new Error('cash sale status not rewritten');
  H.node(w, 'Xero - Create Invoice').parameters.jsonBody = H.node(w, 'Xero - Create Invoice').parameters.jsonBody.replace('Status: $json.invoiceStatus', "Status: 'DRAFT'");
  H.setOut(w, 'Parse Cash Invoice Result', 0, ['Build Success Result (Cash Sale)']);
  for (const nm of ['Xero - Create Payment', 'Parse Payment Result']) { H.node(w, nm).disabled = true; H.setOut(w, nm, 0, []); }
  H.node(w, 'Build Success Result (Cash Sale)').parameters.jsCode = `const d = $input.item.json;
return [{ json: { status: 'success', jobId: d.jobId, paymentMethod: 'paid_cash', invoiceId: d.invoiceId, invoiceNumber: d.invoiceNumber, invoiceReference: d.invoiceReference,
  contactId: d.resolvedContactId, contactResolution: d.contactResolution, amount: d.lineAmount, paymentId: null, paymentRecorded: false,
  note: 'Paid cash: created as a DRAFT. Approve it in Xero and mark it as paid.', emailSent: false, emailSkippedReason: 'paid_cash_no_email', paymentMethodWarning: d.paymentMethodWarning || null } }];`;

  // ---------- 2. Xero organisation from the registry ----------
  H.node(w, 'Extract Tenant ID').parameters.jsCode = `const items = $input.all();
const first = items[0].json;
const list = (Array.isArray(first) ? first : items.map((i) => i.json)).filter((t) => t && t.tenantId);
const prior = $('Check Send-Time Window').item.json;
const wanted = prior.xeroTenantIdFromRegistry;
let tenantId = null;
if (wanted) {
  if (!list.some((t) => t.tenantId === wanted)) throw new Error('XERO: the Xero organisation for client ' + prior.clientId + ' (' + wanted + ') is not connected to the Xero account credential in n8n.');
  tenantId = wanted;
} else if (list.length === 1) tenantId = list[0].tenantId;
else throw new Error('XERO: client ' + prior.clientId + ' has no Xero organisation ID in My Clients and ' + list.length + ' organisations are connected, so Keystone will not guess.');
return [{ json: { ...prior, xeroTenantId: tenantId } }];`;

  // ---------- 6. Agent Log on every outcome (response passes through unchanged) ----------
  const s = H.node(w, 'Build Success Result (Email Sent)').position;
  H.add(w, n.code('Prepare Agent Log', `
const { log: Lg, requests: R } = KS;
const res = $input.item.json;
let job = {};
try { job = $('Job Data In').item.json; } catch (e) {}
let ai = {};
try { ai = $('Use AI-fixed job').item.json; } catch (e) {}
const clientId = job.clientId || ai.clientId || '';
const outcome = res.status === 'success' ? 'Draft created' : res.status === 'needs_review' ? 'Sent to review' : res.status === 'skipped' ? 'Skipped' : 'Failed';
const event = res.status === 'success' ? (ai.aiFixed ? 'invoice_agent_fixed' : 'invoice_draft_created') : 'invoice_' + res.status;
const rec = Lg.logRecord({ clientId, service: 'invoicing', event, outcome, decision: (res.invoiceNumber ? 'Xero DRAFT ' + res.invoiceNumber : res.status) + (res.paymentMethod === 'paid_cash' ? ' (paid cash, mark as paid)' : ''), reasoning: ai.aiFixed ? 'AI fixed: ' + (ai.aiReason || '') : (res.reason || (res.errors || []).join(', ') || 'Clean data: fixed core'), confidence: ai.aiConfidence, reference: res.jobId || job.jobId || '', workflow: '[Stock] Invoice Automation', executionId: $execution.id, details: res });
return { json: { result: res, req: R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [rec]) } };`, { libs: L, mode: 'runOnceForEachItem' }), [s[0] + 300, s[1] + 200]);
  H.add(w, Object.assign(n.airtableHttp('Write Agent Log', 'POST'), { onError: 'continueRegularOutput' }), [s[0] + 540, s[1] + 200]);
  H.add(w, n.code('Return result', `return { json: $('Prepare Agent Log').item.json.result };`, { mode: 'runOnceForEachItem' }), [s[0] + 780, s[1] + 200]);
  for (const t of ['Build Validation Error Result', 'Build Duplicate Skipped Result', 'Build Success Result (Cash Sale)', 'Build Success Result (Email Sent)', 'Build Success Result (Email Skipped)', 'Build Needs Review Result']) H.setOut(w, t, 0, ['Prepare Agent Log']);
  H.setOut(w, 'Prepare Agent Log', 0, ['Write Agent Log']);
  H.setOut(w, 'Write Agent Log', 0, ['Return result']);
};
