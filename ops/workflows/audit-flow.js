'use strict';
// KS Audit Flow: the £100 Finance Ops Audit from payment to Won/Lost (logic in lib/auditflow.js, script in docs/AUDIT_PLAYBOOK.md).
//  POST /webhook/ks-stripe-events   Stripe (checkout.session.completed / payment_intent.canceled). Never trusted as sent:
//                                   the session or payment is re-read from Stripe with Keystone's own key.
//  POST /webhook/ks-audit-step      Airtable automation "Keystone audit flow" (any audit field Bilal changes) {token, recordId}
//  Schedule 09:05-19:05 every 2h     chases (day 3/5), release (day 6), reminders (24h before), reports
//  GET/POST /webhook/ks-audit-pick  the client picks a call time (or suggests one)
//  GET/POST /webhook/ks-audit-prep  the client's intake form (after the £100 is captured)
// Built switched OFF while Keystone is PAUSED.
const n = require('../scripts/n8n');
const L = ['auditflow', 'opsmanager', 'requests', 'log', 'agent', 'ai', 'agreementdoc'];
const STRIPE_VERSION = [['Stripe-Version', '2025-03-31.basil']];

const html = (name) => n.respond(name, 'html');
const stripeHttp = (name, method) => Object.assign(n.http(name, 'stripe', { method, sendBody: false, headers: STRIPE_VERSION }), { onError: 'continueRegularOutput' });
// Google Doc from HTML: multipart/related raw body (Drive converts it to a Doc), then export that Doc as PDF (binary).
function driveUpload() {
  const node = Object.assign(n.http('Drive: create doc', 'gdrive', { method: 'POST' }), { onError: 'continueRegularOutput' });
  delete node.parameters.specifyBody; delete node.parameters.jsonBody;
  Object.assign(node.parameters, { contentType: 'raw', rawContentType: '={{ $json.req.contentType }}', body: '={{ $json.req.raw }}' });
  return node;
}
function driveExport() {
  const node = Object.assign(n.http('Drive: export PDF', 'gdrive', { method: 'GET', sendBody: false }), { onError: 'continueRegularOutput' });
  node.parameters.options = { response: { response: { responseFormat: 'file', outputPropertyName: 'data', neverError: true } }, timeout: 60000 };
  return node;
}
const rec1 = (resp) => `(((${resp}).body || {}).records || [])[0]`;

const nodes = [
  // ================= Stripe =================
  n.webhook('Stripe event', 'ks-stripe-events', { respond: 'onReceived' }),
  n.code('Stripe: which object', `
let b = $json.body || {};
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
const obj = ((b.data || {}).object) || {};
// Re-read the object from Stripe: a forged webhook cannot invent a real paid session.
if (b.type === 'checkout.session.completed' && /^cs_/.test(obj.id || '')) return [{ json: { type: b.type, req: KS.auditflow.stripeReq('GET', '/v1/checkout/sessions/' + obj.id + '?expand[]=payment_intent') } }];
if (b.type === 'payment_intent.canceled' && /^pi_/.test(obj.id || '')) return [{ json: { type: b.type, req: KS.auditflow.stripeReq('GET', '/v1/payment_intents/' + obj.id) } }];
return [];`, { libs: L }),
  stripeHttp('Stripe: read object', 'GET'),
  n.code('Stripe: plan reads', `
const { requests: R, log: Lg } = KS;
const type = $('Stripe: which object').first().json.type;
const res = $json;
if (!(res.statusCode < 300) || !res.body) throw new Error('Audit flow: could not read the Stripe object (' + res.statusCode + ')');
const o = res.body;
const email = String(((o.customer_details || {}).email) || '').toLowerCase();
const f = type === 'checkout.session.completed' ? 'LOWER({Contact email}) = ' + Lg.formulaString(email || 'none') : '{Payment intent ID} = ' + Lg.formulaString(o.id);
return [['settings', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 100 })], ['intakes', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, { formula: f, maxRecords: 10 })]]
  .map(([key, req]) => ({ json: { key, type, obj: o, req } }));`, { libs: L }),
  n.airtableHttp('Stripe: read Airtable', 'GET'),
  n.code('Stripe: apply', `
const { auditflow: A, opsmanager: O, requests: R } = KS;
const plan = $('Stripe: plan reads').all();
const D = {}; $input.all().forEach((it, i) => { D[plan[i].json.key] = ((it.json.body || {}).records) || []; });
const S = O.settingsMap(D.settings);
const { type, obj } = plan[0].json;
const writes = [], notices = [];
if (type === 'checkout.session.completed') {
  const r = A.fromCheckout(obj, S, D.intakes);
  if (r.ignore) return [{ json: { ignored: r.ignore, writes, notices } }];
  writes.push(R.write.airtable(r.recordId ? R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [{ id: r.recordId, fields: r.fields }]) : R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [{ ...r.fields, 'Created': new Date().toISOString() }])));
  notices.push(r.notice);
} else if (type === 'payment_intent.canceled') {
  const rec = D.intakes[0];
  if (rec && A.sel(rec.fields['Payment status']) === 'Held') {
    writes.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [{ id: rec.id, fields: { 'Payment status': 'Released', 'Status': 'Hold released', 'Hold released at': new Date().toISOString() } }])));
    notices.push({ kind: 'failure', audience: 'bilal', clientName: rec.fields['Business name'], text: 'Stripe cancelled the £100 audit hold for ' + rec.fields['Business name'] + ' (' + (obj.cancellation_reason || 'expired') + '). Nothing was charged.' });
  }
}
return [{ json: { writes, notices } }];`, { libs: L }),

  // ================= Airtable change / schedule =================
  n.webhook('Airtable change', 'ks-audit-step', { respond: 'onReceived' }),
  n.schedule('Every 2 hours, 09-19', '5 9,11,13,15,17,19 * * *'),
  n.code('Load', `
const { requests: R, log: Lg } = KS;
const first = $input.first().json;
let b = first.body || {};
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
const event = !!first.headers;
const id = String(b.recordId || '').slice(0, 20);
if (event && !/^rec[A-Za-z0-9]{14}$/.test(id)) return [];
const f = event ? 'RECORD_ID() = ' + Lg.formulaString(id)
  : "AND(OR({Payment status} = 'Held', {Payment status} = 'Captured'), {Outcome done at} = BLANK())";
return [['settings', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 100 })], ['intakes', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, { formula: f, maxRecords: 50 })]]
  .map(([key, req]) => ({ json: { key, event, token: b.token || '', req } }));`, { libs: L }),
  n.airtableHttp('Read Airtable', 'GET'),
  n.code('Decide', `
const { auditflow: A, opsmanager: O } = KS;
const plan = $('Load').all();
const D = {}; $input.all().forEach((it, i) => { if (!(it.json.statusCode < 300)) throw new Error('Audit flow: Airtable read failed (' + it.json.statusCode + ')'); D[plan[i].json.key] = ((it.json.body || {}).records) || []; });
const S = O.settingsMap(D.settings);
const event = plan[0].json.event;
if (event && (!S.audit_hook_token || plan[0].json.token !== S.audit_hook_token)) return [];
const ROUTES = { local: 0, stripe: 1, confirm1: 2, gcal: 3, report: 4, won: 5 };
const now = Date.now();
const out = [];
for (const rec of D.intakes) {
  const d = A.decide(rec, S, now, event ? 'event' : 'schedule');
  if (d) out.push({ json: { route: ROUTES[d.route], step: d.step, ctx: d.ctx, rec, S, req: d.ctx.req || null } });
}
return out;`, { libs: L }),
  n.route('Route', 6),

  // stripe (release the hold)
  stripeHttp('Stripe: call', 'POST'),
  n.code('After Stripe', `const b = $('Decide').item.json; return { json: { ...b, res: { statusCode: $json.statusCode, body: $json.body } } };`, { mode: 'runOnceForEachItem' }),

  // confirm call 1: capture, then the Meet
  n.code('Capture request', `const b = $json; return { json: { ...b, req: KS.auditflow.stripeReq('POST', '/v1/payment_intents/' + b.ctx.pi + '/capture') } };`, { libs: L, mode: 'runOnceForEachItem' }),
  stripeHttp('Stripe: capture', 'POST'),
  n.code('Captured?', `
const b = $('Capture request').item.json;
const res = { statusCode: $json.statusCode, body: $json.body };
const already = /already been captured/.test(JSON.stringify(res.body || {}));
if (!(res.statusCode < 300) && !already) return { json: { ...b, route: 1, step: 'confirm1_failed', res } };
return { json: { ...b, route: 0, req: KS.auditflow.meetReq(b.rec, b.ctx.start, 1) } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.route('Capture ok?', 2),
  Object.assign(n.http('Google Meet: call 1', 'gcal', { method: 'POST' }), { onError: 'continueRegularOutput' }),
  n.code('After Meet 1', `const b = $('Captured?').item.json; return { json: { ...b, res: { statusCode: $json.statusCode, body: $json.body } } };`, { mode: 'runOnceForEachItem' }),

  // confirm call 2: the Meet
  Object.assign(n.http('Google Meet: call 2', 'gcal', { method: 'POST' }), { onError: 'continueRegularOutput' }),
  n.code('After Meet 2', `const b = $('Decide').item.json; return { json: { ...b, res: { statusCode: $json.statusCode, body: $json.body } } };`, { mode: 'runOnceForEachItem' }),

  // report: Opus -> HTML -> PDF
  n.code('Report request', `
const { auditflow: A, agent: Ag } = KS;
const b = $json;
const r = Ag.buildClaudeRequest({ task: 'audit_report', system: A.REPORT_SYSTEM, prompt: A.reportPrompt(b.rec), schema: A.REPORT_SCHEMA, effort: 'high', maxTokens: 12000 });
return { json: { ...b, req: { url: r.url, method: 'POST', body: r.body } } };`, { libs: L, mode: 'runOnceForEachItem' }),
  Object.assign(n.claudeHttp('Claude: report'), { onError: 'continueRegularOutput' }),
  n.aiUsageLogger('Log AI usage', 'audit_report', 'KS Audit Flow'),
  n.code('Report: build', `
const { auditflow: A, agent: Ag, requests: R } = KS;
const b = $('Report request').item.json;
const parsed = R.ok($json) ? Ag.parseClaudeJson($json.body) : { ok: false, error: 'http_' + $json.statusCode };
if (!parsed.ok) return { json: { ...b, route: 1, step: 'report_failed', ctx: { ...b.ctx, error: parsed.error } } };
const r = parsed.data;
const quote = A.quoteFor(r.recommended_services, A.sel(b.rec.fields['Revenue band']), r.money_lost_per_year_gbp);
const doc = A.reportHtml(b.rec, r, quote);
const name = 'Keystone audit report - ' + (b.rec.fields['Business name'] || b.rec.id);
return { json: { ...b, route: 0, kind: 'report', ctx: { ...b.ctx, report: { findings: r, quote } }, pdf: { name, html: doc, field: 'Report PDF' } } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.route('Report ok?', 2),

  // won: agreement -> PDF -> Xero invoice
  n.code('Won: agreement', `
const { auditflow: A, agreementdoc: Doc } = KS;
const b = $json;
let rep = null; try { rep = JSON.parse(b.rec.fields['Report JSON'] || 'null'); } catch (e) { rep = null; }
if (!rep || !rep.quote) return { json: { ...b, route: 1, step: 'won_failed', ctx: { ...b.ctx, error: 'there is no approved report with a quote (Report JSON is empty)' } } };
return { json: { ...b, route: 0, kind: 'won', ctx: { ...b.ctx, report: rep }, pdf: { name: 'Keystone client agreement - ' + (b.rec.fields['Business name'] || b.rec.id), html: A.agreementHtml(b.rec, rep.quote, Doc.MD), field: 'Agreement PDF' } } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.route('Won ok?', 2),

  // shared PDF chain: Google Doc from HTML -> export PDF -> Airtable attachment
  n.code('PDF: doc request', `
const b = $json;
const boundary = 'ks' + Math.random().toString(36).slice(2);
const meta = JSON.stringify({ name: b.pdf.name, mimeType: 'application/vnd.google-apps.document' });
const raw = '--' + boundary + '\\r\\nContent-Type: application/json; charset=UTF-8\\r\\n\\r\\n' + meta + '\\r\\n--' + boundary + '\\r\\nContent-Type: text/html; charset=UTF-8\\r\\n\\r\\n' + b.pdf.html + '\\r\\n--' + boundary + '--';
return { json: { ...b, req: { url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', contentType: 'multipart/related; boundary=' + boundary, raw } } };`, { mode: 'runOnceForEachItem' }),
  driveUpload(),
  n.code('PDF: export request', `
const b = $('PDF: doc request').item.json;
const id = ($json.body || {}).id;
if (!id) throw new Error('Audit flow: Google Drive could not create the document (' + $json.statusCode + ')');
return { json: { ...b, docId: id, req: { url: 'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=application/pdf' } } };`, { mode: 'runOnceForEachItem' }),
  driveExport(),
  n.code('PDF: attach request', `
const out = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const b = $('PDF: export request').all()[i].json;
  let b64 = '';
  if (items[i].binary && items[i].binary.data) b64 = (await this.helpers.getBinaryDataBuffer(i, 'data')).toString('base64');
  if (!b64) throw new Error('Audit flow: the PDF export from Google Drive was empty');
  out.push({ json: { ...b, req: { method: 'POST', url: 'https://content.airtable.com/v0/' + AIRTABLE.baseId + '/' + b.rec.id + '/' + encodeURIComponent(b.pdf.field) + '/uploadAttachment',
    body: { contentType: 'application/pdf', filename: b.pdf.name.replace(/[^\\w\\s-]/g, '') + '.pdf', file: b64 } } } });
}
return out;`, { libs: L }),
  n.airtableHttp('Airtable: attach PDF', 'POST'),
  n.code('PDF: next', `
const b = $('PDF: attach request').item.json;
if (!($json.statusCode < 300)) throw new Error('Audit flow: could not attach the PDF in Airtable (' + $json.statusCode + ')');
const att = ((($json.body || {}).fields || {})[b.pdf.field] || []).slice(-1)[0] || null;
const { req, pdf, ...rest } = b;
return { json: { ...rest, route: b.kind === 'won' ? 1 : 0, step: b.kind, ctx: { ...b.ctx, agreementAttachment: att } } };`, { mode: 'runOnceForEachItem' }),
  n.route('After PDF', 2),

  // Xero setup invoice (Keystone's own books): setup lines, multi-service discount, minus the £100 audit fee
  n.code('Xero: invoice request', `
const b = $json;
const q = b.ctx.report.quote;
const lines = q.setup.lines.map((l) => ({ Description: l.name + ' setup', Quantity: 1, UnitAmount: l.fee, AccountCode: b.S.audit_invoice_account_code || '200' }));
if (q.setup.discountPct) lines.push({ Description: 'Multi-service discount (' + q.setup.discountPct + '%)', Quantity: 1, UnitAmount: -(Math.round((q.setup.gross - q.setup.total) * 100) / 100), AccountCode: b.S.audit_invoice_account_code || '200' });
lines.push({ Description: 'Finance Ops Audit fee already paid', Quantity: 1, UnitAmount: -q.auditCredit, AccountCode: b.S.audit_invoice_account_code || '200' });
const today = new Date().toISOString().slice(0, 10);
const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
const inv = { Type: 'ACCREC', Contact: { Name: b.rec.fields['Business name'], EmailAddress: b.rec.fields['Contact email'] }, Date: today, DueDate: due, LineAmountTypes: 'NoTax', Status: 'AUTHORISED', Reference: 'Keystone setup ' + b.rec.id, LineItems: lines };
return { json: { ...b, req: { method: 'POST', url: 'https://api.xero.com/api.xro/2.0/Invoices', tenantId: b.ctx.tenantId, body: { Invoices: [inv] } } } };`, { mode: 'runOnceForEachItem' }),
  Object.assign(n.xeroHttp('Xero: create invoice', 'POST'), { onError: 'continueRegularOutput' }),
  n.code('Xero: online link request', `
const b = $('Xero: invoice request').item.json;
const inv = ((($json.body || {}).Invoices) || [])[0];
if (!inv || !inv.InvoiceID) return { json: { ...b, route: 1, step: 'won_failed', ctx: { ...b.ctx, error: 'Xero did not create the setup invoice (' + $json.statusCode + ')' } } };
return { json: { ...b, route: 0, invoice: { id: inv.InvoiceID, number: inv.InvoiceNumber }, req: { method: 'GET', url: 'https://api.xero.com/api.xro/2.0/Invoices/' + inv.InvoiceID + '/OnlineInvoice', tenantId: b.ctx.tenantId } } };`, { mode: 'runOnceForEachItem' }),
  n.route('Invoice ok?', 2),
  Object.assign(n.xeroHttp('Xero: online invoice', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('After Xero', `
const b = $('Xero: online link request').item.json;
const url = (((($json.body || {}).OnlineInvoices) || [])[0] || {}).OnlineInvoiceUrl || '';
return { json: { ...b, step: 'won', ctx: { ...b.ctx, invoice: { ...b.invoice, url } } } };`, { mode: 'runOnceForEachItem' }),


  // every path ends here
  n.code('Apply', `
const { auditflow: A } = KS;
const b = $json;
const out = A.apply(b.step, b.rec, b.ctx || {}, b.S || {}, b.res || {});
return { json: { writes: out.writes, notices: out.notices, log: out.log } };`, { libs: L, mode: 'runOnceForEachItem' }),

  // ================= client pages =================
  n.webhook('Pick page', 'ks-audit-pick', { method: 'GET' }),
  n.webhook('Pick submit', 'ks-audit-pick-submit'),
  n.webhook('Prep page', 'ks-audit-prep', { method: 'GET' }),
  n.webhook('Prep submit', 'ks-audit-prep-submit'),
  n.code('Page: lookup', `
const { requests: R, log: Lg } = KS;
const w = $input.first().json;
const kind = w.query && !w.body ? 'get' : (w.query && Object.keys(w.body || {}).length === 0 ? 'get' : 'post');
let b = w.body || {}; if (typeof b === 'string') { b = Object.fromEntries(new URLSearchParams(b)); }
const q = kind === 'get' ? (w.query || {}) : b;
const id = String(q.r || '').slice(0, 20);
const page = String((w.webhookUrl || '') + ' ' + (w.params ? '' : '')).includes('prep') ? 'prep' : 'pick';
return [{ json: { q, page: $input.first().json.__page || null, raw: w, req: R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, { formula: /^rec[A-Za-z0-9]{14}$/.test(id) ? 'RECORD_ID() = ' + Lg.formulaString(id) : 'FALSE()', maxRecords: 1 }) } }];`, { libs: L }),
  n.airtableHttp('Page: read record', 'GET'),
  n.airtableHttp('Page: read settings', 'GET'),
];

// Each page entry point tags which page it is before the shared lookup (so one lookup serves all four).
for (const [hook, tag] of [['Pick page', 'pick-get'], ['Pick submit', 'pick-post'], ['Prep page', 'prep-get'], ['Prep submit', 'prep-post']]) {
  nodes.push(n.code(`Tag: ${tag}`, `const w = $input.first().json; let b = w.body || {}; if (typeof b === 'string') b = Object.fromEntries(new URLSearchParams(b));
const q = ${tag.endsWith('get') ? 'w.query || {}' : 'b'};
const id = String(q.r || '').slice(0, 20);
return [{ json: { tag: '${tag}', q, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, { formula: /^rec[A-Za-z0-9]{14}$/.test(id) ? 'RECORD_ID() = ' + KS.log.formulaString(id) : 'FALSE()', maxRecords: 1 }) } }];`, { libs: L }));
}
nodes.push(
  n.code('Page: settings request', `return [{ json: { ...$('Page: tag').first().json, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 100 }) } }];`, { libs: L }),
  n.code('Page: tag', `return [{ json: $input.first().json }];`),
  n.code('Page: answer', `
const { auditflow: A, opsmanager: O, requests: R } = KS;
const t = $('Page: tag').first().json;
const rec = ${rec1("$('Page: read record').first().json")};
const S = O.settingsMap((($json.body || {}).records) || []);
const q = t.q || {};
const reply = (htmlText, writes = [], notices = []) => [{ json: { statusCode: 200, html: htmlText, writes, notices } }];
if (!rec || !rec.fields['Client token'] || q.t !== rec.fields['Client token']) return reply(A.page('Link not valid', '<p>This link is not valid any more. Please use the latest email from Bilal, or email ' + (S.client_contact_email || 'bilal.khan@keystoneconsultancyuk.co.uk') + '.</p>'));
const call = String(q.c) === '2' ? 2 : 1;
if (t.tag === 'pick-get') return reply(A.pickPage(rec, call, String(q.s), A.parseSlots(rec.fields[call === 2 ? 'Call 2 slots' : 'Available slots']).slots, S));
if (t.tag === 'pick-post') {
  const r = A.pickSubmit(rec, q);
  if (r.error) return reply(A.page('Sorry', '<p>' + r.error + '</p>'));
  return reply(A.page('Thank you', '<p>' + r.message + '</p>'), [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [{ id: rec.id, fields: r.fields }]))], [r.notice]);
}
if (A.sel(rec.fields['Payment status']) !== 'Captured') return reply(A.page('Not yet', '<p>The intake form opens once your call is confirmed.</p>'));
if (t.tag === 'prep-get') return reply(A.prepPage(rec));
if (A.has(rec, 'Intake form done at')) return reply(A.page('Thank you', '<p>We already have your answers. See you on the call.</p>'));
const r = A.prepSubmit(rec, q);
return reply(A.page('Thank you', '<p>Thank you, that is everything. See you on the call.</p>'), [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [{ id: rec.id, fields: r.fields }]))], [r.notice]);`, { libs: L }),
  html('Page: reply'),

  // ================= shared: notices to Bilal (SMS/email via KS Ops - Notify) =================
  n.code('Notices', `
const out = [];
for (const it of $input.all()) for (const x of (it.json.notices || [])) out.push({ json: x });
return out;`),
  n.notify('Tell Bilal'),
);
// the page lookup uses the per-tag nodes; drop the unused generic one
const dropped = new Set(['Page: lookup']);
const tail = n.writesTail();
const all = nodes.filter((x) => !dropped.has(x.name)).concat(tail.nodes);

const edges = [
  ['Stripe event', 'Stripe: which object'], ['Stripe: which object', 'Stripe: read object'], ['Stripe: read object', 'Stripe: plan reads'], ['Stripe: plan reads', 'Stripe: read Airtable'],
  ['Stripe: read Airtable', 'Stripe: apply'], ['Stripe: apply', 'Fan out writes'], ['Stripe: apply', 'Notices'],

  ['Airtable change', 'Load'], ['Every 2 hours, 09-19', 'Load'], ['Load', 'Read Airtable'], ['Read Airtable', 'Decide'], ['Decide', 'Route'],
  ['Route', 'Apply', 0],
  ['Route', 'Stripe: call', 1], ['Stripe: call', 'After Stripe'], ['After Stripe', 'Apply'],
  ['Route', 'Capture request', 2], ['Capture request', 'Stripe: capture'], ['Stripe: capture', 'Captured?'], ['Captured?', 'Capture ok?'],
  ['Capture ok?', 'Google Meet: call 1', 0], ['Capture ok?', 'Apply', 1], ['Google Meet: call 1', 'After Meet 1'], ['After Meet 1', 'Apply'],
  ['Route', 'Google Meet: call 2', 3], ['Google Meet: call 2', 'After Meet 2'], ['After Meet 2', 'Apply'],
  ['Route', 'Report request', 4], ['Report request', 'Claude: report'], ['Claude: report', 'Log AI usage'], ['Log AI usage', 'Fan out writes'], ['Claude: report', 'Report: build'],
  ['Report: build', 'Report ok?'], ['Report ok?', 'PDF: doc request', 0], ['Report ok?', 'Apply', 1],
  ['Route', 'Won: agreement', 5], ['Won: agreement', 'Won ok?'], ['Won ok?', 'PDF: doc request', 0], ['Won ok?', 'Apply', 1],
  ['PDF: doc request', 'Drive: create doc'], ['Drive: create doc', 'PDF: export request'], ['PDF: export request', 'Drive: export PDF'], ['Drive: export PDF', 'PDF: attach request'],
  ['PDF: attach request', 'Airtable: attach PDF'], ['Airtable: attach PDF', 'PDF: next'], ['PDF: next', 'After PDF'],
  ['After PDF', 'Apply', 0], ['After PDF', 'Xero: invoice request', 1], ['Xero: invoice request', 'Xero: create invoice'], ['Xero: create invoice', 'Xero: online link request'],
  ['Xero: online link request', 'Invoice ok?'], ['Invoice ok?', 'Xero: online invoice', 0], ['Invoice ok?', 'Apply', 1], ['Xero: online invoice', 'After Xero'], ['After Xero', 'Apply'],
  ['Apply', 'Fan out writes'], ['Apply', 'Notices'],

  ['Pick page', 'Tag: pick-get'], ['Pick submit', 'Tag: pick-post'], ['Prep page', 'Tag: prep-get'], ['Prep submit', 'Tag: prep-post'],
  ['Tag: pick-get', 'Page: tag'], ['Tag: pick-post', 'Page: tag'], ['Tag: prep-get', 'Page: tag'], ['Tag: prep-post', 'Page: tag'],
  ['Page: tag', 'Page: read record'], ['Page: read record', 'Page: settings request'], ['Page: settings request', 'Page: read settings'], ['Page: read settings', 'Page: answer'],
  ['Page: answer', 'Page: reply'], ['Page: reply', 'Fan out writes'], ['Page: answer', 'Notices'],
  ['Notices', 'Tell Bilal'],
  ...tail.edges,
];
module.exports = n.workflow('KS Audit Flow', all, edges, { tags: ['keystone', 'audit'] });
