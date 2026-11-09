'use strict';
// KS Switch-On: makes go-live a matter of filling two cells in Keystone Settings.
//  Domain:  sending_domain filled -> registers it in Resend and emails Bilal the exact DNS records -> keeps asking Resend
//           to verify -> once verified: email_from switches to <sending_address>@domain for every workflow (the shared
//           tail swaps the test sender), clients still on the test sender move over, held outreach emails and
//           proposals are released, and Bilal is told.
//  Twilio:  twilio_from filled -> points the number's calls at the phone IVR and its texts at the Ops Manager
//           (YES/NO replies), records twilio_connected, and tells Bilal. SMS alerts switch on by themselves once
//           alert_sms_to (his mobile) is filled too.
// Every 15 minutes, or POST /webhook/ks-switch-check {token} (add "probeTwilio": true to test the Twilio login only).
const n = require('../scripts/n8n');
const L = ['opsmanager', 'requests', 'log', 'agentteam'];
const BASE = 'https://keystoneconsultancy.app.n8n.cloud/webhook';

function twilioHttp(name, method) {
  const node = n.http(name, 'twilio', { method, sendBody: method === 'POST' });
  if (method === 'POST') {
    delete node.parameters.specifyBody; delete node.parameters.jsonBody;
    Object.assign(node.parameters, { contentType: 'raw', rawContentType: 'application/x-www-form-urlencoded', body: '={{ $json.req.form }}' });
  }
  return Object.assign(node, { onError: 'continueRegularOutput' });
}

const nodes = [
  n.schedule('Every 15 minutes', '*/15 * * * *'),
  n.webhook('Check now', 'ks-switch-check', { respond: 'onReceived' }),
  n.code('Plan reads', `
const R = KS.requests;
const list = (t, o) => R.airtableList(AIRTABLE.baseId, AIRTABLE.tables[t], o);
const input = $input.first().json.body || {};
const isWebhook = !!$input.first().json.headers;
return [
  ['settings', list('settings', { maxRecords: 100 })],
  ['clients', list('clients', { formula: "FIND('resend.dev', {From email})", fields: ['Client ID', 'From email'], maxRecords: 100 })],
  ['heldProposals', list('auditIntakes', { formula: "{Status} = 'Proposal approved - waiting for email domain'", fields: ['Business name'], maxRecords: 20 })],
  ['demoClient', list('clients', { formula: "{Client ID} = 'KS-DEMO-01'", fields: ['Client ID', 'Business phone number'], maxRecords: 1 })],
].map(([key, req]) => ({ json: { key, input, isWebhook, req } }));`, { libs: L }),
  Object.assign(n.airtableHttp('Read Airtable', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Plan', `
const { opsmanager: O } = KS;
const plan = $('Plan reads').all();
const D = {};
$input.all().forEach((it, i) => { D[plan[i].json.key] = ((it.json.body || {}).records) || []; });
const S = O.settingsMap(D.settings);
const input = plan[0].json.input || {};
if (plan[0].json.isWebhook && (!S.agent_run_token || input.token !== S.agent_run_token)) return [{ json: { route: 4, note: 'refused' } }];
const ctx = { S: { twilio_account_sid: S.twilio_account_sid, sending_domain: S.sending_domain, sending_address: S.sending_address || 'hello', domain_status: S.domain_status, domain_resend_id: S.domain_resend_id, domain_registered_name: S.domain_registered_name, twilio_from: S.twilio_from, twilio_connected: S.twilio_connected, alert_sms_to: S.alert_sms_to, agent_run_token: S.agent_run_token },
  clients: D.clients.map((r) => r.id), held: D.heldProposals.map((r) => r.id), demo: D.demoClient[0] ? { id: D.demoClient[0].id, phone: D.demoClient[0].fields['Business phone number'] || '' } : null };
const domain = String(S.sending_domain || '').trim().toLowerCase().replace(/^https?:\\/\\//, '').replace(/^www\\./, '').replace(/\\/.*$/, '');
const out = [];
if (domain && /^[a-z0-9.-]+\\.[a-z]{2,}$/.test(domain)) {
  if (S.domain_registered_name !== domain || !S.domain_resend_id) out.push({ route: 0, ctx, domain, req: { url: 'https://api.resend.com/domains', method: 'POST', body: { name: domain, region: 'eu-west-1' } } });
  else if (S.domain_status !== 'Verified') out.push({ route: 1, ctx, domain, req: { url: 'https://api.resend.com/domains/' + S.domain_resend_id, method: 'GET' } });
}
// Domain cleared before it was verified: remove the registration from Resend and reset.
if (!domain && S.domain_resend_id && S.domain_status !== 'Verified') out.push({ route: 5, ctx, req: { url: 'https://api.resend.com/domains/' + S.domain_resend_id, method: 'DELETE' } });
const num = String(S.twilio_from || '').replace(/\\s+/g, '');
const sid = String(S.twilio_account_sid || '').trim();
const numbersReq = (pn) => ({ url: 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/IncomingPhoneNumbers.json?' + (pn ? 'PhoneNumber=' + encodeURIComponent(pn) : 'PageSize=1'), method: 'GET' });
if (input.probeTwilio && /^AC[0-9a-f]{32}$/.test(sid)) out.push({ route: 2, ctx, probe: true, sid, req: numbersReq(null) });
else if (/^[+][0-9]{8,15}$/.test(num) && S.twilio_connected !== num) {
  if (/^AC[0-9a-f]{32}$/.test(sid)) out.push({ route: 2, ctx, number: num, sid, req: numbersReq(num) });
  else if (S.twilio_connected !== 'needs account SID') out.push({ route: 3, needsSid: true, ctx });
}
return out.length ? out.map((x) => ({ json: x })) : [{ json: { route: 3, note: 'nothing to switch on' } }];`, { libs: L }),
  n.route('What to do?', 6),
  // ---- domain: register ----
  Object.assign(n.http('Resend: add domain', 'resend', { method: 'POST' }), { onError: 'continueRegularOutput' }),
  n.code('Domain added', `
const { requests: R } = KS;
const p = $('Plan').item.json;
const res = $json;
const ok = res.statusCode < 300 && res.body && res.body.id;
const recs = (ok && res.body.records) || [];
const set = ok ? { domain_resend_id: res.body.id, domain_registered_name: p.domain, domain_status: 'Waiting for DNS' } : { domain_status: 'Failed: ' + ((res.body && (res.body.message || res.body.name)) || res.statusCode) };
const table = recs.map((r) => r.record + ' | ' + r.type + ' | Name: ' + r.name + ' | Value: ' + r.value + (r.priority !== undefined ? ' | Priority: ' + r.priority : '') + (r.ttl ? ' | TTL: ' + r.ttl : '')).join('\\n');
const text = ok
  ? 'Your email domain ' + p.domain + ' is registered with Resend. Add these DNS records where you bought the domain (e.g. GoDaddy, Namecheap, 123-reg), in the DNS settings:\\n\\n' + table + '\\n\\nKeystone checks every 15 minutes. As soon as Resend confirms them (usually within an hour, up to 72), every Keystone email switches to ' + p.ctx.S.sending_address + '@' + p.domain + ' and any approved emails waiting for this are sent. Nothing else to do.'
  : 'I could not register ' + p.domain + ' with Resend: ' + set.domain_status + '. If the Resend key only has "sending access", either give it full access or add the domain yourself at resend.com/domains and put its ID in Keystone Settings > domain_resend_id (and the domain in domain_registered_name).';
return { json: { writes: [R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.settings, ['Setting'], Object.entries(set).map(([k, v]) => ({ 'Setting': k, 'Value': v }))))], notices: [{ kind: ok ? 'info' : 'failure', text }] } };`, { libs: L, mode: 'runOnceForEachItem' }),
  // ---- domain: check / verify ----
  Object.assign(n.http('Resend: domain status', 'resend', { method: 'GET', sendBody: false }), { onError: 'continueRegularOutput' }),
  n.code('Domain status', `
const { requests: R } = KS;
const p = $('Plan').item.json;
const res = $json;
const st = res.statusCode < 300 && res.body ? String(res.body.status || '') : 'unknown';
if (st === 'verified') {
  const from = 'Keystone <' + p.ctx.S.sending_address + '@' + p.domain + '>';
  const W = [R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.settings, ['Setting'], [{ 'Setting': 'email_from', 'Value': from }, { 'Setting': 'domain_status', 'Value': 'Verified' }]))];
  for (let i = 0; i < p.ctx.clients.length; i += 10) W.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.clients, p.ctx.clients.slice(i, i + 10).map((id) => ({ id, fields: { 'From email': from } })))));
  W.push(R.write.webhook('${BASE}/ks-agent-outreach', { release: true, token: p.ctx.S.agent_run_token }));
  for (const id of p.ctx.held) W.push(R.write.webhook('${BASE}/ks-agent-sales-prep', { stage: 'send_proposal', intakeId: id, token: p.ctx.S.agent_run_token }));
  return { json: { verify: false, writes: W, notices: [{ kind: 'info', text: 'Your email domain ' + p.domain + ' is verified. All Keystone emails now come from ' + from + '. ' + p.ctx.clients.length + ' client(s) moved to the new sender, approved outreach emails are being sent now' + (p.ctx.held.length ? ', and ' + p.ctx.held.length + ' approved proposal(s) are going out' : '') + '. Customers now receive their emails, the website calculator now emails verification codes to every visitor, and the Nurture sequence can send (once you tick Approved on its templates).' }] } };
}
const failed = st === 'failed' || st === 'temporary_failure';
const W = failed && p.ctx.S.domain_status !== 'Failed' ? [R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.settings, ['Setting'], [{ 'Setting': 'domain_status', 'Value': 'Failed' }]))] : [];
const notices = failed && p.ctx.S.domain_status !== 'Failed' ? [{ kind: 'failure', text: 'Resend could not verify ' + p.domain + ' yet (' + st + '). Check the DNS records match exactly (no extra quotes or doubled domain names). Keystone keeps checking.' }] : [];
// Ask Resend to (re)check DNS while it is still waiting.
return { json: { verify: ['not_started', 'pending', 'failed', 'temporary_failure'].includes(st), writes: W, notices, req: { url: 'https://api.resend.com/domains/' + p.ctx.S.domain_resend_id + '/verify', method: 'POST', body: {} } } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.iff('Ask Resend to verify?', 'verify'),
  Object.assign(n.http('Resend: verify', 'resend', { method: 'POST' }), { onError: 'continueRegularOutput' }),
  // ---- Twilio ----
  twilioHttp('Twilio: find number', 'GET'),
  n.code('Point number at Keystone', `
const p = $('Plan').item.json;
const res = $json;
if (!(res.statusCode < 300)) return { json: { ok: false, probe: !!p.probe, problem: 'Twilio login failed (' + res.statusCode + '): check the Account SID in Keystone Settings and the n8n "Twilio" credential' } };
const nums = (res.body && res.body.incoming_phone_numbers) || [];
if (p.probe) return { json: { ok: false, probe: true, problem: null, result: 'Twilio login OK; ' + nums.length + ' number(s) visible on page 1' } };
if (!nums.length) return { json: { ok: false, problem: 'The number ' + p.number + ' is not in your Twilio account.' } };
const form = ['VoiceUrl=' + encodeURIComponent('${BASE}/twilio/inbound-call'), 'VoiceMethod=POST', 'SmsUrl=' + encodeURIComponent('${BASE}/ks-ops-sms'), 'SmsMethod=POST'].join('&');
return { json: { ok: true, req: { url: 'https://api.twilio.com/2010-04-01/Accounts/' + p.sid + '/IncomingPhoneNumbers/' + nums[0].sid + '.json', method: 'POST', form } } };`, { mode: 'runOnceForEachItem' }),
  n.iff('Number found?', 'ok'),
  twilioHttp('Twilio: set webhooks', 'POST'),
  n.code('Twilio done', `
const { requests: R } = KS;
const p = $('Plan').item.json;
const prior = $json;
// Arrives here from: probe / login failure, number not found, or after setting the webhooks.
const fromSet = prior.statusCode !== undefined;
if (fromSet && prior.statusCode < 300) {
  const W = [R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.settings, ['Setting'], [{ 'Setting': 'twilio_connected', 'Value': p.number }]))];
  // The demo client uses Keystone's own number for the live test call (only if it still has a placeholder).
  if (p.ctx.demo && (!p.ctx.demo.phone || /^\\+?447700900/.test(p.ctx.demo.phone.replace(/\\s/g, '')))) W.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.clients, [{ id: p.ctx.demo.id, fields: { 'Business phone number': p.number } }])));
  return { json: { writes: W, notices: [{ kind: 'info', text: 'Twilio number ' + p.number + ' is connected: calls go to the Keystone phone menu (IVR) and texts go to the Ops Manager, so you can reply YES/NO by SMS.' + (p.ctx.S.alert_sms_to ? ' SMS alerts are now on.' : ' Last step: put your mobile in Keystone Settings > alert_sms_to to switch SMS alerts on.') + ' Then do the test call in docs/PHONE_LIVE_TEST.md.' }] } };
}
if (prior.probe) return { json: { writes: [], notices: [], result: prior.result || prior.problem } };
const problem = fromSet ? 'Twilio refused to update the number (' + prior.statusCode + ')' : prior.problem;
return { json: { writes: [], notices: [{ kind: 'failure', text: 'Could not connect your Twilio number ' + (p.number || '') + ': ' + problem + '. I will try again in 15 minutes.' }] } };`, { libs: L, mode: 'runOnceForEachItem' }),
  Object.assign(n.http('Resend: remove domain', 'resend', { method: 'DELETE', sendBody: false }), { onError: 'continueRegularOutput' }),
  n.code('Domain removed', `
const { requests: R } = KS;
const ok = $json.statusCode < 300 || $json.statusCode === 404;
return { json: { writes: ok ? [R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.settings, ['Setting'], ['domain_resend_id', 'domain_registered_name', 'domain_status'].map((k) => ({ 'Setting': k, 'Value': '' }))))] : [], notices: ok ? [] : [{ kind: 'failure', text: 'Could not remove the old domain from Resend (' + $json.statusCode + ').' }] } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.code('Collect notices', `
const out = [];
for (const it of $input.all()) for (const x of (it.json.notices || [])) out.push({ json: x });
return out;`),
  n.notify('Tell Bilal'),
  n.code('Nothing to do', `
const { requests: R } = KS;
const x = $input.first().json;
if (!x.needsSid) return [{ json: { writes: [], notices: [] } }];
return [{ json: { writes: [R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.settings, ['Setting'], [{ 'Setting': 'twilio_connected', 'Value': 'needs account SID' }]))],
  notices: [{ kind: 'info', text: 'One more Twilio detail: copy your Account SID (starts with AC, shown on the Twilio console home page next to the auth token) into Keystone Settings > twilio_account_sid. Then your number connects automatically within 15 minutes.' }] } }];`, { libs: L }),
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['Every 15 minutes', 'Plan reads'], ['Check now', 'Plan reads'], ['Plan reads', 'Read Airtable'], ['Read Airtable', 'Plan'], ['Plan', 'What to do?'],
  ['What to do?', 'Resend: add domain', 0], ['Resend: add domain', 'Domain added'], ['Domain added', 'Fan out writes'], ['Domain added', 'Collect notices'],
  ['What to do?', 'Resend: domain status', 1], ['Resend: domain status', 'Domain status'], ['Domain status', 'Fan out writes'], ['Domain status', 'Collect notices'],
  ['Domain status', 'Ask Resend to verify?'], ['Ask Resend to verify?', 'Resend: verify', 0],
  ['What to do?', 'Twilio: find number', 2], ['Twilio: find number', 'Point number at Keystone'],
  ['Point number at Keystone', 'Number found?'], ['Number found?', 'Twilio: set webhooks', 0], ['Number found?', 'Twilio done', 1], ['Twilio: set webhooks', 'Twilio done'],
  ['Twilio done', 'Fan out writes'], ['Twilio done', 'Collect notices'], ['Collect notices', 'Tell Bilal'],
  ['What to do?', 'Nothing to do', 3], ['What to do?', 'Nothing to do', 4], ['Nothing to do', 'Fan out writes'], ['Nothing to do', 'Collect notices'],
  ['What to do?', 'Resend: remove domain', 5], ['Resend: remove domain', 'Domain removed'], ['Domain removed', 'Fan out writes'], ['Domain removed', 'Collect notices'], ...tail.edges,
];
module.exports = n.workflow('KS Switch-On', nodes, edges, { tags: ['keystone', 'ops', 'go-live'] });
