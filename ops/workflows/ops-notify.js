'use strict';
// KS Ops - Notify: private sub-workflow (no public URL). Other workflows call it with
// { kind, clientId, clientName, text, audience: 'bilal'|'business'|'both', business: {email, sms, isDemo}, approval? }.
// Picks SMS or email from Keystone Settings (SMS once twilio_from is filled) and creates the YES/NO approval row.
const n = require('../scripts/n8n');
const L = ['opsmanager', 'requests', 'log', 'registry', 'onboarding'];
const BASE = 'https://keystoneconsultancy.app.n8n.cloud/webhook';

const nodes = [];
const trigger = { name: 'Called by a Keystone workflow', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, parameters: { inputSource: 'passthrough' } };
nodes.push(trigger,
  n.code('Prepare settings lookup', `
return [{ json: { input: $input.first().json, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 50 }) } }];`, { libs: L }),
  Object.assign(n.airtableHttp('Get settings', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Build notices', `
const { opsmanager: O, requests: R, log: Lg, registry: Rg, onboarding: Ob } = KS;
const S = O.settingsMap(($json.body || {}).records || []);
const ch = O.channels(S);
const x = $('Prepare settings lookup').first().json.input || {};
const audience = x.audience || 'bilal';
const from = S.email_from || R.EMAIL_FROM;
const W = [];
let code = null, links = null;
if (x.approval && x.approval.type) {
  code = O.approvalCode();
  const token = Ob.randomToken(24);
  links = { code, yes: '${BASE}/ks-ops-reply?c=' + code + '&a=yes&t=' + token, no: '${BASE}/ks-ops-reply?c=' + code + '&a=no&t=' + token };
  W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.opsApprovals, [{ 'Code': code, 'Type': x.approval.type, 'Client ID': x.clientId || '', 'Ref': x.approval.ref || '', 'Summary': x.approval.summary || x.text || '', 'Status': 'Pending', 'Action JSON': JSON.stringify(x.approval.action || {}), 'Reply token': token, 'Created': new Date().toISOString() }])));
}
const subject = '[Keystone] ' + (O.KIND_LABEL[x.kind] || 'Update') + (x.clientName ? ' - ' + x.clientName : '') + (code ? ' (#' + code + ')' : '');
if (audience === 'bilal' || audience === 'both') {
  if (ch.email) W.push(R.write.email(R.email({ from, to: (S.alert_email || Lg.OPS_EMAIL).split(',').map((s) => s.trim()).filter(Boolean), subject, html: O.emailHtml(x, links), text: (x.text || '') + (links ? '\\n\\nYES: ' + links.yes + '\\nNO: ' + links.no : '') })));
  if (ch.sms) W.push(R.write.sms(S.twilio_from, S.alert_sms_to, O.smsText(x, code)));
}
if ((audience === 'business' || audience === 'both') && x.business) {
  const to = Rg.safeRecipients({ isDemo: !!x.business.isDemo }, [x.business.email]);
  if (to.length) W.push(R.write.email(R.email({ from, to, subject, html: O.emailHtml({ ...x, text: x.businessText || x.text }, null), text: x.businessText || x.text })));
  const smsTo = x.business.isDemo ? S.alert_sms_to : x.business.sms;
  if (ch.smsReady && smsTo) W.push(R.write.sms(S.twilio_from, smsTo, O.smsText({ ...x, text: x.businessText || x.text }, null)));
}
return [{ json: { ok: true, code, channels: ch, sent: W.map((w) => w.kind), writes: W } }];`, { libs: L }),
);
const tail = n.writesTail();
nodes.push(...tail.nodes);
nodes.push(n.code('Return result', `return [{ json: { ok: true, code: $('Build notices').first().json.code, sent: $('Build notices').first().json.sent } }];`));
const edges = [
  ['Called by a Keystone workflow', 'Prepare settings lookup'], ['Prepare settings lookup', 'Get settings'], ['Get settings', 'Build notices'], ['Build notices', 'Fan out writes'], ...tail.edges,
  ['Build notices', 'Return result'],
];
module.exports = n.workflow('KS Ops - Notify', nodes, edges, { tags: ['keystone', 'ops'] });
