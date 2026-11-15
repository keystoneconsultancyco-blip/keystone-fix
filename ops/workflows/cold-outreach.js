'use strict';
// KS Cold Outreach (rules in lib/coldoutreach.js). Built switched OFF while Keystone is PAUSED.
//  Weekdays 09:40 + 13:40: Companies House check for new High-potential prospects (limited companies / LLPs only),
//    then, once Bilal has approved 20 emails through the Outreach agent, automatic emails (10 -> 40 a day over 4 weeks)
//    from "The Keystone Team", each with an unsubscribe link and the business address. Mondays: weekly summary to Bilal.
//  POST /webhook/ks-resend-events   Resend webhooks: email.received (replies to team@reply.<domain>), email.bounced,
//    email.complained. Each event is re-read from Resend with Keystone's key before anything is trusted.
//    Interested / question -> Haiku drafts Bilal's answer -> YES/NO approval. Not interested / stop -> never emailed again.
//  POST /webhook/ks-agent-cold-reply  (Bilal said YES) sends the approved answer from bilal.khan@.
const n = require('../scripts/n8n');
const L = ['coldoutreach', 'calc', 'agentprompts', 'audit', 'agent', 'ai', 'opsmanager', 'requests', 'log', 'registry'];

const ch = () => Object.assign(n.http('Companies House', 'companiesHouse', { method: 'GET', sendBody: false }), { onError: 'continueRegularOutput' });
const resendGet = (name) => Object.assign(n.http(name, 'resend', { method: 'GET', sendBody: false }), { onError: 'continueRegularOutput' });

const nodes = [
  // ================= daily runs =================
  n.schedule('Weekdays 09:40 and 13:40', '40 9,13 * * 1-5'),
  n.code('Load', `
const { requests: R } = KS;
const list = (t, o) => R.airtableList(AIRTABLE.baseId, AIRTABLE.tables[t], o);
const base = "AND({Potential} = 'High potential', {Email} != '', {Sent on} = '', NOT({Do not email}), OR({Status} = 'New - review', {Status} = ''))";
return [
  ['settings', list('settings', { maxRecords: 100 })],
  ['toCheck', list('prospects', { formula: "AND(" + base + ", {Companies House checked at} = BLANK())", maxRecords: 25 })],
  ['ready', list('prospects', { formula: "AND(" + base + ", {Cold email OK} = 'Yes', OR({Email approval} = '', {Email approval} = 'Edit requested'))", maxRecords: 40, sort: [{ field: 'Fit score', direction: 'desc' }] })],
  ['approvedSent', list('prospects', { formula: "AND({Email approval} = 'Sent', {Outreach mode} != 'Automatic')", fields: ['Company'], maxRecords: 25 })],
  ['sentToday', list('prospects', { formula: "AND({Outreach mode} = 'Automatic', IS_SAME({Sent on}, TODAY(), 'day'))", fields: ['Company'], maxRecords: 60 })],
  ['week', list('prospects', { formula: "OR(IS_AFTER({Sent on}, DATEADD(TODAY(), -8, 'days')), IS_AFTER({Reply received at}, DATEADD(NOW(), -8, 'days')), IS_AFTER({Companies House checked at}, DATEADD(NOW(), -8, 'days')))", maxRecords: 100 })],
  ['agentSettings', list('agentSettings', { maxRecords: 50 })],
].map(([key, req]) => ({ json: { key, req } }));`, { libs: L }),
  n.airtableHttp('Read Airtable', 'GET'),
  n.code('Plan', `
const { coldoutreach: Co, opsmanager: O, agentprompts: Pr, agent: A, audit: Au, log: Lg, requests: R } = KS;
const plan = $('Load').all();
const D = {}; $input.all().forEach((it, i) => { if (!(it.json.statusCode < 300)) throw new Error('Cold outreach: Airtable read failed (' + plan[i].json.key + ' ' + it.json.statusCode + ')'); D[plan[i].json.key] = ((it.json.body || {}).records) || []; });
const S = O.settingsMap(D.settings);
const now = (typeof $now !== 'undefined' && $now && $now.toJSDate) ? $now.toJSDate().getTime() : Date.now();
const q = Co.quota({ S, approvedSent: D.approvedSent.length, sentToday: D.sentToday.length, now });
const out = [];
const writes = [];
// Monday morning: the weekly summary (once a week).
const lp = Co.londonParts(now);
if (lp.day === 'Mon' && lp.hour < 12 && S.cold_summary_week !== lp.date) {
  const w = Co.weekly(D.week, now, q);
  writes.push(R.write.email(R.email({ from: R.EMAIL_FROM, to: (S.alert_email || Lg.OPS_EMAIL).split(',').map((s) => s.trim()), subject: w.subject, text: w.text, html: '<div style="font-family:Arial,sans-serif;white-space:pre-wrap">' + Lg.escapeHtml(w.text) + '</div>' })));
  writes.push(R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.settings, ['Setting'], [{ Setting: 'cold_summary_week', Value: lp.date }])));
}
// Companies House checks (only limited companies / LLPs may be cold-emailed).
for (const rec of D.toCheck) out.push({ json: { route: 0, rec, req: Co.chRequest(rec) } });
// Automatic sends, once Bilal has approved the first 20.
const verified = S.domain_status === 'Verified' && S.sending_domain;
if (q.n > 0 && verified && S.business_address) {
  if (q.startToday) writes.push(R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.settings, ['Setting'], [{ Setting: 'cold_outreach_start', Value: q.date }])));
  const rules = (D.agentSettings.find((r) => /outreach rules/i.test(r.fields.Setting || '')) || { fields: {} }).fields.Value || '';
  const pick = D.ready.filter((r) => Au.halalScreen(r.fields.Industry, r.fields['What they do'], r.fields.Company).pass).slice(0, q.n);
  for (const rec of pick) {
    const r = A.buildClaudeRequest({ task: 'outreach_draft', system: Pr.OUTREACH_SYSTEM, prompt: Pr.outreachPrompt(rec.fields, rules), schema: Pr.OUTREACH_SCHEMA, effort: 'low', maxTokens: 4000 });
    out.push({ json: { route: 1, rec, S: { business_address: S.business_address }, req: { url: r.url, method: 'POST', body: r.body } } });
  }
}
const notices = [];
if (q.n > 0 && !S.business_address && S.cold_address_warned !== lp.date) {
  notices.push({ kind: 'failure', audience: 'bilal', text: 'Cold outreach is ready to send automatically, but Keystone Settings > business_address is empty. Every cold email must show the business address, so nothing was sent. Fill it in and sending starts at the next run.' });
  writes.push(R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.settings, ['Setting'], [{ Setting: 'cold_address_warned', Value: lp.date }])));
}
if (writes.length || notices.length) out.push({ json: { route: 2, writes, notices } });
return out;`, { libs: L }),
  n.route('What next', 3),
  ch(),
  n.code('Companies House result', `
const { coldoutreach: Co, requests: R } = KS;
const b = $('Plan').item.json;
const r = Co.chResult(b.rec, { statusCode: $json.statusCode, body: $json.body }, b.req.kind);
if (r.retry) return { json: { writes: [] } };
return { json: { writes: [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: b.rec.id, fields: r.fields }]))] } };`, { libs: L, mode: 'runOnceForEachItem' }),
  Object.assign(n.claudeHttp('Claude: draft'), { onError: 'continueRegularOutput' }),
  n.aiUsageLogger('Log AI usage (draft)', 'outreach_draft', 'KS Cold Outreach'),
  n.code('Send cold email', `
const { coldoutreach: Co, agent: A, requests: R, calc: C, registry: Rg } = KS;
const b = $('Plan').item.json;
const rec = b.rec, f = rec.fields;
const parsed = R.ok($json) ? A.parseClaudeJson($json.body) : { ok: false, error: 'http_' + $json.statusCode };
if (!parsed.ok) return { json: { writes: [] } };
const d = parsed.data;
const offer = (f['Audit offer'] && f['Audit offer'].name) || f['Audit offer'] || '£100';
const broken = Co.ruleBreaks(d.subject, d.body, offer);
if (broken.length) return { json: { writes: [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: rec.id, fields: { 'Email subject': d.subject, 'Email draft': d.body, 'Email approval': 'Edit requested', 'Edit notes': 'Automatic check stopped this cold email: it ' + broken.join(' and ') + '.' } }]))] } };
const token = f['Unsubscribe token'] || C.randomId(32);
const m = Co.buildEmail(rec, d, b.S, token);
const isTest = /\\[TEST\\]/.test(f['Your notes'] || '');
const mail = R.email({ sender: 'team', from: R.EMAIL_FROM, to: [isTest ? Rg.TEST_INBOX : f.Email], subject: m.subject, text: m.text, html: m.html });
mail.body.headers = m.headers;
mail.body.tags = [{ name: 'prospect', value: rec.id }, { name: 'kind', value: 'cold' }];
const today = new Date().toISOString().slice(0, 10);
return { json: { writes: [R.write.email(mail), R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: rec.id, fields: {
  'Email subject': d.subject, 'Email draft': d.body, 'Email approval': 'Sent', 'Sent on': today, 'Status': 'Contacted', 'Outreach mode': 'Automatic', 'Unsubscribe token': token,
  'Cold email log': 'Sent automatically ' + new Date().toISOString().slice(0, 16).replace('T', ' '), 'Next step': 'Wait for a reply (replies are read automatically)' } }]))] } };`, { libs: L, mode: 'runOnceForEachItem' }),

  // ================= Resend events =================
  n.webhook('Resend event', 'ks-resend-events', { respond: 'onReceived' }),
  n.code('Resend: which event', `
let b = $json.body || {}; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
const d = b.data || {};
const id = String(d.email_id || d.id || '');
if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return [];
if (b.type === 'email.received') return [{ json: { type: b.type, req: { url: 'https://api.resend.com/emails/receiving/' + id } } }];
if (b.type === 'email.bounced' || b.type === 'email.complained') return [{ json: { type: b.type, tags: d.tags || {}, to: d.to || [], req: { url: 'https://api.resend.com/emails/' + id } } }];
return [];`),
  resendGet('Resend: read email'),
  n.code('Resend: find prospect', `
const { coldoutreach: Co, requests: R, log: Lg } = KS;
const ev = $('Resend: which event').first().json;
const m = $json.body || {};
if (!($json.statusCode < 300)) throw new Error('Cold outreach: could not read the email from Resend (' + $json.statusCode + '). Is the n8n Resend key full access?');
let email = '', id = '';
if (ev.type === 'email.received') {
  const to = [].concat(m.to || []).map(Co.addrOf);
  if (!to.some((a) => a.includes('@reply.'))) return [];
  email = Co.addrOf(m.from);
} else {
  if (ev.type === 'email.bounced' && m.last_event && !/bounce/.test(m.last_event)) return [];
  const tags = Array.isArray(ev.tags) ? Object.fromEntries(ev.tags.map((t) => [t.name, t.value])) : (ev.tags || {});
  id = /^rec[A-Za-z0-9]{14}$/.test(tags.prospect || '') ? tags.prospect : '';
  email = Co.addrOf([].concat(m.to || ev.to || [])[0]);
}
const f = id ? 'RECORD_ID() = ' + Lg.formulaString(id) : 'LOWER({Email}) = ' + Lg.formulaString(email || 'none');
return [['settings', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 100 })], ['prospect', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.prospects, { formula: f, maxRecords: 1 })]]
  .map(([key, req]) => ({ json: { key, type: ev.type, email, msg: { from: m.from, subject: m.subject, text: Co.newPart(m.text || String(m.html || '').replace(/<[^>]+>/g, ' ')) }, req } }));`, { libs: L }),
  n.airtableHttp('Resend: read Airtable', 'GET'),
  n.code('Resend: decide', `
const { coldoutreach: Co, agent: A, opsmanager: O, requests: R } = KS;
const plan = $('Resend: find prospect').all();
const D = {}; $input.all().forEach((it, i) => { D[plan[i].json.key] = ((it.json.body || {}).records) || []; });
const S = O.settingsMap(D.settings);
const { type, email, msg } = plan[0].json;
const rec = D.prospect[0];
const now = new Date().toISOString();
if (!rec) {
  if (type !== 'email.received') return [{ json: { route: 1, writes: [], notices: [] } }];
  return [{ json: { route: 1, writes: [], notices: [{ kind: 'info', audience: 'bilal', text: 'A reply came in to the cold outreach address from ' + email + ' (not a prospect in Airtable):\\n\\n' + String(msg.text || '').slice(0, 1500) }] } }];
}
if (type !== 'email.received') {
  const kind = type === 'email.bounced' ? 'Bounced' : 'Complaint';
  const writes = [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: rec.id, fields: { 'Do not email': true, 'Do not email reason': kind === 'Bounced' ? 'Email bounced' : 'Marked our email as spam', 'Reply type': kind, 'Reply received at': now } }]))];
  const notices = kind === 'Complaint' ? [{ kind: 'failure', audience: 'bilal', text: rec.fields.Company + ' marked a Keystone cold email as spam. They will never be emailed again. Too many complaints harm the domain: check the cold email wording if this happens again.' }] : [];
  return [{ json: { route: 1, writes, notices } }];
}
const r = A.buildClaudeRequest({ task: 'reply_classify', system: Co.REPLY_SYSTEM, prompt: Co.replyPrompt(rec, msg), schema: Co.REPLY_SCHEMA, effort: 'low', maxTokens: 2000 });
return [{ json: { route: 0, rec, msg, req: { url: r.url, method: 'POST', body: r.body } } }];`, { libs: L }),
  n.route('Reply or event', 2),
  Object.assign(n.claudeHttp('Claude: reply'), { onError: 'continueRegularOutput' }),
  n.aiUsageLogger('Log AI usage (reply)', 'reply_classify', 'KS Cold Outreach'),
  n.code('Handle reply', `
const { agent: A, requests: R } = KS;
const b = $('Resend: decide').item.json;
const rec = b.rec, f = rec.fields, msg = b.msg;
const now = new Date().toISOString();
const parsed = R.ok($json) ? A.parseClaudeJson($json.body) : { ok: false };
const d = parsed.ok ? parsed.data : { type: 'Question', summary: 'Could not classify automatically', draft_subject: '', draft_body: '' };
const fields = { 'Reply received at': now, 'Reply type': d.type, 'Last reply': String(msg.text || '').slice(0, 5000) };
const notices = [];
const base = '\\n\\nTheir reply:\\n' + String(msg.text || '').slice(0, 1500);
if (d.type === 'Auto-reply') return { json: { writes: [], notices: [] } };
fields.Status = 'Replied';
if (d.type === 'Not interested' || d.type === 'Unsubscribe') {
  Object.assign(fields, { 'Do not email': true, 'Do not email reason': d.type === 'Unsubscribe' ? 'Asked to stop' : 'Not interested', 'Status': 'Not pursuing', 'Nurture status': 'Stopped - replied' });
} else if (d.draft_body) {
  Object.assign(fields, { 'Reply draft': d.draft_body, 'Reply subject': d.draft_subject || ('Re: ' + (msg.subject || f['Email subject'] || '')), 'Next step': 'Bilal: YES/NO on the reply draft' });
  notices.push({ kind: 'info', audience: 'bilal', clientName: f.Company, text: f.Company + ' replied to the cold email (' + d.type.toLowerCase() + '): ' + d.summary + base + '\\n\\nDraft answer (from bilal.khan@):\\nSubject: ' + fields['Reply subject'] + '\\n\\n' + d.draft_body + '\\n\\nYES sends it. NO sends nothing (edit "Reply draft" in Airtable and reply yourself if you prefer).',
    approval: { type: 'cold_reply', ref: f.Company, summary: 'Send reply to ' + f.Company, action: { webhook: 'https://keystoneconsultancy.app.n8n.cloud/webhook/ks-agent-cold-reply', body: { prospectId: rec.id } } } });
} else {
  notices.push({ kind: 'info', audience: 'bilal', clientName: f.Company, text: f.Company + ' replied to the cold email; I could not draft an answer, please reply yourself.' + base });
}
return { json: { writes: [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: rec.id, fields }]))], notices } };`, { libs: L, mode: 'runOnceForEachItem' }),

  // ================= Bilal said YES to a reply draft =================
  n.webhook('Send approved reply', 'ks-agent-cold-reply', { respond: 'onReceived' }),
  n.code('Reply: load', `
const { requests: R, log: Lg } = KS;
let b = $json.body || {}; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
const id = String(b.prospectId || '').slice(0, 20);
if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return [];
return [['settings', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 100 })], ['prospect', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.prospects, { formula: 'RECORD_ID() = ' + Lg.formulaString(id), maxRecords: 1 })]]
  .map(([key, req]) => ({ json: { key, token: b.token || '', req } }));`, { libs: L }),
  n.airtableHttp('Reply: read Airtable', 'GET'),
  n.code('Reply: send', `
const { opsmanager: O, requests: R, log: Lg, registry: Rg } = KS;
const plan = $('Reply: load').all();
const D = {}; $input.all().forEach((it, i) => { D[plan[i].json.key] = ((it.json.body || {}).records) || []; });
const S = O.settingsMap(D.settings);
if (!S.agent_run_token || plan[0].json.token !== S.agent_run_token) return [{ json: { writes: [] } }];
const rec = D.prospect[0];
if (!rec || !rec.fields['Reply draft'] || rec.fields['Reply sent at'] || rec.fields['Do not email']) return [{ json: { writes: [] } }];
const f = rec.fields;
const quoted = String(f['Last reply'] || '').split('\\n').map((l) => '> ' + l).join('\\n');
const text = f['Reply draft'] + '\\n\\n' + quoted;
const to = /\\[TEST\\]/.test(f['Your notes'] || '') ? [Rg.TEST_INBOX] : [f.Email];
return [{ json: { writes: [
  R.write.email(R.email({ sender: 'personal', from: R.EMAIL_FROM, to, subject: f['Reply subject'] || 'Re: ' + (f['Email subject'] || ''), text, html: '<div style="font-family:Arial,sans-serif;white-space:pre-wrap">' + Lg.escapeHtml(f['Reply draft']) + '</div><blockquote style="color:#6b7280;border-left:2px solid #ddd;margin:16px 0;padding-left:10px;white-space:pre-wrap">' + Lg.escapeHtml(f['Last reply'] || '') + '</blockquote>' })),
  R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: rec.id, fields: { 'Reply sent at': new Date().toISOString(), 'Next step': 'Wait for their answer / book the call' } }])),
] } }];`, { libs: L }),

  n.code('Notices', `
const out = [];
for (const it of $input.all()) for (const x of (it.json.notices || [])) out.push({ json: x });
return out;`),
  n.notify('Tell Bilal'),
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['Weekdays 09:40 and 13:40', 'Load'], ['Load', 'Read Airtable'], ['Read Airtable', 'Plan'], ['Plan', 'What next'],
  ['What next', 'Companies House', 0], ['Companies House', 'Companies House result'], ['Companies House result', 'Fan out writes'],
  ['What next', 'Claude: draft', 1], ['Claude: draft', 'Log AI usage (draft)'], ['Log AI usage (draft)', 'Fan out writes'], ['Claude: draft', 'Send cold email'], ['Send cold email', 'Fan out writes'],
  ['What next', 'Fan out writes', 2], ['What next', 'Notices', 2],
  ['Resend event', 'Resend: which event'], ['Resend: which event', 'Resend: read email'], ['Resend: read email', 'Resend: find prospect'], ['Resend: find prospect', 'Resend: read Airtable'],
  ['Resend: read Airtable', 'Resend: decide'], ['Resend: decide', 'Reply or event'],
  ['Reply or event', 'Claude: reply', 0], ['Claude: reply', 'Log AI usage (reply)'], ['Log AI usage (reply)', 'Fan out writes'], ['Claude: reply', 'Handle reply'], ['Handle reply', 'Fan out writes'], ['Handle reply', 'Notices'],
  ['Reply or event', 'Fan out writes', 1], ['Reply or event', 'Notices', 1],
  ['Send approved reply', 'Reply: load'], ['Reply: load', 'Reply: read Airtable'], ['Reply: read Airtable', 'Reply: send'], ['Reply: send', 'Fan out writes'],
  ['Notices', 'Tell Bilal'],
  ...tail.edges,
];
module.exports = n.workflow('KS Cold Outreach', nodes, edges, { tags: ['keystone', 'outreach'] });
