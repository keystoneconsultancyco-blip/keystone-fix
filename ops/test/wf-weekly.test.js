'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build-workflows');
const { simulate } = require('../scripts/simulate');
const { DEMO_A, DEMO_B } = require('../fixtures/clients');
const wf = build({ write: false }).workflows['KS Weekly Money + Dashboard'];
const A = { id: 'recA', fields: { ...DEMO_A, 'Xero organisation ID': 'tenant-real' } };
const B = { id: 'recB', fields: DEMO_B };
const pl = { Reports: [{ Rows: [{ RowType: 'Section', Rows: [{ RowType: 'SummaryRow', Cells: [{ Value: 'Total Income' }, { Value: '20000' }] }] }, { RowType: 'Section', Rows: [{ RowType: 'Row', Cells: [{ Value: 'Net Profit' }, { Value: '4000' }] }] }] }] };
function mocks(extra = {}) {
  const writes = [];
  return { writes, m: {
    'Get clients': () => ({ body: { records: [A, B] } }),
    'Xero P&L': () => ({ body: pl }), 'Xero bank summary': () => ({ body: { Reports: [{ Rows: [] }] } }), 'Xero money owed': () => ({ body: { Invoices: [{ Type: 'ACCREC', Status: 'AUTHORISED', AmountDue: 500, DueDateString: '2026-10-01' }] } }),
    'Get week activity': () => ({ body: { records: [{ fields: { Event: 'call_handled', Outcome: 'Success', 'Minutes saved': 5 } }] } }),
    'Get last week': () => ({ body: { records: [] } }),
    'Explainer (Claude)': () => ({ body: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ subject: 'Your week', headline: 'Sales £20,000', whatChanged: ['a'], why: ['b'], actions: [{ action: 'Chase 1 overdue invoice', reason: '£500 waiting' }] }) }] } }),
    'Airtable write': (req) => { writes.push(req); return { body: {} }; }, 'Send email': (req) => { writes.push(req); return { body: { id: 'e' } }; }, ...extra,
  } };
}
test('weekly money: real-Xero client and demo client each get a metrics row and an email', async () => {
  const x = mocks();
  const r = await simulate(wf, { start: 'Run weekly money now', items: [{ body: {} }], mocks: x.m });
  assert.deepEqual(r.errors, []);
  const metrics = x.writes.filter((w) => w.url && w.url.includes('tblDIK2iPEv4bdkHj')).map((w) => w.body.records[0].fields);
  assert.equal(metrics.length, 2);
  const a = metrics.find((m) => m['Client ID'] === 'KS-DEMO-01');
  assert.equal(a.Revenue, 20000); assert.equal(a['Data source'], 'xero'); assert.equal(a['Overdue value'], 500); assert.equal(a['Calls handled'], 1);
  assert.equal(metrics.find((m) => m['Client ID'] === 'KS-DEMO-02')['Data source'], 'demo');
  const emails = x.writes.filter((w) => w.url === 'https://api.resend.com/emails');
  assert.equal(emails.length, 2);
  assert.match(emails[0].body.html, /ks-dashboard\?c=/);
});
test('weekly money: Claude down -> fallback email still sent; Xero error -> zeros not crash', async () => {
  const x = mocks({ 'Explainer (Claude)': () => ({ statusCode: 529, body: {} }), 'Xero P&L': () => ({ statusCode: 401, body: {} }) });
  const r = await simulate(wf, { start: 'Run weekly money now', items: [{ body: { clientId: 'KS-DEMO-01' } }], mocks: x.m });
  assert.deepEqual(r.errors, []);
  assert.equal(x.writes.filter((w) => w.url === 'https://api.resend.com/emails').length, 2);
});
test('dashboard: right token shows only that client; wrong token refused', async () => {
  const m = { 'Dashboard: get client': () => ({ body: { records: [A] } }), 'Dashboard: get metrics': () => ({ body: { records: [{ fields: { 'Client ID': 'KS-DEMO-01', 'Week starting': '2026-11-02', Revenue: 20000, 'Cash balance': 9000, 'Data source': 'xero' } }, { fields: { 'Client ID': 'KS-DEMO-02', 'Week starting': '2026-11-02', Revenue: 777777 } }] } }) };
  const ok = await simulate(wf, { start: 'Dashboard page', items: [{ query: { c: 'KS-DEMO-01', t: DEMO_A['Dashboard token'] } }], mocks: m });
  assert.deepEqual(ok.errors, []);
  assert.match(ok.responses[0].body, /£20,000/); assert.doesNotMatch(ok.responses[0].body, /777,777/);
  const bad = await simulate(wf, { start: 'Dashboard page', items: [{ query: { c: 'KS-DEMO-01', t: 'nope' } }], mocks: m });
  assert.match(bad.responses[0].body, /not valid/);
});
