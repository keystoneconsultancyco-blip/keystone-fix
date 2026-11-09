'use strict';
// KS Agent Switch: POST /webhook/ks-switch-agent {slug, on: true|false, token}. Used when Bilal says YES to a
// "switch on the X agent" approval from the Chief of Staff. Sets the Agents row to Live (or Paused) and
// switches the agent's n8n workflow on (or off). Token-protected.
const n = require('../scripts/n8n');
const L = ['opsmanager', 'requests', 'log', 'agentteam'];

const nodes = [
  n.webhook('Switch request', 'ks-switch-agent', { respond: 'responseNode' }),
  n.code('Read request', `return [{ json: { input: $input.first().json.body || {}, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 100 }) } }];`, { libs: L }),
  n.airtableHttp('Get settings', 'GET'),
  n.code('Agents request', `
const S = KS.opsmanager.settingsMap(($json.body || {}).records);
const x = $('Read request').first().json.input;
const ok = !!S.agent_run_token && x.token === S.agent_run_token && /^[a-z-]+$/.test(x.slug || '');
return [{ json: { ok, x, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.agents, { formula: '{Slug} = ' + KS.log.formulaString(x.slug || 'none'), maxRecords: 1 }) } }];`, { libs: L }),
  n.airtableHttp('Get agent', 'GET'),
  n.code('Decide', `
const { requests: R, agentteam: T } = KS;
const a = $('Agents request').first().json;
const rec = (($json.body || {}).records || [])[0];
if (!a.ok) return [{ json: { route: 1, response: { ok: false, message: 'Not allowed.' } } }];
if (!rec) return [{ json: { route: 1, response: { ok: false, message: 'No agent called ' + a.x.slug + '.' } } }];
const on = a.x.on !== false;
const wfId = rec.fields['Workflow ID'];
const W = [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.agents, [{ id: rec.id, fields: { 'Status': on ? 'Live' : 'Paused' } }])),
  R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.teamLog, [T.logRow({ agent: a.x.slug, kind: 'Run', summary: (on ? 'Switched ON' : 'Paused') + ' by Bilal' + (a.x.approvalCode ? ' (approval #' + a.x.approvalCode + ')' : ''), executionId: $execution.id })]))];
return [{ json: { route: wfId ? 0 : 1, writes: W, req: wfId ? { url: 'https://keystoneconsultancy.app.n8n.cloud/api/v1/workflows/' + wfId + '/' + (on ? 'activate' : 'deactivate'), method: 'POST' } : null,
  response: { ok: true, message: rec.fields.Agent + ' is now ' + (on ? 'switched on' : 'paused') + '.' } } }];`, { libs: L }),
  n.route('Has workflow?', 2),
  Object.assign(n.http('Switch n8n workflow', 'n8n', { method: 'POST', sendBody: false }), { onError: 'continueRegularOutput' }),
  n.code('Result', `
const d = $('Decide').first().json;
const r = $input.first().json;
const fine = !r.statusCode || r.statusCode < 300;
return [{ json: { writes: d.writes || [], response: fine ? d.response : { ok: false, message: 'Agent marked ' + (d.response.message || '') + ' but n8n refused to switch the workflow (' + r.statusCode + '). Switch it on in n8n.' } } }];`),
  n.respond('Reply'),
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['Switch request', 'Read request'], ['Read request', 'Get settings'], ['Get settings', 'Agents request'], ['Agents request', 'Get agent'], ['Get agent', 'Decide'],
  ['Decide', 'Has workflow?'], ['Has workflow?', 'Switch n8n workflow', 0], ['Has workflow?', 'Result', 1], ['Switch n8n workflow', 'Result'], ['Result', 'Reply'], ['Reply', 'Fan out writes'], ...tail.edges,
];
module.exports = n.workflow('KS Agent Switch', nodes, edges, { tags: ['keystone', 'agent'] });
