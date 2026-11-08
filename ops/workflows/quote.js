'use strict';
// KS Quote Calculator. One workflow, every client, three entry points:
//   GET  /webhook/ks-quote-form?c=CLIENT_ID          customer quote form (branded)
//   GET  /webhook/ks-quote-form?c=CLIENT_ID&m=1&t=…  manual quote form (Bilal / client; token = client's Dashboard token)
//   POST /webhook/ks-quote                           JSON API: form, phone agent (get_quote) and manual
//   GET  /webhook/ks-quote-approve?ref=…&t=…         business approves a draft and it is emailed to the customer
// Prices come from Airtable Quote Services + Quote Factors + the client's VAT settings.
const n = require('../scripts/n8n');
const L = ['registry', 'quotecalc', 'quotehtml', 'requests', 'log', 'agent', 'onboarding'];
const BASE = 'https://keystoneconsultancy.app.n8n.cloud/webhook';

const listBody = (name) => `(($('${name}').first().json.body || {}).records || [])`;

const nodes = [
  // ---------- A. Form ----------
  n.webhook('Quote form page', 'ks-quote-form', { method: 'GET' }),
  n.code('Form: client query', `
const q = $json.query || {};
return [{ json: { q, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clients, { formula: '{Client ID} = ' + KS.log.formulaString(q.c || ''), maxRecords: 2 }) } }];`, { libs: L }),
  n.airtableHttp('Form: get client', 'GET'),
  n.code('Form: services query', `
const q = $('Form: client query').first().json.q;
return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.quoteServices, { formula: 'AND({Active}, {Client ID} = ' + KS.log.formulaString(q.c || '') + ')' }) } }];`, { libs: L }),
  n.airtableHttp('Form: get services', 'GET'),
  n.code('Form: factors query', `
const q = $('Form: client query').first().json.q;
return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.quoteFactors, { formula: 'AND({Active}, {Client ID} = ' + KS.log.formulaString(q.c || '') + ')' }) } }];`, { libs: L }),
  n.airtableHttp('Form: get factors', 'GET'),
  n.code('Form: render', `
const { registry: Rg, quotecalc: Qc, quotehtml: H } = KS;
const q = $('Form: client query').first().json.q;
const { client } = Rg.resolveClient(${listBody('Form: get client')}, { clientId: q.c });
const g = client ? Rg.gate(client, 'quotes') : { ok: false };
if (!g.ok) return [{ json: { statusCode: 404, html: H.messagePage(client, 'Quotes unavailable', 'Online quotes are not available right now. Please call us.') } }];
const manual = q.m === '1';
if (manual && (!client.dashboardToken || q.t !== client.dashboardToken)) return [{ json: { statusCode: 403, html: H.messagePage(client, 'Link not valid', 'This manual-quote link is not valid.') } }];
const services = Qc.loadServices(${listBody('Form: get services')}, client.clientId);
const factors = Qc.loadFactors(${listBody('Form: get factors')}, client.clientId);
return [{ json: { statusCode: 200, html: H.quoteFormPage(client, services, factors, { postUrl: '${BASE}/ks-quote', manual, token: manual ? q.t : '' }) } }];`, { libs: L }),
  n.respond('Form: respond', 'html'),

  // ---------- B. Quote API ----------
  n.webhook('Quote request', 'ks-quote'),
  n.code('Quote: client query', `
let b = $json.body || {};
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
return [{ json: { b, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clients, { formula: '{Client ID} = ' + KS.log.formulaString(b.clientId || ''), maxRecords: 2 }) } }];`, { libs: L }),
  n.airtableHttp('Quote: get client', 'GET'),
  n.code('Quote: check client', `
const { registry: Rg, requests: R } = KS;
const b = $('Quote: client query').first().json.b;
const { client, error } = Rg.resolveClient(${listBody('Quote: get client')}, { clientId: b.clientId });
const g = client ? Rg.gate(client, 'quotes') : { ok: false, reason: error || 'client_not_found' };
const source = ['phone', 'web', 'manual'].includes(b.source) ? b.source : 'web';
let problem = null;
if (!g.ok) problem = 'Quotes are not available for this business right now (' + g.reason + ').';
else if (source === 'manual' && (!client.dashboardToken || b.token !== client.dashboardToken)) problem = 'Manual quotes need a valid token.';
else if (!b.service && !b.description) problem = 'Please tell us what the job is.';
if (problem) return [{ json: { ok: false, response: { ok: false, message: problem } } }];
return [{ json: { ok: true, client, source, b, req: R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.quoteServices, { formula: 'AND({Active}, {Client ID} = ' + KS.log.formulaString(client.clientId) + ')' }) } }];`, { libs: L }),
  n.iff('Quote: allowed?', 'ok'),
  n.airtableHttp('Quote: get services', 'GET'),
  n.code('Quote: factors query', `
const c = $('Quote: check client').first().json.client;
return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.quoteFactors, { formula: 'AND({Active}, {Client ID} = ' + KS.log.formulaString(c.clientId) + ')' }) } }];`, { libs: L }),
  n.airtableHttp('Quote: get factors', 'GET'),
  n.code('Quote: calculate', `
const { quotecalc: Qc } = KS;
const { client, source, b } = $('Quote: check client').first().json;
const services = Qc.loadServices(${listBody('Quote: get services')}, client.clientId);
const factors = Qc.loadFactors(${listBody('Quote: get factors')}, client.clientId);
const input = { service: b.service || '', description: b.description || '', quantity: b.quantity, answers: b.answers || {}, discountPct: Number(b.discountPct) || 0, source };
const quote = Qc.calculate({ services, factors, client, input });
// Phone callers get an instant answer, so no AI during a live call; unmatched phone jobs go to the business.
const route = !quote.matched && source !== 'phone' ? 1 : 0;
return [{ json: { route, client, source, b, input, quote, services, factors, pricedBy: 'rules' } }];`, { libs: L }),
  n.route('Quote: priced by rules?', 2),
  n.code('Quote: AI request', `
const { quotecalc: Qc, agent: A } = KS;
const req = A.buildClaudeRequest({ system: Qc.AI_QUOTE_SYSTEM, prompt: Qc.aiQuotePrompt({ client: $json.client, services: $json.services, factors: $json.factors, input: $json.input }), schema: Qc.AI_QUOTE_SCHEMA, effort: 'medium', maxTokens: 4000 });
return { json: { ...$json, req: { url: req.url, method: 'POST', body: req.body } } };`, { libs: L, mode: 'runOnceForEachItem' }),
  Object.assign(n.claudeHttp('Quote: AI estimate'), { onError: 'continueRegularOutput' }),
  n.code('Quote: read AI', `
const { quotecalc: Qc, agent: A, requests: R } = KS;
const ctx = $('Quote: AI request').item.json;
const parsed = R.ok($json) ? A.parseClaudeJson($json.body) : { ok: false, error: 'http_' + $json.statusCode };
let quote;
if (parsed.ok && parsed.data.lines.length && parsed.data.lines.every((l) => l.amount > 0)) {
  quote = { matched: true, service: ctx.input.service || 'Custom job', lines: parsed.data.lines, ...Qc.totalsFromLines(parsed.data.lines, ctx.client), pricesIncludeVat: false, missing: [], followUps: parsed.data.questions || [], notes: [], agentNotes: parsed.data.reasoning, confidence: parsed.data.confidence };
} else {
  quote = { matched: false, lines: [], subtotal: 0, vat: 0, total: 0, missing: (parsed.ok && parsed.data.questions) || [], followUps: [], notes: [], agentNotes: parsed.ok ? parsed.data.reasoning : 'AI estimate unavailable (' + parsed.error + '). Price this one by hand.' };
}
return { json: { ...ctx, req: undefined, quote, pricedBy: 'agent' } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.code('Quote: finalize', `
const { quotecalc: Qc, quotehtml: H, requests: R, log: Lg, registry: Rg, onboarding: O } = KS;
return $input.all().map((it) => {
  const { client, source, b, input, quote, pricedBy } = it.json;
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const ref = 'Q-' + client.clientId.replace(/^KS-/, '') + '-' + stamp + '-' + Math.floor(100 + Math.random() * 900);
  const cust = b.customer || {};
  const questions = [...(quote.missing || []), ...(pricedBy === 'agent' ? (quote.followUps || []) : [])];
  const valid = new Date(now.getTime() + (client.quotes.validDays || 30) * 86400000).toISOString().slice(0, 10);
  const q = { ...quote, ref, source, pricedBy, questions, description: input.description || input.service, customerName: cust.name || '', customerEmail: (cust.email || '').trim(), customerPhone: cust.phone || '', validUntil: valid };
  const priced = quote.matched && !(quote.missing || []).length && q.total > 0;
  const sendNow = source === 'manual' && priced && q.customerEmail;
  const status = sendNow ? 'Sent to customer' : priced ? 'Draft - awaiting client approval' : 'Needs more info';
  const token = O.randomToken(28);
  const approveUrl = '${BASE}/ks-quote-approve?ref=' + encodeURIComponent(ref) + '&t=' + token;
  const W = [];
  W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.quotes, [{
    'Quote ref': ref, 'Client ID': client.clientId, 'Source': source, 'Status': status, 'Customer name': q.customerName, 'Customer email': q.customerEmail || undefined, 'Customer phone': q.customerPhone,
    'Job description': q.description, 'Inputs JSON': JSON.stringify({ input, quote: q }).slice(0, 90000), 'Line items JSON': JSON.stringify(q.lines), 'Subtotal': q.subtotal, 'VAT': q.vat, 'Total': q.total,
    'Margin %': (q.marginPct || 0) / 100, 'Below margin floor': !!q.belowMarginFloor, 'Priced by': pricedBy, 'Agent notes': q.agentNotes || '', 'Follow-up questions': questions.join('\\n'), 'Created': now.toISOString(),
    'Approval token': sendNow ? '' : token, 'Sent at': sendNow ? now.toISOString() : undefined,
  }])));
  W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [Lg.logRecord({ clientId: client.clientId, service: 'quotes', event: 'quote_drafted', outcome: sendNow ? 'Success' : priced ? 'Draft created' : 'Sent to review', decision: status + ' £' + q.total, reasoning: pricedBy === 'agent' ? (q.agentNotes || '') : 'Priced from Quote Services/Factors', confidence: quote.confidence, reference: ref, workflow: 'KS Quote Calculator', executionId: $execution.id, details: { source, belowMarginFloor: q.belowMarginFloor } })])));
  if (sendNow) W.push(R.write.email(R.email({ to: Rg.safeRecipients(client, [q.customerEmail]), subject: 'Your quote from ' + client.clientName + ' (' + ref + ')', html: H.customerQuoteEmail(client, q), replyTo: client.businessEmail })));
  const approver = Rg.safeRecipients(client, [client.quotes.approverEmail || client.businessEmail]);
  if (!sendNow && approver.length) W.push(R.write.email(R.email({ to: approver, subject: (priced ? 'Approve quote ' : 'Quote needs details ') + ref + ': ' + (q.customerName || 'customer') + (q.belowMarginFloor ? ' [BELOW MARGIN]' : ''), html: H.approvalEmail(client, q, approveUrl) })));
  let message;
  if (source === 'phone') message = Qc.phoneSentence(quote, client.clientName);
  else if (sendNow) message = 'Quote ' + ref + ' sent to ' + q.customerEmail + '.';
  else if (priced && pricedBy === 'rules') message = 'Your estimate is £' + q.total.toFixed(2) + (q.pricesIncludeVat ? ' including VAT' : ' (£' + q.subtotal.toFixed(2) + ' + VAT)') + '. We will email your confirmed quote shortly.';
  else if (priced) message = 'Thanks. This job needs a quick check by our team. Our rough estimate is £' + q.total.toFixed(2) + ' including VAT, and we will confirm by email.';
  else message = 'Thanks. We need a few more details to price this, and the team will be in touch.';
  const approverIsBilal = approver.includes(Lg.OPS_EMAIL);
  const notice = (status === 'Draft - awaiting client approval' && approverIsBilal && q.customerEmail)
    ? { kind: 'quote_approval', clientId: client.clientId, clientName: client.clientName, audience: 'bilal', text: 'Quote ' + ref + ' for ' + (q.customerName || 'a customer') + ': ' + (q.service || q.description) + ', £' + q.total.toFixed(2) + ' inc VAT' + (q.belowMarginFloor ? ' (BELOW MARGIN ' + q.marginPct + '%)' : '') + '. Send it to the customer?', approval: { type: 'quote_send', ref, summary: 'Send quote ' + ref + ' (£' + q.total.toFixed(2) + ') to ' + (q.customerName || q.customerEmail), action: { approveUrl } } }
    : (status === 'Needs more info' ? { kind: 'info', clientId: client.clientId, clientName: client.clientName, audience: 'bilal', text: 'Quote request ' + ref + ' (' + source + ') needs details: ' + (q.description || '') } : null);
  const response = { ok: true, ref, status, message, total: priced ? q.total : 0, subtotal: q.subtotal, vat: q.vat, lines: priced && pricedBy === 'rules' ? q.lines.map((l) => ({ description: l.description, amount: l.amount })) : [], questions, service: q.service || null, estimate: true };
  return { json: { response, writes: W, notice } };
});`, { libs: L }),
  n.respond('Quote: respond'),
  n.code('Quote: ops notice', `return $input.all().filter((i) => i.json.notice).map((i) => ({ json: i.json.notice }));`),
  n.notify('Tell Ops Manager'),
  n.respond('Quote: rejected'),

  // ---------- C. Approve ----------
  n.webhook('Approve quote link', 'ks-quote-approve', { method: 'GET' }),
  n.code('Approve: quote query', `
const q = $json.query || {};
return [{ json: { q, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.quotes, { formula: '{Quote ref} = ' + KS.log.formulaString(q.ref || ''), maxRecords: 2 }) } }];`, { libs: L }),
  n.airtableHttp('Approve: get quote', 'GET'),
  n.code('Approve: check', `
const q = $('Approve: quote query').first().json.q;
const recs = ${listBody('Approve: get quote')};
const r = recs.length === 1 ? recs[0] : null;
const st = r && ((r.fields.Status && r.fields.Status.name) || r.fields.Status);
let problem = null;
if (!r) problem = 'Quote not found.';
else if (!q.t || r.fields['Approval token'] !== q.t) problem = 'This approval link is not valid.';
else if (st !== 'Draft - awaiting client approval') problem = 'This quote has already been handled (' + st + ').';
else if (!r.fields['Customer email']) problem = 'This quote has no customer email. Contact the customer directly.';
if (problem) return [{ json: { ok: false, statusCode: 400, html: KS.quotehtml.messagePage(null, 'Not sent', problem) } }];
return [{ json: { ok: true, record: r, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clients, { formula: '{Client ID} = ' + KS.log.formulaString(r.fields['Client ID']), maxRecords: 2 }) } }];`, { libs: L }),
  n.iff('Approve: valid?', 'ok'),
  n.airtableHttp('Approve: get client', 'GET'),
  n.code('Approve: send', `
const { registry: Rg, quotehtml: H, requests: R, log: Lg } = KS;
const r = $('Approve: check').first().json.record;
const { client } = Rg.resolveClient(${listBody('Approve: get client')}, { clientId: r.fields['Client ID'] });
if (!client || !Rg.gate(client, 'quotes').ok) return [{ json: { statusCode: 400, html: H.messagePage(client, 'Not sent', 'Quotes are paused for this business.'), writes: [] } }];
const saved = JSON.parse(r.fields['Inputs JSON'] || '{}').quote || {};
const now = new Date().toISOString();
const W = [
  R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.quotes, [{ id: r.id, fields: { 'Status': 'Sent to customer', 'Sent at': now, 'Approval token': '' } }])),
  R.write.email(R.email({ to: Rg.safeRecipients(client, [r.fields['Customer email']]), subject: 'Your quote from ' + client.clientName + ' (' + saved.ref + ')', html: H.customerQuoteEmail(client, saved), replyTo: client.businessEmail })),
  R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [Lg.logRecord({ clientId: client.clientId, service: 'quotes', event: 'quote_sent', outcome: 'Success', decision: 'Approved by business and emailed', reference: saved.ref, workflow: 'KS Quote Calculator', executionId: $execution.id })])),
];
return [{ json: { statusCode: 200, html: H.messagePage(client, 'Quote sent', 'Quote ' + saved.ref + ' has been emailed to ' + r.fields['Customer email'] + '.'), writes: W } }];`, { libs: L }),
  n.respond('Approve: respond', 'html'),
  n.respond('Approve: rejected', 'html'),
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['Quote form page', 'Form: client query'], ['Form: client query', 'Form: get client'], ['Form: get client', 'Form: services query'], ['Form: services query', 'Form: get services'],
  ['Form: get services', 'Form: factors query'], ['Form: factors query', 'Form: get factors'], ['Form: get factors', 'Form: render'], ['Form: render', 'Form: respond'],
  ['Quote request', 'Quote: client query'], ['Quote: client query', 'Quote: get client'], ['Quote: get client', 'Quote: check client'], ['Quote: check client', 'Quote: allowed?'],
  ['Quote: allowed?', 'Quote: get services', 0], ['Quote: allowed?', 'Quote: rejected', 1], ['Quote: get services', 'Quote: factors query'], ['Quote: factors query', 'Quote: get factors'],
  ['Quote: get factors', 'Quote: calculate'], ['Quote: calculate', 'Quote: priced by rules?'], ['Quote: priced by rules?', 'Quote: finalize', 0], ['Quote: priced by rules?', 'Quote: AI request', 1],
  ['Quote: AI request', 'Quote: AI estimate'], ['Quote: AI estimate', 'Quote: read AI'], ['Quote: read AI', 'Quote: finalize'], ['Quote: finalize', 'Quote: respond'], ['Quote: respond', 'Fan out writes'], ['Quote: respond', 'Quote: ops notice'], ['Quote: ops notice', 'Tell Ops Manager'],
  ['Approve quote link', 'Approve: quote query'], ['Approve: quote query', 'Approve: get quote'], ['Approve: get quote', 'Approve: check'], ['Approve: check', 'Approve: valid?'],
  ['Approve: valid?', 'Approve: get client', 0], ['Approve: valid?', 'Approve: rejected', 1], ['Approve: get client', 'Approve: send'], ['Approve: send', 'Approve: respond'], ['Approve: respond', 'Fan out writes'],
  ...tail.edges,
];
module.exports = n.workflow('KS Quote Calculator', nodes, edges, { tags: ['keystone', 'quotes'] });
