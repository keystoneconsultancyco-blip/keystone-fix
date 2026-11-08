'use strict';
// KS Ops - Failure Alerts. Set as the "Error workflow" on EVERY workflow (existing and new).
// On any failure: works out the client, explains it in plain English, says whether a
// customer/call was affected, then SMS (Twilio) + email (Resend) + Agent Log row.
const n = require('../scripts/n8n');
const L = ['alerts', 'requests', 'log', 'registry'];

const settingsMap = `
const rows = ($('Get settings').first().json.body || {}).records || [];
const S = {}; for (const r of rows) S[r.fields.Setting] = (r.fields.Value || '').trim();`;

const nodes = [
  n.errorTrigger('On workflow failure'),
  n.code('Prepare execution lookup', `
const p = $input.first().json;
const id = p.execution && p.execution.id;
return [{ json: { payload: p, req: { url: 'https://keystoneconsultancy.app.n8n.cloud/api/v1/executions/' + (id || '0') + '?includeData=true' } } }];`),
  Object.assign(n.http('Get failed execution', 'n8n', { method: 'GET', sendBody: false }), { onError: 'continueRegularOutput' }),
  n.code('Prepare settings query', `
return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 50 }) } }];`, { libs: L }),
  Object.assign(n.airtableHttp('Get settings', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Prepare client query', `
const ex = $('Get failed execution').first().json;
const found = KS.alerts.findClientId(ex && ex.body ? ex.body.data : null);
const formula = found.clientId ? '{Client ID} = ' + KS.log.formulaString(found.clientId) : 'FALSE()';
return [{ json: { clientId: found.clientId, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clients, { formula, maxRecords: 1 }) } }];`, { libs: L }),
  Object.assign(n.airtableHttp('Get client', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Build alerts', `
const { alerts: Al, requests: R, log: Lg } = KS;
${settingsMap}
const payload = $('Prepare execution lookup').first().json.payload;
const clientId = $('Prepare client query').first().json.clientId;
const rec = (($json.body || {}).records || [])[0];
const clientName = rec ? rec.fields['Client name'] : '';
const a = Al.buildAlert(payload, { clientId, clientName });
const wfName = (payload.workflow && payload.workflow.name) || 'unknown';
const t = Al.throttle($getWorkflowStaticData('global'), wfName + '|' + a.message.slice(0, 80), new Date(), { smsEveryMins: Number(S.sms_repeat_minutes) || 30, emailEveryMins: 10 });
const writes = [];
const to = (S.alert_email || Lg.OPS_EMAIL).split(',').map((x) => x.trim()).filter(Boolean);
const from = S.email_from || R.EMAIL_FROM;
if (t.sendEmail) writes.push(R.write.email(R.email({ from, to, subject: a.subject + (t.repeats ? ' (+' + t.repeats + ' repeats)' : ''), html: a.html, text: a.text })));
if (t.sendSms && S.alert_sms_to && S.twilio_from) writes.push(R.write.sms(S.twilio_from, S.alert_sms_to, a.sms));
writes.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [Lg.logRecord({ clientId: a.clientId || '', service: 'monitor', event: 'workflow_failed', outcome: 'Escalated', decision: 'Alert ' + (t.sendSms && S.alert_sms_to ? 'SMS+email' : t.sendEmail ? 'email' : 'suppressed (repeat)'), reasoning: a.plain + ' | ' + a.message, reference: a.workflow, workflow: 'KS Ops - Failure Alerts', executionId: a.executionId, details: { level: a.level, customerAffected: a.customerAffected, url: a.url } })])));
return [{ json: { alert: a, smsConfigured: !!(S.alert_sms_to && S.twilio_from), throttle: t, writes } }];`, { libs: L }),
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['On workflow failure', 'Prepare execution lookup'], ['Prepare execution lookup', 'Get failed execution'], ['Get failed execution', 'Prepare settings query'],
  ['Prepare settings query', 'Get settings'], ['Get settings', 'Prepare client query'], ['Prepare client query', 'Get client'], ['Get client', 'Build alerts'],
  ['Build alerts', 'Fan out writes'], ...tail.edges,
];
module.exports = n.workflow('KS Ops - Failure Alerts', nodes, edges, { errorWorkflow: false, tags: ['keystone', 'ops'] });
