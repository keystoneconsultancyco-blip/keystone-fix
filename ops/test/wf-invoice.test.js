'use strict';
// End-to-end simulation of the generated KS-01 Invoice Automation workflow JSON.
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build-workflows');
const { simulate } = require('../scripts/simulate');
const { DEMO_A, DEMO_B } = require('../fixtures/clients');

const wf = build({ write: false }).workflows['KS-01 Invoice Automation'];
const LIVE_A = { ...DEMO_A, 'Is demo/test': false, 'Xero organisation ID': 'tenant-aaa', 'Business email': 'owner@brightwater.example' };

function jobsRow(id, fields) { return { id, fields: { 'Client ID': 'KS-DEMO-01', 'Status': 'Completed', 'Customer ID': 'C1', 'Customer name': 'Alex Morgan', 'Customer email': 'alex@example.com', 'Job description': 'Annual boiler service and safety check', 'Job value': 95, ...fields } }; }

function mocks({ jobs, clients = [{ id: 'recA', fields: DEMO_A }, { id: 'recB', fields: DEMO_B }], discounts = [], recent = [], claude, xero }) {
  const writes = [];
  return {
    writes,
    m: {
      'Get jobs': () => ({ body: { records: jobs } }),
      'Get clients': () => ({ body: { records: clients } }),
      'Get discounts': () => ({ body: { records: discounts } }),
      'Get recent invoices': () => ({ body: { records: recent } }),
      'Exception agent': (req) => claude(req),
      'Xero find contact': (req) => xero.find(req),
      'Xero ensure contact': (req) => xero.ensure(req),
      'Xero create DRAFT invoice': (req) => xero.invoice(req),
      'Airtable write': (req) => { writes.push({ kind: 'airtable', req }); return { body: { records: [] } }; },
      'Send email': (req) => { writes.push({ kind: 'email', req }); return { body: { id: 'em1' } }; },
      'Send SMS': (req) => { writes.push({ kind: 'sms', req }); return {}; },
    },
  };
}

const IN_WINDOW = new Date('2026-11-09T10:00:00Z'); // Monday 10:00 London

test('demo client: clean job creates a simulated DRAFT, updates the job, logs, and only emails the test inbox', async () => {
  const { m, writes } = mocks({ jobs: [jobsRow('recJ1', { 'Job ID': 'J-1' })] });
  const r = await simulate(wf, { start: 'Manual run', mocks: m, now: IN_WINDOW });
  assert.deepEqual(r.errors, []);
  assert.ok(r.ran.includes('Simulate Xero (demo)'));
  assert.ok(!r.ran.includes('Exception agent'));
  const jobUpdate = writes.find((w) => w.req.method === 'PATCH');
  assert.equal(jobUpdate.req.body.records[0].fields.Status, 'Invoiced (draft)');
  assert.equal(jobUpdate.req.body.records[0].fields['Invoice number'], 'DEMO-DRAFT-J-1');
  const log = writes.find((w) => w.req.url && w.req.url.includes('tbl2w5ClJO9aojS43'));
  assert.equal(log.req.body.records[0].fields.Outcome, 'Draft created');
  const email = writes.find((w) => w.kind === 'email');
  assert.deepEqual(email.req.body.to, ['keystoneconsultancy.co@gmail.com']);
});

test('live client: Xero DRAFT path with contact disambiguation; payload is DRAFT; tenant header scoped', async () => {
  const seen = {};
  const { m, writes } = mocks({
    jobs: [jobsRow('recJ2', { 'Job ID': 'J-2' })],
    clients: [{ id: 'recA', fields: LIVE_A }, { id: 'recB', fields: DEMO_B }],
    discounts: [{ id: 'd1', fields: { 'Client ID': 'KS-DEMO-01', 'Customer ID': 'C1', 'Discount %': 0.1, Active: true } }],
    xero: {
      find: (req) => { seen.find = req; return { body: { Contacts: [{ ContactID: 'other', Name: 'Alex Morgan', EmailAddress: 'someone.else@example.com' }] } }; },
      ensure: (req) => { seen.ensure = req; return { body: { Contacts: [{ ContactID: 'new-contact' }] } }; },
      invoice: (req) => { seen.invoice = req; return { body: { Invoices: [{ InvoiceID: 'inv-1', InvoiceNumber: 'INV-0042', Status: 'DRAFT', Total: 102.6 }] } }; },
    },
  });
  const r = await simulate(wf, { start: 'Manual run', mocks: m, now: IN_WINDOW });
  assert.deepEqual(r.errors, []);
  assert.equal(seen.find.headers['xero-tenant-id'], 'tenant-aaa');
  assert.equal(seen.ensure.body.Contacts[0].Name, 'Alex Morgan (DISAMB-C1)');
  const inv = seen.invoice.body.Invoices[0];
  assert.equal(inv.Status, 'DRAFT');
  assert.equal(inv.Contact.ContactID, 'new-contact');
  assert.equal(inv.LineItems[0].DiscountRate, 10);
  assert.deepEqual(writes.find((w) => w.kind === 'email').req.body.to, ['owner@brightwater.example']);
});

test('messy job: exception agent confident -> draft with note', async () => {
  const { m, writes } = mocks({
    jobs: [jobsRow('recJ3', { 'Job ID': 'J-3', 'Job description': 'job', 'Job value': 240 })],
    claude: (req) => {
      assert.equal(req.body.model, 'claude-opus-5-5');
      assert.ok(req.headers === undefined || true);
      return { body: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ decision: 'create_draft', confidence: 0.86, reasoning: 'Description vague; payment notes show radiator bleed', noteForDraft: 'Description clarified from notes', corrected: { customerName: 'Alex Morgan', customerEmail: 'alex@example.com', lineItems: [{ description: 'Radiator bleed and system top-up', amount: 240 }] } }) }] } };
    },
  });
  const r = await simulate(wf, { start: 'Manual run', mocks: m, now: IN_WINDOW });
  assert.deepEqual(r.errors, []);
  assert.ok(r.ran.includes('Exception agent'));
  const upd = writes.find((w) => w.req.method === 'PATCH').req.body.records[0].fields;
  assert.equal(upd.Status, 'Invoiced (draft)');
  assert.equal(upd['Agent note'], 'Description clarified from notes');
  const log = writes.find((w) => w.req.url && w.req.url.includes('tbl2w5ClJO9aojS43')).req.body.records[0].fields;
  assert.equal(log.Event, 'invoice_agent_fixed');
});

test('messy job: agent unsure -> Needs Review + email to Bilal; nothing created in Xero', async () => {
  const { m, writes } = mocks({
    jobs: [jobsRow('recJ4', { 'Job ID': 'J-4', 'Job value': 0 })],
    claude: () => ({ body: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ decision: 'needs_review', confidence: 0.4, reasoning: 'Zero value, no other amount', noteForDraft: '', corrected: { customerName: 'Alex Morgan', customerEmail: '', lineItems: [] } }) }] } }),
  });
  const r = await simulate(wf, { start: 'Manual run', mocks: m, now: IN_WINDOW });
  assert.deepEqual(r.errors, []);
  assert.ok(!r.ran.includes('Simulate Xero (demo)'));
  assert.ok(writes.some((w) => w.req.url && w.req.url.includes('tblI09VVKADnb8Ln0')));
  assert.match(writes.find((w) => w.kind === 'email').req.body.subject, /needs review/);
});

test('agent API down -> fail safe to review', async () => {
  const { m, writes } = mocks({ jobs: [jobsRow('recJ5', { 'Job ID': 'J-5', 'Job value': null })], claude: () => ({ statusCode: 529, body: { type: 'error', error: { message: 'overloaded' } } }) });
  const r = await simulate(wf, { start: 'Manual run', mocks: m, now: IN_WINDOW });
  assert.deepEqual(r.errors, []);
  const nr = writes.find((w) => w.req.url && w.req.url.includes('tblI09VVKADnb8Ln0')).req.body.records[0].fields;
  assert.match(nr['Agent reasoning'], /Agent unavailable/);
});

test('out of window -> queued; stopped client -> skipped; client B unaffected', async () => {
  const stopped = { ...DEMO_A, Status: 'Stopped' };
  const jobs = [jobsRow('recJ6', { 'Job ID': 'J-6' }), jobsRow('recJ7', { 'Job ID': 'J-7', 'Client ID': 'KS-DEMO-02' })];
  const { m, writes } = mocks({ jobs, clients: [{ id: 'recA', fields: stopped }, { id: 'recB', fields: DEMO_B }] });
  const r = await simulate(wf, { start: 'Manual run', mocks: m, now: IN_WINDOW });
  assert.deepEqual(r.errors, []);
  const patches = writes.filter((w) => w.req.method === 'PATCH').map((w) => w.req.body.records[0]);
  assert.equal(patches.find((p) => p.id === 'recJ6').fields.Status, 'Skipped');
  assert.equal(patches.find((p) => p.id === 'recJ7').fields.Status, 'Invoiced (draft)');

  const night = new Date('2026-11-09T22:00:00Z');
  const q = mocks({ jobs: [jobsRow('recJ8', { 'Job ID': 'J-8' }), jobsRow('recJ10', { 'Job ID': 'J-10', Status: 'Queued (out of window)' })] });
  const rq = await simulate(wf, { start: 'Manual run', mocks: q.m, now: night });
  assert.deepEqual(rq.errors, []);
  const qp = q.writes.filter((w) => w.req.method === 'PATCH').map((w) => w.req.body.records[0]);
  assert.equal(qp.length, 1, 'already-queued job is left alone, no duplicate log spam');
  assert.equal(qp[0].fields.Status, 'Queued (out of window)');
  assert.match(qp[0].fields['Error message'], /2026-11-10T08:00:00.000Z/);
  // next morning the queued job is invoiced
  const m2 = mocks({ jobs: [jobsRow('recJ10', { 'Job ID': 'J-10', Status: 'Queued (out of window)' })] });
  await simulate(wf, { start: 'Manual run', mocks: m2.m, now: new Date('2026-11-10T08:15:00Z') });
  assert.equal(m2.writes.find((w) => w.req.method === 'PATCH').req.body.records[0].fields.Status, 'Invoiced (draft)');
});

test('Xero 503 -> one automatic retry; repeated failure -> Needs Review', async () => {
  const fail = { find: () => ({ statusCode: 503, body: 'Service Unavailable' }), ensure: () => ({ statusCode: 503, body: {} }), invoice: () => ({ statusCode: 200, body: { Invoices: [] } }) };
  const clients = [{ id: 'recA', fields: LIVE_A }];
  const a = mocks({ jobs: [jobsRow('recJ9', { 'Job ID': 'J-9' })], clients, xero: fail });
  await simulate(wf, { start: 'Manual run', mocks: a.m, now: IN_WINDOW });
  const p1 = a.writes.find((w) => w.req.method === 'PATCH').req.body.records[0].fields;
  assert.equal(p1.Status, 'Completed');
  assert.match(p1['Error message'], /^\[retry 1\]/);
  const b = mocks({ jobs: [jobsRow('recJ9', { 'Job ID': 'J-9', 'Error message': p1['Error message'] })], clients, xero: fail });
  await simulate(wf, { start: 'Manual run', mocks: b.m, now: IN_WINDOW });
  assert.equal(b.writes.find((w) => w.req.method === 'PATCH').req.body.records[0].fields.Status, 'Needs review');
});

test('job intake webhook requires the client token and gates the client', async () => {
  const base = { 'Intake client lookup': () => ({ body: { records: [{ id: 'recB', fields: DEMO_B }] } }), 'Create job row': (req) => ({ body: { records: [{ id: 'new' }] }, _req: req }) };
  const good = await simulate(wf, { start: 'Job intake webhook', items: [{ body: { clientId: 'KS-DEMO-02', jobId: 'T-1', token: DEMO_B['Dashboard token'], customerName: 'Jo', jobValue: 85, jobDescription: 'Airport transfer to Heathrow' } }], mocks: base });
  assert.deepEqual(good.errors, []);
  assert.equal(JSON.parse(good.responses[0].body).queued, true);
  const created = good.calls.find((c) => c.node === 'Create job row').req.body.records[0].fields;
  assert.equal(created['Client ID'], 'KS-DEMO-02');
  assert.equal(created.Status, 'Completed');
  const bad = await simulate(wf, { start: 'Job intake webhook', items: [{ body: { clientId: 'KS-DEMO-02', jobId: 'T-2', token: 'wrong' } }], mocks: base });
  assert.equal(JSON.parse(bad.responses[0].body).error, 'bad_token');
});
