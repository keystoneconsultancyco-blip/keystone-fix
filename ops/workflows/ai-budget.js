'use strict';
// KS AI Budget: every 30 minutes, adds the new AI Usage rows to this month's running total (Keystone Settings
// ai_spend_usd), sets ai_status ok / warning / over, alerts Bilal once at 80% and once at 100% of the monthly
// credit, and re-runs queued non-urgent work (AI Queue) once there is room again (e.g. a new month).
// Counting uses a cursor (ai_spend_counted_until) so it never needs to read more than 100 rows at a time.
const n = require('../scripts/n8n');
const L = ['ai', 'opsmanager', 'requests', 'log'];
const list = (name) => `(($('${name}').first().json.body || {}).records || [])`;

const nodes = [
  n.schedule('Every 30 minutes', '*/30 * * * *'),
  n.webhook('Check now', 'ks-ai-budget-now', { respond: 'onReceived' }),
  n.code('Settings request', `return [{ json: { input: $input.first().json.body || {}, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 100 }) } }];`, { libs: L }),
  n.airtableHttp('Get settings', 'GET'),
  n.code('Usage request', `
const { opsmanager: O, ai: AI, requests: R, log: Lg } = KS;
if ($json.statusCode >= 300) throw new Error('AI budget: could not read Keystone Settings (' + $json.statusCode + ')');
const S = O.settingsMap($json.body.records);
const month = AI.monthKey();
// New month: start counting from the 1st.
const from = S.ai_spend_month === month && S.ai_spend_counted_until ? S.ai_spend_counted_until : month + '-01T00:00:00.000Z';
return [{ json: { S, month, from, req: R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.aiUsage, { formula: "IS_AFTER({Timestamp}, '" + from + "')", fields: ['Timestamp', 'Cost USD', 'Agent'], maxRecords: 100, sort: [{ field: 'Timestamp', direction: 'asc' }] }) } }];`, { libs: L }),
  n.airtableHttp('Get new usage', 'GET'),
  n.code('Queue request', `return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.aiQueue, { formula: "{Status} = 'Waiting'", maxRecords: 10, sort: [{ field: 'Created', direction: 'asc' }] }) } }];`, { libs: L }),
  Object.assign(n.airtableHttp('Get queue', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Update budget', `
const { ai: AI, requests: R } = KS;
const x = $('Usage request').first().json;
const S = x.S;
const u = $('Get new usage').first().json;
if (u.statusCode >= 300) throw new Error('AI budget: could not read AI Usage (' + u.statusCode + ')');
const rows = (u.body.records || []).map((r) => r.fields);
const base = S.ai_spend_month === x.month ? (Number(S.ai_spend_usd) || 0) : 0;
const spent = AI.round4(base + rows.reduce((s, r) => s + (Number(r['Cost USD']) || 0), 0));
const until = rows.length ? rows[rows.length - 1].Timestamp : x.from;
const credit = Number(S.ai_monthly_credit_usd) || 0;
const b = AI.budgetStatus(spent, credit, S.ai_alert_pct);
const set = { ai_spend_month: x.month, ai_spend_usd: String(spent), ai_spend_counted_until: until, ai_status: b.status };
const alerts = AI.budgetAlerts({ ...S, ai_alert_80_sent: S.ai_spend_month === x.month ? S.ai_alert_80_sent : '', ai_alert_100_sent: S.ai_spend_month === x.month ? S.ai_alert_100_sent : '' }, b.status, b.pct, x.month);
for (const a of alerts) set[a.key] = x.month;
const W = [R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.settings, ['Setting'], Object.entries(set).map(([k, v]) => ({ 'Setting': k, 'Value': v }))))];
const notices = alerts.map((a) => ({ kind: 'failure', text: a.level >= 100
  ? 'AI credit used up: $' + spent + ' of your $' + credit + ' monthly Claude credit is spent. Non-urgent agent work (research, outreach drafts, briefs, reports) is now queued and will run when there is room. Phone, quotes and invoices keep working. To carry on now, raise ai_monthly_credit_usd in Keystone Settings.'
  : 'AI credit at ' + b.pct + '%: $' + spent + ' of your $' + credit + ' monthly Claude credit is used. Nothing has stopped yet; non-urgent work is queued only at 100%.' }));
// Room again: re-run what was queued (each agent checks the budget again itself).
const queue = (($('Get queue').first().json.body || {}).records) || [];
if (b.status !== 'over') for (const q of queue) {
  let payload = {}; try { payload = JSON.parse(q.fields['Payload JSON'] || '{}'); } catch (e) { payload = {}; }
  if (q.fields['Retry webhook']) W.push(R.write.webhook(q.fields['Retry webhook'], { ...payload, token: S.agent_run_token, fromQueue: true }));
  W.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.aiQueue, [{ id: q.id, fields: { 'Status': 'Re-run', 'Done at': new Date().toISOString() } }])));
}
return [{ json: { spent, credit, pct: b.pct, status: b.status, newRows: rows.length, alerts: alerts.map((a) => a.level), requeued: b.status !== 'over' ? queue.length : 0, writes: W, notices } }];`, { libs: L }),
  n.code('Budget notices', `return ($json.notices || []).map((x) => ({ json: x }));`),
  n.notify('Tell Bilal'),
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['Every 30 minutes', 'Settings request'], ['Check now', 'Settings request'], ['Settings request', 'Get settings'], ['Get settings', 'Usage request'],
  ['Usage request', 'Get new usage'], ['Get new usage', 'Queue request'], ['Queue request', 'Get queue'], ['Get queue', 'Update budget'],
  ['Update budget', 'Fan out writes'], ['Update budget', 'Budget notices'], ['Budget notices', 'Tell Bilal'], ...tail.edges,
];
module.exports = n.workflow('KS AI Budget', nodes, edges, { tags: ['keystone', 'ops', 'ai'] });
