'use strict';
// KS Jarvis Feed: GET /webhook/ks-jarvis-feed with header x-keystone-token (or ?t=) = Keystone Settings jarvis_feed_token.
// Returns everything the Jarvis agent pages show: per agent its role, goal, progress, today/this week, items awaiting
// Bilal's approval, errors and AI cost; plus the AI budget. Read-only.
const n = require('../scripts/n8n');
const L = ['agentteam', 'opsmanager', 'requests', 'log'];

const nodes = [
  n.webhook('Feed request', 'ks-jarvis-feed', { method: 'GET' }),
  n.code('Plan reads', `
const R = KS.requests;
const list = (t, o) => R.airtableList(AIRTABLE.baseId, AIRTABLE.tables[t], o);
const w = $input.first().json;
const token = (w.headers || {})['x-keystone-token'] || (w.query || {}).t || '';
return [
  ['settings', list('settings', { maxRecords: 100 })],
  ['agents', list('agents', { maxRecords: 50 })],
  ['log', list('teamLog', { formula: "IS_AFTER({Timestamp}, DATEADD(NOW(), -7, 'days'))", fields: ['Agent', 'Kind', 'Summary', 'Timestamp'], maxRecords: 100, sort: [{ field: 'Timestamp', direction: 'desc' }] })],
  ['approvals', list('opsApprovals', { formula: "{Status} = 'Pending'", fields: ['Code', 'Type', 'Summary', 'Created', 'Status', 'Reply token'], maxRecords: 50 })],
  ['clients', list('clients', { formula: "AND({Status} = 'Active', NOT({Is demo/test}))", fields: ['Client ID'], maxRecords: 100 })],
].map(([key, req]) => ({ json: { key, token, req } }));`, { libs: L }),
  Object.assign(n.airtableHttp('Read Airtable', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Build feed', `
const { agentteam: T, opsmanager: O } = KS;
const plan = $('Plan reads').all();
const D = {};
$input.all().forEach((it, i) => { D[plan[i].json.key] = ((it.json.body || {}).records) || []; });
const S = O.settingsMap(D.settings);
if (!S.jarvis_feed_token || plan[0].json.token !== S.jarvis_feed_token) return [{ json: { statusCode: 403, response: { ok: false, error: 'Not allowed' } } }];
const feed = T.buildFeed({ agents: D.agents, log: D.log, approvals: D.approvals, settings: S, activeClients: D.clients.length });
return [{ json: { statusCode: 200, response: { ok: true, ...feed } } }];`, { libs: L }),
  Object.assign(n.respond('Reply'), { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json.response) }}', options: { responseCode: '={{ $json.statusCode }}' } } }),
];
const edges = [['Feed request', 'Plan reads'], ['Plan reads', 'Read Airtable'], ['Read Airtable', 'Build feed'], ['Build feed', 'Reply']];
module.exports = n.workflow('KS Jarvis Feed', nodes, edges, { tags: ['keystone', 'agent', 'jarvis'] });
