'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build-workflows');
const { simulate } = require('../scripts/simulate');
const wf = build({ write: false }).workflows['KS Audit Agent'];
const answers = { avg_job_value: 450, invoices_per_month: 120, days_to_invoice: 6, admin_hours_invoicing_week: 10, cash_check_frequency: 'monthly', cash_surprises_year: 3, reports_monthly: false, admin_hours_reporting_month: 8, calls_per_week: 150, missed_call_pct: 25, quotes_per_week: 15, quote_turnaround_days: 3 };
function m(extra = {}) { const w = []; return { w, mocks: { 'Airtable write': (r) => { w.push(r); return { body: {} }; }, 'Save intake': (r) => { w.push(r); return { body: { records: [{ id: 'recI' }] } }; }, 'Save report draft': (r) => { w.push(r); return { body: { records: [{ id: 'recI' }] } }; },
  'Audit writer (Claude)': () => ({ body: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ executiveSummary: 'Summary', pillars: [{ pillar: 'Invoicing & collections', rating: 'weak', narrative: 'Slow' }], quickWins: ['Invoice same day'], questionsForMeeting: ['How many vans?'] }) }] } }),
  'Xero invoices (read-only)': () => ({ body: { Invoices: [{ Type: 'ACCREC', Status: 'PAID', Total: 500, Date: '2026-09-01', FullyPaidOnDate: '2026-10-11' }, { Type: 'ACCREC', Status: 'AUTHORISED', Total: 300, AmountDue: 300, DueDateString: '2026-10-01', Date: '2026-09-15' }] } }), ...extra } }; }
const intake = (over) => ({ body: { businessName: 'KS TEST Heating Ltd', contactName: 'Sam', contactEmail: 'sam@example.com', industry: 'Heating engineers', sells: 'boiler installs', revenueBand: '2m-5m', staffBand: '11-50', answers, ...over } });
test('audit: full report drafted into Audit Intakes, prospect gets a thank-you, Bilal notified', async () => {
  const x = m();
  const r = await simulate(wf, { start: 'Audit intake', items: [intake({})], mocks: x.mocks });
  // every Claude call is costed in AI Usage (Opus: client audits)
  const usage = x.w.find((w) => w.url && w.url.includes('tbl6E7WRrGbnKNbuS'));
  assert.ok(usage && usage.body.records[0].fields.Task === 'audit_report');
  assert.deepEqual(r.errors, []);
  const upd = x.w.find((q) => q.method === 'PATCH').body.records[0].fields;
  assert.equal(upd.Status, 'Draft ready for review');
  assert.match(upd['Report draft'], /Invoicing & collections/);
  assert.ok(upd['Estimated annual loss'] > 50000);
  assert.match(JSON.parse(r.responses[0].body).message, /2 working days/);
  assert.ok(r.calls.some((c) => c.node === 'Tell Bilal'));
});
test('audit: Xero snapshot feeds real days-to-pay', async () => {
  const x = m();
  const r = await simulate(wf, { start: 'Audit intake', items: [intake({ xeroTenantId: 't1' })], mocks: x.mocks });
  assert.deepEqual(r.errors, []);
  const upd = x.w.find((q) => q.method === 'PATCH').body.records[0].fields;
  assert.equal(JSON.parse(upd['Xero snapshot JSON']).avgDaysToPay, 40);
});
test('audit: halal rejection, AI down, missing fields', async () => {
  const rej = await simulate(wf, { start: 'Audit intake', items: [intake({ industry: 'Craft brewery', sells: 'beer' })], mocks: m().mocks });
  assert.match(JSON.parse(rej.responses[0].body).message, /not able to work/);
  const down = m({ 'Audit writer (Claude)': () => ({ statusCode: 500, body: {} }) });
  await simulate(wf, { start: 'Audit intake', items: [intake({})], mocks: down.mocks });
  assert.match(down.w.find((q) => q.method === 'PATCH').body.records[0].fields['Report draft'], /AI narrative unavailable/);
  const bad = await simulate(wf, { start: 'Audit intake', items: [{ body: { businessName: 'X' } }], mocks: m().mocks });
  assert.match(JSON.parse(bad.responses[0].body).message, /Please fill in/);
});
