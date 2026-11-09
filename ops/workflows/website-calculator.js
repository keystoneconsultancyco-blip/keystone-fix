'use strict';
// KS Website Calculator: the website's free, email-verified quote calculator (docs/PRICING.md section 7).
//  POST /webhook/ks-calc-start   {name, email, company, revenueBand, services[], consent, website(honeypot)}
//       -> honeypot / validation / 3-per-day limit per email and per IP -> 6-digit code by email (15 minutes, 3 tries)
//          Codes are only emailed once the email domain is verified (before that: only to Bilal's own inbox, for testing).
//  POST /webhook/ks-calc-verify  {requestId, code} -> "from" prices + audit CTA; saves the lead to Prospects (Source = Website,
//       free-mail flagged, consent recorded) and asks Client Hunter to score it (Lead value / Audit offer).
//  GET  /webhook/ks-unsubscribe?p=&t= -> stops Nurture emails for that lead.
const n = require('../scripts/n8n');
const L = ['calc', 'pricing', 'opsmanager', 'requests', 'log', 'registry', 'leadscore'];
const BASE = 'https://keystoneconsultancy.app.n8n.cloud/webhook';

function cors(name, kind = 'json') {
  const headers = { entries: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: kind === 'html' ? 'text/html; charset=utf-8' : 'application/json' }] };
  return n.respond(name, kind) && Object.assign(n.respond(name, kind), { parameters: kind === 'html'
    ? { respondWith: 'text', responseBody: '={{ $json.html }}', options: { responseCode: '={{ $json.statusCode || 200 }}', responseHeaders: headers } }
    : { respondWith: 'json', responseBody: '={{ JSON.stringify($json.response) }}', options: { responseCode: '={{ $json.statusCode || 200 }}', responseHeaders: headers } } });
}
const settingsReq = "KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 100 })";
const okBody = (name) => `(() => { const r = $('${name}').first().json; if (!(r.statusCode < 300)) throw new Error('Calculator: Airtable read failed (' + r.statusCode + ')'); return r.body; })()`;

const nodes = [
  // ---------- start: email a code ----------
  Object.assign(n.webhook('Calc start', 'ks-calc-start'), {}),
  n.code('Start: read settings', `return [{ json: { input: $input.first().json, req: ${settingsReq} } }];`, { libs: L }),
  n.airtableHttp('Get settings (start)', 'GET'),
  n.code('Start: recent requests', `
const { calc: C, opsmanager: O, requests: R, log: Lg } = KS;
const w = $('Start: read settings').first().json.input;
const S = O.settingsMap(${okBody('Get settings (start)')}.records);
const v = C.validateStart(C.parseBody(w.body));
const ipHash = C.hash(C.clientIp(w.headers), 'ip|' + (S.agent_run_token || ''));
const f = "AND(IS_SAME({Created}, NOW(), 'day'), OR({Email} = " + Lg.formulaString(v.x.email || 'none') + ", {IP hash} = " + Lg.formulaString(ipHash) + '))';
return [{ json: { v, ipHash, S: { salt: S.agent_run_token || '', website_calculator: S.website_calculator, domain_status: S.domain_status, email_from: S.email_from }, req: R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.calcRequests, { formula: f, fields: ['Email', 'IP hash'], maxRecords: 20 }) } }];`, { libs: L }),
  n.airtableHttp('Get recent requests', 'GET'),
  n.code('Start: decide', `
const { calc: C, requests: R, registry: Rg } = KS;
const x = $('Start: recent requests').first().json;
const recent = ((${okBody('Get recent requests')}).records || []).map((r) => r.fields);
const v = x.v, S = x.S;
const reply = (statusCode, response, writes = []) => [{ json: { statusCode, response, writes } }];
// Bots fill the hidden field: pretend it worked, do nothing.
if (v.isBot) return reply(200, { ok: true, requestId: C.randomId(), message: 'Check your email for a 6-digit code.' });
if (v.errors.length) return reply(400, { ok: false, message: v.errors.join(' ') });
if (C.rateLimited(recent, v.x.email, x.ipHash)) return reply(429, { ok: false, message: 'You have asked for 3 codes today. Please try again tomorrow, or email us.' });
if (!C.sendingAllowed(S, v.x.email, Rg.TEST_INBOX)) return reply(503, { ok: false, comingSoon: true, message: 'Instant estimates open very soon. In the meantime, email keystoneconsultancy.co@gmail.com and we will send you prices the same day.' });
const code = C.randomCode(), requestId = C.randomId();
const now = new Date();
const mail = C.codeEmail(v.x.name, code);
return reply(200, { ok: true, requestId, message: 'We have emailed a 6-digit code to ' + v.x.email + '. It lasts 15 minutes.' }, [
  R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.calcRequests, [{ 'Request ID': requestId, 'Email': v.x.email, 'IP hash': x.ipHash, 'Code hash': C.hash(code, S.salt), 'Expires': new Date(now.getTime() + C.CODE_MINUTES * 60000).toISOString(), 'Attempts': 0, 'Verified': false, 'Data JSON': JSON.stringify(v.x), 'Created': now.toISOString() }])),
  R.write.email(R.email({ from: S.email_from || R.EMAIL_FROM, to: [v.x.email], subject: mail.subject, html: mail.html, text: mail.text })),
]);`, { libs: L }),
  cors('Start: respond'),

  // ---------- verify the code ----------
  n.webhook('Calc verify', 'ks-calc-verify'),
  n.code('Verify: read settings', `return [{ json: { input: $input.first().json, req: ${settingsReq} } }];`, { libs: L }),
  n.airtableHttp('Get settings (verify)', 'GET'),
  n.code('Verify: request row', `
const { calc: C, opsmanager: O, requests: R, log: Lg } = KS;
const b = C.parseBody($('Verify: read settings').first().json.input.body);
const S = O.settingsMap(${okBody('Get settings (verify)')}.records);
return [{ json: { b: { requestId: String(b.requestId || '').slice(0, 40), code: String(b.code || '').slice(0, 10) }, salt: S.agent_run_token || '', token: S.agent_run_token,
  req: R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.calcRequests, { formula: '{Request ID} = ' + Lg.formulaString(String(b.requestId || 'none').slice(0, 40)), maxRecords: 1 }) } }];`, { libs: L }),
  n.airtableHttp('Get request row', 'GET'),
  n.code('Verify: check code', `
const { calc: C, requests: R, log: Lg } = KS;
const x = $('Verify: request row').first().json;
const rec = ((${okBody('Get request row')}).records || [])[0];
const chk = C.checkCode(rec && rec.fields, x.b.code, x.salt);
if (!chk.ok) {
  const writes = chk.reason === 'wrong' ? [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.calcRequests, [{ id: rec.id, fields: { 'Attempts': chk.attempts } }]))] : [];
  return [{ json: { ok: false, statusCode: chk.reason === 'wrong' ? 400 : 410, response: { ok: false, reason: chk.reason, message: chk.message }, writes } }];
}
const data = JSON.parse(rec.fields['Data JSON'] || '{}');
return [{ json: { ok: true, rec: { id: rec.id }, data, token: x.token, req: R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.prospects, { formula: 'LOWER({Email}) = ' + Lg.formulaString(data.email), fields: ['Company', 'Email', 'Unsubscribe token', 'Marketing consent', 'Source'], maxRecords: 1 }) } }];`, { libs: L }),
  n.iff('Code ok?', 'ok'),
  n.airtableHttp('Find prospect', 'GET'),
  n.code('Verify: save prospect', `
const { calc: C, requests: R, leadscore: Sc } = KS;
const x = $('Verify: check code').first().json;
const d = x.data;
const existing = ((${okBody('Find prospect')}).records || [])[0];
const dom = d.email.split('@')[1];
const free = C.isFreeMail(d.email);
const fields = { 'Contact name': d.name, 'Email': d.email, 'Revenue band': C.BANDS[d.revenueBand], 'Free-mail address': free, 'Signed up at': new Date().toISOString(),
  ...(d.services.length ? { 'Services wanted': d.services.map((s) => Sc.SERVICE_FIELD[s]) } : {}), ...(d.consent ? { 'Marketing consent': true } : {}) };
const req = existing
  ? R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: existing.id, fields: { ...fields, ...(existing.fields['Unsubscribe token'] ? {} : { 'Unsubscribe token': C.randomId(32) }) } }])
  : R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ ...fields, 'Company': d.company, 'Source': 'Website', 'Status': 'New - review', 'Potential': 'Medium', 'Found on': new Date().toISOString().slice(0, 10),
      'Dedup ID': free ? d.email : dom, 'Unsubscribe token': C.randomId(32), 'Lead value': 'Standard', 'Audit offer': '£100', 'Why': 'Website sign-up: being scored by Client Hunter.',
      'Your notes': 'Website calculator sign-up' + (free ? ' (free-mail address)' : '') + (d.consent ? ', marketing consent given' : ', no marketing consent') + '.' }]);
return [{ json: { req, existing: !!existing } }];`, { libs: L }),
  n.airtableWrite('Save prospect'),
  n.code('Verify: results', `
const { calc: C, requests: R } = KS;
const x = $('Verify: check code').first().json;
const saved = $json;
const id = saved.statusCode < 300 && saved.body && saved.body.records && saved.body.records[0] ? saved.body.records[0].id : null;
const writes = [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.calcRequests, [{ id: x.rec.id, fields: { 'Verified': true } }]))];
if (id) writes.push(R.write.webhook('${BASE}/ks-agent-lead-researcher', { stage: 'score', prospectId: id, token: x.token }));
return [{ json: { statusCode: 200, response: { ok: true, ...C.results(x.data.services) }, writes, savedId: id } }];`, { libs: L }),
  cors('Verify: respond'),

  // ---------- unsubscribe ----------
  n.webhook('Unsubscribe', 'ks-unsubscribe', { method: 'GET' }),
  n.code('Unsub: find lead', `
const q = $input.first().json.query || {};
return [{ json: { q, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.prospects, { formula: 'RECORD_ID() = ' + KS.log.formulaString(String(q.p || 'none').slice(0, 20)), fields: ['Unsubscribe token', 'Company'], maxRecords: 1 }) } }];`, { libs: L }),
  Object.assign(n.airtableHttp('Get lead', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Unsub: apply', `
const { requests: R } = KS;
const q = $('Unsub: find lead').first().json.q;
const rec = ((($json.body) || {}).records || [])[0];
const ok = !!(rec && rec.fields['Unsubscribe token'] && q.t === rec.fields['Unsubscribe token']);
const page = (msg) => '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;padding:20px"><h2>Keystone</h2><p style="font-size:17px">' + msg + '</p></div>';
return [{ json: { statusCode: ok ? 200 : 400, html: page(ok ? 'You are unsubscribed. You will not get any more emails from us.' : 'This unsubscribe link is not valid. Reply to any of our emails with "unsubscribe" and we will remove you.'),
  writes: ok ? [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: rec.id, fields: { 'Marketing consent': false, 'Nurture status': 'Stopped - unsubscribed', 'Unsubscribed at': new Date().toISOString() } }]))] : [] } }];`, { libs: L }),
  cors('Unsub: respond', 'html'),

  // ---------- daily clean-up: the privacy notice promises request records are deleted after 30 days ----------
  n.schedule('Daily 03:10 clean-up', '10 3 * * *'),
  n.code('Old requests query', `return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.calcRequests, { formula: "IS_BEFORE({Created}, DATEADD(NOW(), -30, 'days'))", fields: ['Request ID'], maxRecords: 100 }) } }];`, { libs: L }),
  Object.assign(n.airtableHttp('Get old requests', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Delete old requests', `
const ids = ((($json.body) || {}).records || []).map((r) => r.id);
const writes = [];
for (let i = 0; i < ids.length; i += 10) writes.push({ kind: 'airtable', req: { method: 'DELETE', url: 'https://api.airtable.com/v0/' + AIRTABLE.baseId + '/' + AIRTABLE.tables.calcRequests + '?' + ids.slice(i, i + 10).map((id) => 'records[]=' + id).join('&') } });
return [{ json: { deleted: ids.length, writes } }];`, { libs: L }),
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['Calc start', 'Start: read settings'], ['Start: read settings', 'Get settings (start)'], ['Get settings (start)', 'Start: recent requests'], ['Start: recent requests', 'Get recent requests'],
  ['Get recent requests', 'Start: decide'], ['Start: decide', 'Start: respond'], ['Start: respond', 'Fan out writes'],
  ['Calc verify', 'Verify: read settings'], ['Verify: read settings', 'Get settings (verify)'], ['Get settings (verify)', 'Verify: request row'], ['Verify: request row', 'Get request row'],
  ['Get request row', 'Verify: check code'], ['Verify: check code', 'Code ok?'], ['Code ok?', 'Find prospect', 0], ['Code ok?', 'Verify: respond', 1],
  ['Find prospect', 'Verify: save prospect'], ['Verify: save prospect', 'Save prospect'], ['Save prospect', 'Verify: results'], ['Verify: results', 'Verify: respond'], ['Verify: respond', 'Fan out writes'],
  ['Unsubscribe', 'Unsub: find lead'], ['Unsub: find lead', 'Get lead'], ['Get lead', 'Unsub: apply'], ['Unsub: apply', 'Unsub: respond'], ['Unsub: respond', 'Fan out writes'],
  ['Daily 03:10 clean-up', 'Old requests query'], ['Old requests query', 'Get old requests'], ['Get old requests', 'Delete old requests'], ['Delete old requests', 'Fan out writes'],
  ...tail.edges,
];
module.exports = n.workflow('KS Website Calculator', nodes, edges, { tags: ['keystone', 'website'] });
