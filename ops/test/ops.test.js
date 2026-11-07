'use strict';
// Reporting, monitor, audit, onboarding, agent parsing and rendering.
const test = require('node:test');
const assert = require('node:assert/strict');
const Rep = require('../lib/reporting');
const M = require('../lib/monitor');
const Au = require('../lib/audit');
const O = require('../lib/onboarding');
const Ag = require('../lib/agent');
const Rn = require('../lib/render');
const R = require('../lib/registry');
const { DEMO_A, DEMO_B } = require('../fixtures/clients');
const A = R.normalizeClient({ fields: DEMO_A });

test('Xero P&L, bank summary and receivables parsing', () => {
  const pl = { Reports: [{ Rows: [
    { RowType: 'Section', Title: 'Income', Rows: [{ RowType: 'Row', Cells: [{ Value: 'Sales' }, { Value: '80000.00' }] }, { RowType: 'SummaryRow', Cells: [{ Value: 'Total Income' }, { Value: '80000.00' }] }] },
    { RowType: 'Section', Rows: [{ RowType: 'SummaryRow', Cells: [{ Value: 'Total Cost of Sales' }, { Value: '30000' }] }] },
    { RowType: 'Section', Rows: [{ RowType: 'SummaryRow', Cells: [{ Value: 'Total Operating Expenses' }, { Value: '35000' }] }] },
    { RowType: 'Section', Rows: [{ RowType: 'Row', Cells: [{ Value: 'Net Profit' }, { Value: '15000' }] }] },
  ] }] };
  assert.deepEqual(Rep.parseProfitAndLoss(pl), { revenue: 80000, costs: 65000, netProfit: 15000 });
  const bank = { Reports: [{ Rows: [{ RowType: 'Section', Rows: [{ RowType: 'Row', Cells: [{ Value: 'Business Account' }, { Value: '1' }, { Value: '2' }, { Value: '3' }, { Value: '120500' }] }, { RowType: 'SummaryRow', Cells: [{ Value: 'Total' }, { Value: '1' }, { Value: '2' }, { Value: '3' }, { Value: '120500' }] }] }] }] };
  assert.equal(Rep.parseBankSummary(bank).cash, 120500);
  const inv = [
    { Type: 'ACCREC', Status: 'AUTHORISED', AmountDue: 1000, DueDateString: '2026-10-01T00:00:00', InvoiceNumber: 'INV-1', Contact: { Name: 'A' } },
    { Type: 'ACCREC', Status: 'AUTHORISED', AmountDue: 500, DueDate: '/Date(1795000000000+0000)/' },
    { Type: 'ACCREC', Status: 'DRAFT', AmountDue: 999 },
    { Type: 'ACCPAY', Status: 'AUTHORISED', AmountDue: 777 },
  ];
  const r = Rep.parseReceivables(inv, new Date('2026-11-07'));
  assert.equal(r.receivables, 1500);
  assert.equal(r.overdueCount, 1);
  assert.equal(r.topOverdue[0].daysLate, 37);
});

test('activity counts are scoped to one client', () => {
  const logs = [
    { 'Client ID': 'KS-DEMO-01', Event: 'invoice_draft_created', Outcome: 'Draft created', Timestamp: '2026-11-03T10:00:00Z', 'Minutes saved': 12 },
    { 'Client ID': 'KS-DEMO-02', Event: 'invoice_draft_created', Outcome: 'Draft created', Timestamp: '2026-11-03T10:00:00Z', 'Minutes saved': 12 },
  ];
  const calls = [{ 'Client ID': 'KS-DEMO-01', Category: { name: 'Booking' }, Timestamp: '2026-11-04T10:00:00Z' }, { 'Client ID': 'KS-DEMO-02', Category: 'Urgent', Timestamp: '2026-11-04T10:00:00Z' }];
  const c = Rep.activityCounts({ agentLog: logs, callLog: calls, quotes: [] }, '2026-11-02', '2026-11-09', 'KS-DEMO-01');
  assert.equal(c.invoicesDrafted, 1);
  assert.equal(c.bookingsMade, 1);
  assert.equal(c.urgentCalls, 0);
  assert.equal(c.minutesSaved, 12);
});

test('demo financials are deterministic and realistic', () => {
  const a = Rep.demoFinancials('KS-DEMO-01', '2026-11-02');
  assert.deepEqual(a, Rep.demoFinancials('KS-DEMO-01', '2026-11-02'));
  assert.ok(a.revenue > 60000 && a.revenue < 100000);
  assert.equal(a.netProfit, a.revenue - a.costs);
});

test('fallback explainer has no jargon and gives actions', () => {
  const x = Rep.fallbackExplainer(A, Rep.demoFinancials('KS-DEMO-01', '2026-11-02'), Rep.demoFinancials('KS-DEMO-01', '2026-10-26'));
  assert.doesNotMatch(JSON.stringify(x), /receivable|accrual|EBITDA/i);
  assert.ok(x.actions.length >= 1 && x.actions.length <= 3);
});

test('monitor: approved fixes only; never auto-fix revoked auth or guardrails', () => {
  const fixes = M.fixesFromRows(M.DEFAULT_FIXES);
  assert.equal(M.classifyError({ message: 'connect ETIMEDOUT 1.2.3.4:443' }, fixes).action, 'retry_once');
  assert.equal(M.classifyError({ message: 'Request failed with status code 503' }, fixes).action, 'retry_once');
  assert.equal(M.classifyError({ message: 'connect ETIMEDOUT' }, fixes, 1).action, 'escalate');
  assert.equal(M.classifyError({ message: 'OUT_OF_WINDOW invoice for J-1' }, fixes).action, 'requeue_invoice');
  assert.equal(M.classifyError({ message: 'Xero 401 token expired' }, fixes).action, 'refresh_token');
  assert.equal(M.classifyError({ message: 'invalid_grant: refresh token expired' }, fixes).action, 'escalate');
  assert.equal(M.classifyError({ message: 'KEYSTONE GUARDRAIL: invoice status must be DRAFT' }, fixes).action, 'escalate');
  assert.equal(M.classifyError({ message: 'Cannot read properties of undefined' }, fixes).action, 'escalate');
  const disabled = M.fixesFromRows([{ ...M.DEFAULT_FIXES[0], Enabled: false }, { 'Fix key': 'bad', Enabled: true, Action: 'delete_everything', 'Error pattern': '.*' }]);
  assert.equal(disabled.length, 0);
  assert.equal(M.clientIdFromText('Job J-1 for KS-DEMO-01 failed'), 'KS-DEMO-01');
});

test('daily health line and value report', () => {
  const clients = [A, R.normalizeClient({ fields: { ...DEMO_B, Status: 'Stopped' } })];
  const line = M.dailyHealthLine(clients, [{ Outcome: 'Escalated', 'Client ID': 'KS-DEMO-01' }, { Outcome: 'Auto-fixed' }, { Outcome: 'Success' }], new Date('2026-11-07T07:00:00Z'));
  assert.equal(line, 'ATTENTION 2026-11-07: 1 active client · 3 actions logged · 1 auto-fixed · 0 in Needs Review · 1 need you (KS-DEMO-01: 1)');
  const v = M.valueReport(A, { invoicesDrafted: 19, invoicesToReview: 2, callsHandled: 47, bookingsMade: 22, urgentCalls: 3, quotesIssued: 6, issuesAutoFixed: 1, minutesSaved: 900 }, 'November 2026');
  assert.equal(v.hoursSaved, 15);
  assert.equal(v.valueOfTime, 420);
  assert.match(Rn.valueReportEmail(A, v), /15 hours/);
});

test('halal screen', () => {
  assert.equal(Au.halalScreen('Plumbing and heating').pass, true);
  assert.equal(Au.halalScreen('Craft brewery and taproom').pass, false);
  assert.equal(Au.halalScreen('Online casino affiliate').pass, false);
  assert.equal(Au.halalScreen('Payday loans').pass, false);
  assert.equal(Au.halalScreen('Birmingham electrical contractor').pass, true);
  assert.equal(Au.halalScreen('Italian restaurant').needsManualCheck, true);
});

test('audit diagnosis covers pillars with explicit numbers and recommends services', () => {
  const answers = { avg_job_value: 450, invoices_per_month: 120, days_to_invoice: 6, avg_days_to_pay: 48, payment_terms_days: 30, admin_hours_invoicing_week: 10, cash_check_frequency: 'monthly', cash_surprises_year: 3, reports_monthly: false, admin_hours_reporting_month: 8, calls_per_week: 150, missed_call_pct: 25, call_to_job_pct: 35, admin_hours_bookings_week: 12, quotes_per_week: 15, quote_turnaround_days: 3, quote_win_pct: 30, has_budget: false };
  const core = Au.runAuditCore({ businessName: 'Demo Heating Ltd', industry: 'Heating engineers', sells: 'boiler installs', revenueBand: '2m-5m', staffBand: '11-50', answers });
  assert.equal(core.rejected, false);
  const pillars = new Set(core.diagnosis.findings.map((f) => f.pillar));
  assert.deepEqual([...pillars].sort(), ['bookings', 'cash', 'invoicing', 'planning', 'reporting']);
  assert.ok(core.diagnosis.totalAnnualCost > 50000);
  assert.deepEqual(core.diagnosis.recommendedServices.sort(), ['invoicing', 'monitoring', 'phone', 'quotes', 'reporting']);
  assert.equal(core.proposal.tier.key, 'complete');
  const md = Au.buildAuditReportMarkdown({ businessName: 'Demo Heating Ltd' }, core.diagnosis, null, core.proposal);
  assert.match(md, /Invoicing & collections/);
  assert.match(md, /How we worked it out/);
  assert.equal(Au.runAuditCore({ businessName: 'X', industry: 'Wine bar', answers: {} }).rejected, true);
});

test('onboarding checklist: demo client is ready; gaps are listed', () => {
  assert.equal(O.checklist(A).ready, true);
  const gaps = O.checklist(R.normalizeClient({ fields: { ...DEMO_A, 'AI disclosure check passed': false, 'Calendar ID': '' } }));
  assert.equal(gaps.ready, false);
  assert.deepEqual(gaps.missing.map((m) => m.id).sort(), ['ai_disclosure', 'calendar']);
  assert.equal(O.randomToken(32).length, 32);
});

test('Claude request/response handling fails safe', () => {
  const req = Ag.buildClaudeRequest({ system: 's', prompt: 'p', schema: Ag.obj({ a: { type: 'string' } }) });
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.fallbacks, 'default');
  assert.deepEqual(Ag.parseClaudeJson({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":"x"}' }] }).data, { a: 'x' });
  assert.equal(Ag.parseClaudeJson({ stop_reason: 'refusal', content: [] }).error, 'refusal');
  assert.equal(Ag.parseClaudeJson({ type: 'error', error: { message: 'overloaded' } }).error, 'api_error');
  assert.equal(Ag.parseClaudeJson({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }).error, 'invalid_json');
  assert.equal(Ag.parseClaudeJson(null).ok, false);
});

test('rendered HTML escapes user content', () => {
  const html = Rn.invoiceDraftEmail(A, { job: { jobId: 'J1', customerName: '<script>x</script>' }, total: 10 });
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /Nothing has been sent to your customer/);
});
