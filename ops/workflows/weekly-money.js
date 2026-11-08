'use strict';
// KS Weekly Money + Client Dashboard.
//  Monday 07:15: for every Active client with Reporting on -> Xero P&L, cash, money owed (demo figures if no real Xero)
//  + last week's Keystone activity -> Client Metrics row -> plain-English email (Claude, with a safe fallback).
//  GET /webhook/ks-dashboard?c=CLIENT_ID&t=DASHBOARD_TOKEN -> that client's dashboard only.
const n = require('../scripts/n8n');
const L = ['reporting', 'render', 'registry', 'requests', 'log', 'agent', 'time'];
const BASE = 'https://keystoneconsultancy.app.n8n.cloud/webhook';
const ctx = "$('One item per client').item.json";
const listOf = "(($json.body || {}).records || [])";

const nodes = [
  n.schedule('Monday 07:15', '15 7 * * 1'),
  n.webhook('Run weekly money now', 'ks-weekly-money-now', { respond: 'onReceived' }),
  n.code('Prepare client query', `
const only = ($input.first().json.body || {}).clientId;
const f = "AND({Status}='Active', {Reporting on}" + (only ? ', {Client ID} = ' + KS.log.formulaString(only) : '') + ')';
return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clients, { formula: f, maxRecords: 100 }) } }];`, { libs: L }),
  n.airtableHttp('Get clients', 'GET'),
  n.code('One item per client', `
const { registry: Rg, requests: R, time: T } = KS;
const r = $input.first().json;
if (!R.ok(r)) throw new Error('Weekly money: could not read My Clients (' + r.statusCode + ')');
const today = T.localParts(new Date(), 'Europe/London');
const dow = ['sun','mon','tue','wed','thu','fri','sat'].indexOf(today.weekday);
const weekEnd = T.addDaysStr(today.dateStr, -((dow + 6) % 7)); // this Monday
const weekStart = T.addDaysStr(weekEnd, -7);
return (r.body.records || []).map((rec) => { const client = Rg.normalizeClient(rec); return { json: { client, weekStart, weekEnd, prevWeekStart: T.addDaysStr(weekStart, -7), realXero: R.useRealXero(client) } }; });`, { libs: L }),
  n.iff('Real Xero?', 'realXero'),
  n.code('P&L request', `const c = $json; return { json: { ...c, req: KS.requests.xero(c.client, 'GET', 'Reports/ProfitAndLoss?fromDate=' + c.weekStart + '&toDate=' + KS.time.addDaysStr(c.weekEnd, -1)) } };`, { libs: L, mode: 'runOnceForEachItem' }),
  Object.assign(n.xeroHttp('Xero P&L', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Bank request', `const c = ${ctx}; return { json: { req: KS.requests.xero(c.client, 'GET', 'Reports/BankSummary?fromDate=' + c.weekStart + '&toDate=' + KS.time.addDaysStr(c.weekEnd, -1)) } };`, { libs: L, mode: 'runOnceForEachItem' }),
  Object.assign(n.xeroHttp('Xero bank summary', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Invoices request', `const c = ${ctx}; return { json: { req: KS.requests.xero(c.client, 'GET', 'Invoices?Statuses=AUTHORISED&where=' + encodeURIComponent('Type=="ACCREC"')) } };`, { libs: L, mode: 'runOnceForEachItem' }),
  Object.assign(n.xeroHttp('Xero money owed', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Xero figures', `
const { reporting: Rp, requests: R } = KS;
const c = ${ctx};
const pl = $('Xero P&L').item.json, bank = $('Xero bank summary').item.json, inv = $json;
const errs = [['P&L', pl], ['bank', bank], ['invoices', inv]].filter(([, x]) => !R.ok(x)).map(([k, x]) => k + ' ' + x.statusCode);
const p = R.ok(pl) ? Rp.parseProfitAndLoss(pl.body) : { revenue: null, costs: null, netProfit: null };
const b = R.ok(bank) ? Rp.parseBankSummary(bank.body) : { cash: null };
const rc = R.ok(inv) ? Rp.parseReceivables(inv.body.Invoices || []) : { receivables: null, overdueCount: null, overdueValue: null, topOverdue: [] };
return { json: { ...c, fin: { ...p, ...b, ...rc }, source: 'xero', xeroErrors: errs } };`, { libs: L, mode: 'runOnceForEachItem' }),
  n.code('Demo figures', `return { json: { ...$json, fin: KS.reporting.demoFinancials($json.client.clientId, $json.weekStart), source: 'demo', xeroErrors: [] } };`, { libs: L, mode: 'runOnceForEachItem' }),
  // ---- activity + last week ----
  n.code('Activity request', `
const c = $json;
const f = 'AND({Client ID} = ' + KS.log.formulaString(c.client.clientId) + ", IS_AFTER({Timestamp}, '" + c.weekStart + "T00:00:00Z'), IS_BEFORE({Timestamp}, '" + c.weekEnd + "T00:00:00Z'))";
return { json: { ...c, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.agentLog, { formula: f, maxRecords: 100 }) } };`, { libs: L, mode: 'runOnceForEachItem' }),
  Object.assign(n.airtableHttp('Get week activity', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Last week request', `
const c = $('Activity request').item.json;
return { json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clientMetrics, { formula: '{Period} = ' + KS.log.formulaString(c.client.clientId + ' ' + c.prevWeekStart), maxRecords: 1 }) } };`, { libs: L, mode: 'runOnceForEachItem' }),
  Object.assign(n.airtableHttp('Get last week', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Build metrics', `
const { reporting: Rp, agent: A } = KS;
const c = $('Activity request').item.json;
const logs = (($('Get week activity').item.json.body || {}).records || []).map((r) => r.fields);
const ev = (r) => String(r.Event || ''), out = (r) => (r.Outcome && r.Outcome.name) || r.Outcome;
const activity = {
  invoicesDrafted: logs.filter((r) => ev(r).startsWith('invoice_') && out(r) === 'Draft created').length,
  callsHandled: logs.filter((r) => ev(r) === 'call_handled').length,
  bookingsMade: logs.filter((r) => ev(r) === 'booking_made' || ev(r) === 'reschedule').length,
  quotesIssued: logs.filter((r) => ev(r) === 'quote_drafted').length,
  minutesSaved: logs.reduce((s, r) => s + (Number(r['Minutes saved']) || 0), 0),
};
const prevRec = (($json.body || {}).records || [])[0];
const pf = prevRec ? prevRec.fields : null;
const prev = pf ? { revenue: pf['Revenue'], costs: pf['Costs'], netProfit: pf['Net profit'], cash: pf['Cash balance'], receivables: pf['Receivables'], overdueCount: pf['Overdue count'], overdueValue: pf['Overdue value'] } : null;
const f = c.fin;
const cur = { revenue: f.revenue, costs: f.costs, netProfit: f.netProfit, cash: f.cash, receivables: f.receivables, overdueCount: f.overdueCount, overdueValue: f.overdueValue, topOverdue: f.topOverdue };
const req = A.buildClaudeRequest({ system: Rp.EXPLAINER_SYSTEM, prompt: Rp.explainerPrompt(c.client, cur, prev, activity), schema: Rp.EXPLAINER_SCHEMA, effort: 'low', maxTokens: 3000 });
return { json: { ...c, cur, prev, activity, req: { url: req.url, method: 'POST', body: req.body } } };`, { libs: L, mode: 'runOnceForEachItem' }),
  Object.assign(n.claudeHttp('Explainer (Claude)'), { onError: 'continueRegularOutput' }),
  n.code('Weekly writes', `
const { reporting: Rp, render: Rn, registry: Rg, requests: R, agent: A, log: Lg } = KS;
const c = $('Build metrics').item.json;
const parsed = R.ok($json) ? A.parseClaudeJson($json.body) : { ok: false };
const cur = { ...c.cur };
for (const k of ['revenue', 'costs', 'netProfit', 'cash', 'receivables', 'overdueCount', 'overdueValue']) if (cur[k] === null || cur[k] === undefined) cur[k] = 0;
const x = parsed.ok ? parsed.data : Rp.fallbackExplainer(c.client, cur, c.prev);
const dash = c.client.dashboardToken ? '${BASE}/ks-dashboard?c=' + encodeURIComponent(c.client.clientId) + '&t=' + encodeURIComponent(c.client.dashboardToken) : null;
const to = Rg.safeRecipients(c.client, c.client.reporting.recipients.length ? c.client.reporting.recipients : [c.client.businessEmail]);
const W = [
  R.write.airtable(R.airtableUpsert(AIRTABLE.baseId, AIRTABLE.tables.clientMetrics, ['Period'], [{ 'Period': c.client.clientId + ' ' + c.weekStart, 'Client ID': c.client.clientId, 'Week starting': c.weekStart,
    'Revenue': cur.revenue, 'Costs': cur.costs, 'Net profit': cur.netProfit, 'Cash balance': cur.cash, 'Receivables': cur.receivables, 'Overdue count': cur.overdueCount, 'Overdue value': cur.overdueValue,
    'Invoices drafted': c.activity.invoicesDrafted, 'Calls handled': c.activity.callsHandled, 'Bookings made': c.activity.bookingsMade, 'Quotes issued': c.activity.quotesIssued, 'Data source': c.source, 'Explainer email': Rn.explainerText(x) }])),
  R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [Lg.logRecord({ clientId: c.client.clientId, service: 'reporting', event: 'weekly_report', outcome: 'Success', decision: 'Weekly money email ' + (parsed.ok ? '(AI explainer)' : '(fallback, AI unavailable)'), reasoning: (c.xeroErrors || []).length ? 'Xero problems: ' + c.xeroErrors.join(', ') : 'Data: ' + c.source, reference: c.weekStart, workflow: 'KS Weekly Money', executionId: $execution.id })])),
];
if (to.length) W.push(R.write.email(R.email({ from: R.EMAIL_FROM, to, subject: x.subject, html: Rn.explainerEmail(c.client, x, dash), text: Rn.explainerText(x) + (dash ? '\\n\\nDashboard: ' + dash : '') })));
return { json: { clientId: c.client.clientId, subject: x.subject, aiUsed: parsed.ok, writes: W } };`, { libs: L, mode: 'runOnceForEachItem' }),

  // ---- dashboard ----
  n.webhook('Dashboard page', 'ks-dashboard', { method: 'GET' }),
  n.code('Dashboard: client query', `
const q = $json.query || {};
return [{ json: { q, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clients, { formula: '{Client ID} = ' + KS.log.formulaString(q.c || ''), maxRecords: 2 }) } }];`, { libs: L }),
  n.airtableHttp('Dashboard: get client', 'GET'),
  n.code('Dashboard: check token', `
const { registry: Rg } = KS;
const q = $('Dashboard: client query').first().json.q;
const { client } = Rg.resolveClient(${listOf}, { clientId: q.c });
const ok = !!(client && client.dashboardToken && q.t === client.dashboardToken && client.status === 'Active');
return [{ json: { ok, client, req: ok ? KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clientMetrics, { formula: '{Client ID} = ' + KS.log.formulaString(client.clientId), maxRecords: 12, sort: [{ field: 'Week starting', direction: 'desc' }] }) : null, statusCode: 403, html: '<!doctype html><p style="font-family:Arial;padding:40px">This dashboard link is not valid.</p>' } }];`, { libs: L }),
  n.iff('Dashboard: allowed?', 'ok'),
  n.airtableHttp('Dashboard: get metrics', 'GET'),
  n.code('Dashboard: render', `
const { render: Rn } = KS;
const c = $('Dashboard: check token').first().json.client;
const rows = (($json.body || {}).records || []).map((r) => r.fields).filter((r) => r['Client ID'] === c.clientId);
const html = rows.length ? Rn.dashboardHtml(c, rows) : Rn.shell(c, c.clientName + ' dashboard', '<h2>' + c.clientName + '</h2><p>Your first weekly figures will appear here after Monday morning.</p>');
return [{ json: { statusCode: 200, html } }];`, { libs: L }),
  n.respond('Dashboard: respond', 'html'),
  n.respond('Dashboard: refused', 'html'),
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['Monday 07:15', 'Prepare client query'], ['Run weekly money now', 'Prepare client query'], ['Prepare client query', 'Get clients'], ['Get clients', 'One item per client'],
  ['One item per client', 'Real Xero?'], ['Real Xero?', 'P&L request', 0], ['Real Xero?', 'Demo figures', 1],
  ['P&L request', 'Xero P&L'], ['Xero P&L', 'Bank request'], ['Bank request', 'Xero bank summary'], ['Xero bank summary', 'Invoices request'], ['Invoices request', 'Xero money owed'], ['Xero money owed', 'Xero figures'],
  ['Xero figures', 'Activity request'], ['Demo figures', 'Activity request'], ['Activity request', 'Get week activity'], ['Get week activity', 'Last week request'], ['Last week request', 'Get last week'],
  ['Get last week', 'Build metrics'], ['Build metrics', 'Explainer (Claude)'], ['Explainer (Claude)', 'Weekly writes'], ['Weekly writes', 'Fan out writes'], ...tail.edges,
  ['Dashboard page', 'Dashboard: client query'], ['Dashboard: client query', 'Dashboard: get client'], ['Dashboard: get client', 'Dashboard: check token'], ['Dashboard: check token', 'Dashboard: allowed?'],
  ['Dashboard: allowed?', 'Dashboard: get metrics', 0], ['Dashboard: allowed?', 'Dashboard: refused', 1], ['Dashboard: get metrics', 'Dashboard: render'], ['Dashboard: render', 'Dashboard: respond'],
];
module.exports = n.workflow('KS Weekly Money + Dashboard', nodes, edges, { tags: ['keystone', 'reporting'] });
