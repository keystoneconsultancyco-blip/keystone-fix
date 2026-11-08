'use strict';
// KS Ops Manager: morning (07:30) + evening (18:00) summaries, and YES/NO approvals.
//   GET  /webhook/ks-ops-reply?c=CODE&a=yes|no&t=TOKEN   email buttons
//   POST /webhook/ks-ops-sms                             Twilio inbound SMS ("YES 4821") once the Twilio number exists
// Instant notices are sent by the private sub-workflow "KS Ops - Notify".
const n = require('../scripts/n8n');
const L = ['opsmanager', 'requests', 'log', 'registry'];
const T = n.AIRTABLE.tables;
const list = (name) => `(($('${name}').first().json.body || {}).records || [])`;

const fetches = [
  ['settings', T.settings, ''], ['clients', T.clients, ''], ['logs', T.agentLog, "IS_AFTER({Timestamp}, DATEADD(NOW(), -1, 'days'))"],
  ['calls', T.callLog, "IS_AFTER({Timestamp}, DATEADD(NOW(), -1, 'days'))"], ['quotes', T.quotes, "IS_AFTER({Created}, DATEADD(NOW(), -1, 'days'))"],
  ['reviews', T.needsReview, "{Status} = 'Open'"], ['approvals', T.opsApprovals, "{Status} = 'Pending'"],
];

const nodes = [
  n.schedule('Morning 07:30', '30 7 * * *'),
  n.schedule('Evening 18:00', '0 18 * * *'),
  n.webhook('Run summary now', 'ks-ops-summary-now'),
  n.code('Which summary', `
const j = $input.first().json;
const kind = j.body && j.body.kind ? j.body.kind : (new Date().getUTCHours() < 12 ? 'morning' : 'evening');
return [{ json: { kind, fromWebhook: !!j.headers, reqs: ${JSON.stringify(fetches)}.map(([k, t, f]) => ({ key: k, req: KS.requests.airtableList(AIRTABLE.baseId, t, { formula: f || undefined, maxRecords: 100 }) })) } }];`, { libs: L }),
  n.code('One request per table', `return $input.first().json.reqs.map((r) => ({ json: r }));`),
  Object.assign(n.airtableHttp('Read Airtable', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Build summary', `
const { opsmanager: O, requests: R, log: Lg } = KS;
const keys = $('One request per table').all().map((i) => i.json.key);
const data = {}; $input.all().forEach((it, i) => { data[keys[i]] = ((it.json.body || {}).records) || []; });
const S = O.settingsMap(data.settings);
const kind = $('Which summary').first().json.kind;
const now = new Date();
const from = new Date(now.getTime() - (kind === 'morning' ? 13.5 : 10.5) * 3600000);
const s = O.summarise(data, from, now);
const label = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const text = O.summaryText(kind, s, label);
const ch = O.channels(S);
const W = [];
if (ch.email) W.push(R.write.email(R.email({ from: S.email_from || R.EMAIL_FROM, to: (S.alert_email || Lg.OPS_EMAIL).split(',').map((x) => x.trim()), subject: '[Keystone] ' + (kind === 'morning' ? 'Morning' : 'Evening') + ' summary - ' + label, text, html: O.emailHtml({ kind: 'info', text }, null) })));
if (ch.sms) W.push(R.write.sms(S.twilio_from, S.alert_sms_to, O.summarySms(kind, s)));
return [{ json: { kind, summary: s, text, writes: W, route: $('Which summary').first().json.fromWebhook ? 0 : 1, response: { ok: true, kind, text } } }];`, { libs: L }),
  n.route('Started from webhook?', 2),
  n.respond('Summary response'),
  n.noop('Scheduled run done'),

  // ---------- approvals ----------
  n.webhook('Email reply link', 'ks-ops-reply', { method: 'GET' }),
  n.code('Read email reply', `
const q = $json.query || {};
return [{ json: { code: String(q.c || ''), decision: q.a === 'yes' ? 'yes' : q.a === 'no' ? 'no' : null, token: q.t || '', via: 'email', reply: 0 } }];`),
  n.webhook('Inbound SMS (Twilio)', 'ks-ops-sms'),
  n.code('Read SMS reply', `
const b = $json.body || {};
const p = KS.opsmanager.parseReply(b.Body);
return [{ json: { code: p.code || '', decision: p.decision, from: b.From || '', via: 'sms', reply: 1 } }];`, { libs: L }),
  n.code('Find approval', `
const x = $input.first().json;
return [{ json: { ...x, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.opsApprovals, { formula: '{Code} = ' + KS.log.formulaString(x.code), maxRecords: 5 }) } }];`, { libs: L }),
  n.airtableHttp('Get approval', 'GET'),
  n.code('Prepare settings for reply', `return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 50 }) } }];`, { libs: L }),
  n.airtableHttp('Get settings (reply)', 'GET'),
  n.code('Check approval', `
const { opsmanager: O, registry: Rg } = KS;
const x = $('Find approval').first().json;
const S = O.settingsMap(${list('Get settings (reply)')});
const recs = ${list('Get approval')}.filter((r) => ((r.fields.Status && r.fields.Status.name) || r.fields.Status) === 'Pending');
let problem = null;
if (!x.decision) problem = 'Reply YES or NO followed by the 4-digit code.';
else if (recs.length !== 1) problem = 'No pending approval with code ' + (x.code || '?') + '.';
else if (x.via === 'email' && recs[0].fields['Reply token'] !== x.token) problem = 'This link is not valid.';
else if (x.via === 'sms' && Rg.normalizePhone(x.from) !== Rg.normalizePhone(S.alert_sms_to)) problem = 'Replies are only accepted from Bilal\\'s phone.';
if (problem) return [{ json: { ok: false, route: 3, message: problem, via: x.via, reply: x.reply } }];
const r = recs[0];
const type = (r.fields.Type && r.fields.Type.name) || r.fields.Type;
const action = JSON.parse(r.fields['Action JSON'] || '{}');
const route = x.decision === 'no' ? 2 : type === 'quote_send' ? 0 : type === 'invoice_resubmit' ? 1 : 3;
const req = route === 0 ? { method: 'GET', url: action.approveUrl } : route === 1 ? { method: 'POST', url: 'https://keystoneconsultancy.app.n8n.cloud/webhook/invoice/job-completed', body: { ...action.job, approvedByBilal: true } } : null;
return [{ json: { ok: true, route, record: r, type, decision: x.decision, via: x.via, reply: x.reply, req } }];`, { libs: L }),
  n.route('Do what?', 4),
  Object.assign(n.http('Send the quote', null, { method: 'GET', sendBody: false }), { onError: 'continueRegularOutput' }),
  Object.assign(n.http('Re-submit job as DRAFT', null, { method: 'POST' }), { onError: 'continueRegularOutput' }),
  n.code('Finish approval', `
const { requests: R } = KS;
const x = $('Check approval').first().json;
let result, status;
if (!x.ok) { result = x.message; status = null; }
else if (x.decision === 'no') { result = 'Rejected. Nothing was sent.'; status = 'Rejected'; }
else {
  const res = $input.first().json;
  const good = res && res.statusCode >= 200 && res.statusCode < 300 && !(res.body && (res.body.status === 'rejected' || res.body.ok === false));
  result = good ? (x.type === 'quote_send' ? 'Approved. The quote has been emailed to the customer.' : 'Approved. The job was re-submitted and created as a Xero DRAFT' + (res.body && res.body.invoiceNumber ? ' (' + res.body.invoiceNumber + ')' : '') + '.') : 'Approved, but the action failed (' + (res && res.statusCode) + '). Please check it by hand.';
  status = good ? 'Approved' : 'Failed';
}
const W = status ? [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.opsApprovals, [{ id: x.record.id, fields: { 'Status': status, 'Decided at': new Date().toISOString(), 'Decided via': x.via, 'Result': result, 'Reply token': '' } }]))] : [];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
return [{ json: { route: x.reply, writes: W, html: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:Arial;max-width:520px;margin:40px auto;padding:20px"><h2>Keystone</h2><p style="font-size:17px">' + esc(result) + '</p></div>', twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + esc('Keystone: ' + result) + '</Message></Response>' } }];`, { libs: L }),
  n.route('Reply how?', 2),
  n.respond('Reply page', 'html'),
  n.respond('Reply SMS', 'xml'),
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['Morning 07:30', 'Which summary'], ['Evening 18:00', 'Which summary'], ['Run summary now', 'Which summary'], ['Which summary', 'One request per table'],
  ['One request per table', 'Read Airtable'], ['Read Airtable', 'Build summary'], ['Build summary', 'Fan out writes'], ['Build summary', 'Started from webhook?'], ['Started from webhook?', 'Summary response', 0], ['Started from webhook?', 'Scheduled run done', 1],
  ['Email reply link', 'Read email reply'], ['Inbound SMS (Twilio)', 'Read SMS reply'], ['Read email reply', 'Find approval'], ['Read SMS reply', 'Find approval'],
  ['Find approval', 'Get approval'], ['Get approval', 'Prepare settings for reply'], ['Prepare settings for reply', 'Get settings (reply)'], ['Get settings (reply)', 'Check approval'],
  ['Check approval', 'Do what?'], ['Do what?', 'Send the quote', 0], ['Do what?', 'Re-submit job as DRAFT', 1], ['Do what?', 'Finish approval', 2], ['Do what?', 'Finish approval', 3],
  ['Send the quote', 'Finish approval'], ['Re-submit job as DRAFT', 'Finish approval'], ['Finish approval', 'Reply how?'], ['Reply how?', 'Reply page', 0], ['Reply how?', 'Reply SMS', 1],
  ['Reply page', 'Fan out writes'], ['Reply SMS', 'Fan out writes'], ...tail.edges,
];
module.exports = n.workflow('KS Ops Manager', nodes, edges, { tags: ['keystone', 'ops'] });
