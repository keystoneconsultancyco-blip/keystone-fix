'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build-workflows');
const { simulate } = require('../scripts/simulate');
const { DEMO_A } = require('../fixtures/clients');

const wf = build({ write: false }).workflows['KS Quote Calculator'];
const client = { id: 'recA', fields: { ...DEMO_A, 'Prices include VAT': false, 'Quote valid days': 30 } };
const services = [{ id: 's1', fields: { Service: 'Boiler service', 'Client ID': 'KS-DEMO-01', Active: true, 'Base price': 95, 'Cost (base)': 38, Keywords: 'boiler service' } }];
const factors = [{ id: 'f1', fields: { Factor: 'Call-out fee', 'Client ID': 'KS-DEMO-01', Active: true, Type: { name: 'Fixed fee' }, Amount: 45, 'Ask as': 'callout', Applies: { name: 'When customer says yes' }, 'Waived if booked': true, Question: 'Call-out?' } }];
function m(extra = {}) {
  const writes = [];
  return { writes, mocks: {
    'Quote: get client': () => ({ body: { records: [client] } }), 'Quote: get services': () => ({ body: { records: services } }), 'Quote: get factors': () => ({ body: { records: factors } }),
    'Form: get client': () => ({ body: { records: [client] } }), 'Form: get services': () => ({ body: { records: services } }), 'Form: get factors': () => ({ body: { records: factors } }),
    'Airtable write': (req) => { writes.push(req); return { body: {} }; }, 'Send email': (req) => { writes.push(req); return { body: { id: 'e' } }; }, ...extra,
  } };
}

test('web quote priced from Airtable rows -> draft for approval, approver emailed', async () => {
  const x = m();
  const r = await simulate(wf, { start: 'Quote request', items: [{ body: { clientId: 'KS-DEMO-01', source: 'web', service: 'Boiler service', answers: { callout: 'yes' }, customer: { name: 'Jo', email: 'jo@example.com' } } }], mocks: x.mocks });
  assert.deepEqual(r.errors, []);
  const resp = JSON.parse(r.responses[0].body);
  assert.equal(resp.total, 168);
  assert.equal(resp.status, 'Draft - awaiting client approval');
  const quoteRow = x.writes.find((w) => w.url && w.url.includes('tbl1lUnKBBqk7NKt7')).body.records[0].fields;
  assert.equal(quoteRow.Status, 'Draft - awaiting client approval');
  assert.ok(quoteRow['Approval token'].length >= 20);
  const mail = x.writes.find((w) => w.url === 'https://api.resend.com/emails');
  assert.match(mail.body.subject, /^Approve quote/);
  assert.match(mail.body.html, /ks-quote-approve\?ref=/);
});

test('phone quote returns a spoken estimate; unmatched phone job goes to business without AI', async () => {
  const x = m();
  const r = await simulate(wf, { start: 'Quote request', items: [{ body: { clientId: 'KS-DEMO-01', source: 'phone', description: 'boiler service please' } }], mocks: x.mocks });
  assert.match(JSON.parse(r.responses[0].body).message, /estimate is about £114/);
  const r2 = await simulate(wf, { start: 'Quote request', items: [{ body: { clientId: 'KS-DEMO-01', source: 'phone', description: 'heat pump install' } }], mocks: m().mocks });
  assert.ok(!r2.ran.includes('Quote: AI estimate'));
  assert.match(JSON.parse(r2.responses[0].body).message, /pass the details/);
});

test('unmatched web job -> AI estimate -> draft; AI down -> needs more info', async () => {
  const ai = () => ({ body: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ lines: [{ description: 'Heat pump survey', amount: 150, cost: 60 }], questions: [], reasoning: 'Based on boiler repair rates', confidence: 0.7 }) }] } });
  const x = m({ 'Quote: AI estimate': ai });
  const r = await simulate(wf, { start: 'Quote request', items: [{ body: { clientId: 'KS-DEMO-01', source: 'web', description: 'heat pump survey', customer: { name: 'A', email: 'a@example.com' } } }], mocks: x.mocks });
  assert.deepEqual(r.errors, []);
  const resp = JSON.parse(r.responses[0].body);
  assert.equal(resp.total, 180);
  assert.match(resp.message, /quick check/);
  const y = m({ 'Quote: AI estimate': () => ({ statusCode: 500, body: {} }) });
  const r2 = await simulate(wf, { start: 'Quote request', items: [{ body: { clientId: 'KS-DEMO-01', source: 'web', description: 'heat pump survey' } }], mocks: y.mocks });
  assert.equal(JSON.parse(r2.responses[0].body).status, 'Needs more info');
});

test('manual quote needs the token and is sent straight to the customer (demo -> test inbox)', async () => {
  const bad = await simulate(wf, { start: 'Quote request', items: [{ body: { clientId: 'KS-DEMO-01', source: 'manual', token: 'nope', service: 'Boiler service' } }], mocks: m().mocks });
  assert.equal(JSON.parse(bad.responses[0].body).ok, false);
  const x = m();
  const r = await simulate(wf, { start: 'Quote request', items: [{ body: { clientId: 'KS-DEMO-01', source: 'manual', token: DEMO_A['Dashboard token'], service: 'Boiler service', customer: { name: 'B', email: 'real.customer@example.com' } } }], mocks: x.mocks });
  assert.equal(JSON.parse(r.responses[0].body).status, 'Sent to customer');
  assert.deepEqual(x.writes.find((w) => w.url === 'https://api.resend.com/emails').body.to, ['khan.bilalbk408@gmail.com']);
});

test('form page renders client services and hides manual-only fields; bad client -> 404', async () => {
  const r = await simulate(wf, { start: 'Quote form page', items: [{ query: { c: 'KS-DEMO-01' } }], mocks: m().mocks });
  assert.deepEqual(r.errors, []);
  assert.match(r.responses[0].body, /Boiler service \(from £95\)/);
  assert.match(r.responses[0].body, /Call-out\?/);
  const none = await simulate(wf, { start: 'Quote form page', items: [{ query: { c: 'NOPE' } }], mocks: { ...m().mocks, 'Form: get client': () => ({ body: { records: [] } }) } });
  assert.match(none.responses[0].body, /not available/);
});

test('approve link: valid token sends; reused or wrong token refused', async () => {
  const quote = { id: 'recQ', fields: { 'Quote ref': 'Q-1', 'Client ID': 'KS-DEMO-01', Status: { name: 'Draft - awaiting client approval' }, 'Approval token': 'tok123456789012345678901234', 'Customer email': 'jo@example.com', 'Inputs JSON': JSON.stringify({ quote: { ref: 'Q-1', lines: [{ description: 'Boiler service', amount: 95 }], subtotal: 95, vat: 19, total: 114, vatRate: 20, customerName: 'Jo', validUntil: '2026-12-08' } }) } };
  const x = m({ 'Approve: get quote': () => ({ body: { records: [quote] } }), 'Approve: get client': () => ({ body: { records: [client] } }) });
  const ok = await simulate(wf, { start: 'Approve quote link', items: [{ query: { ref: 'Q-1', t: 'tok123456789012345678901234' } }], mocks: x.mocks });
  assert.deepEqual(ok.errors, []);
  assert.match(ok.responses[0].body, /has been emailed/);
  assert.equal(x.writes.find((w) => w.method === 'PATCH').body.records[0].fields.Status, 'Sent to customer');
  const bad = await simulate(wf, { start: 'Approve quote link', items: [{ query: { ref: 'Q-1', t: 'wrong' } }], mocks: x.mocks });
  assert.match(bad.responses[0].body, /not valid/);
});
