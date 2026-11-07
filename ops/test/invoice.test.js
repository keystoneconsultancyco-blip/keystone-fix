'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/invoice');
const T = require('../lib/time');
const R = require('../lib/registry');
const { DEMO_A, DEMO_B } = require('../fixtures/clients');

const A = R.normalizeClient({ id: 'recA', fields: DEMO_A });
const B = R.normalizeClient({ id: 'recB', fields: DEMO_B });
const job = (over) => I.normalizeJob({ fields: { 'Job ID': 'J-100', 'Client ID': 'KS-DEMO-01', 'Customer ID': 'CUST-7', 'Customer name': 'Alex Morgan', 'Customer email': 'Alex@Example.com', 'Customer phone': '07700 900555', 'Job description': 'Annual boiler service and safety check', 'Job value': 95, ...over } });

test('clean job takes the fixed core (no AI)', () => {
  const r = I.assessJob(job(), { client: A });
  assert.equal(r.route, 'core');
  assert.equal(job().customerEmail, 'alex@example.com');
});

test('missing email still invoices, with a warning', () => {
  const r = I.assessJob(job({ 'Customer email': '' }), { client: A });
  assert.equal(r.route, 'core');
  assert.ok(r.issues.some((i) => i.code === 'MISSING_EMAIL'));
});

test('zero, missing and unparseable values go to the exception agent', () => {
  assert.equal(I.assessJob(job({ 'Job value': 0 }), { client: A }).route, 'agent');
  assert.equal(I.assessJob(job({ 'Job value': null }), { client: A }).route, 'agent');
  assert.equal(I.assessJob(job({ 'Job value': 'ninety five' }), { client: A }).route, 'agent');
  assert.equal(I.assessJob(job({ 'Job value': '£1,250.00' }), { client: A }).route, 'core');
});

test('vague descriptions and conflicting amounts go to the agent', () => {
  assert.ok(I.assessJob(job({ 'Job description': 'job' }), { client: A }).issues.some((i) => i.code === 'VAGUE_DESCRIPTION'));
  const r = I.assessJob(job({ 'Job value': 1000, 'Line items': JSON.stringify([{ description: 'Deposit', amount: 300 }, { description: 'Balance', amount: 600 }]) }), { client: A });
  assert.ok(r.issues.some((i) => i.code === 'CONFLICTING_AMOUNTS'));
});

test('duplicates: same job ID or same customer, amount and description', () => {
  const recent = [{ jobId: 'J-099', customerEmail: 'alex@example.com', customerName: 'Alex Morgan', value: 95, description: 'Annual boiler service and safety check', invoiceNumber: 'INV-1' }];
  const r = I.assessJob(job(), { client: A, recentInvoices: recent });
  assert.equal(r.route, 'agent');
  assert.ok(r.issues.some((i) => i.code === 'POSSIBLE_DUPLICATE'));
});

test('already-invoiced and other-client jobs are skipped (isolation)', () => {
  assert.equal(I.assessJob(job({ 'Xero invoice ID': 'abc' }), { client: A }).route, 'skip');
  assert.equal(I.assessJob(job(), { client: B }).route, 'skip');
});

test('discounts come only from the same client', () => {
  const discounts = [
    { fields: { Rule: 'Alex loyalty', 'Client ID': 'KS-DEMO-01', 'Customer ID': 'CUST-7', 'Discount %': 0.1, Active: true } },
    { fields: { Rule: 'Other client', 'Client ID': 'KS-DEMO-02', 'Customer ID': 'CUST-7', 'Discount %': 0.5, Active: true } },
    { fields: { Rule: 'Expired', 'Client ID': 'KS-DEMO-01', 'Customer ID': 'CUST-7', 'Discount %': 0.3, Active: true, 'Valid until': '2020-01-01' } },
  ];
  assert.deepEqual(I.findDiscount(job(), discounts, A, new Date('2026-11-07')), { ruleName: 'Alex loyalty', percent: 10 });
  assert.equal(I.findDiscount(job(), discounts.slice(1, 2), A), null);
  const lines = I.buildLineItems(job(), A, { percent: 10 });
  assert.equal(lines[0].DiscountRate, 10);
});

test('milestone invoicing produces multiple lines only when enabled', () => {
  const j = job({ 'Job value': 4000, 'Line items': JSON.stringify([{ description: 'Deposit 30%', amount: 1200 }, { description: 'First fix 40%', amount: 1600 }, { description: 'Completion 30%', amount: 1200 }]) });
  assert.equal(I.buildLineItems(j, A).length, 3);
  assert.equal(I.buildLineItems(j, B).length, 1);
});

test('every invoice payload is a DRAFT and the guardrail refuses anything else', () => {
  const p = I.buildXeroDraftInvoice({ job: job(), client: A, contactId: 'c1', lineItems: I.buildLineItems(job(), A), today: new Date('2026-11-07') });
  assert.equal(p.Invoices[0].Status, 'DRAFT');
  assert.equal(p.Invoices[0].DueDate, '2026-11-21');
  assert.equal(p.Invoices[0].LineAmountTypes, 'Exclusive');
  assert.throws(() => I.assertDraft({ Invoices: [{ Status: 'AUTHORISED' }] }), /GUARDRAIL/);
});

test('contact matching: reuse on name+email, suffix a different same-name customer', () => {
  const existing = [{ ContactID: 'x1', Name: 'Alex Morgan', EmailAddress: 'other.alex@example.com', Phones: [] }];
  const c = I.chooseContact(job(), existing);
  assert.equal(c.action, 'create');
  assert.equal(c.name, 'Alex Morgan (DISAMB-CUST-7)');
  const existing2 = [...existing, { ContactID: 'x2', Name: 'Alex Morgan (DISAMB-CUST-7)', EmailAddress: 'alex@example.com' }];
  assert.deepEqual(I.chooseContact(job(), existing2), { action: 'reuse', contactId: 'x2', name: 'Alex Morgan (DISAMB-CUST-7)' });
  const byPhone = [{ ContactID: 'x3', Name: 'Alex Morgan', Phones: [{ PhoneNumber: '+44 7700 900555' }] }];
  assert.equal(I.chooseContact(job({ 'Customer email': '' }), byPhone).action, 'reuse');
  assert.equal(I.chooseContact(job(), []).name, 'Alex Morgan');
});

test('send window uses the client timezone (regression: old UTC-offset bug)', () => {
  // 07:30 UTC on a BST date is 08:30 London time, so the 08:00-18:00 window is open.
  assert.equal(T.inSendWindow(new Date('2026-07-01T07:30:00Z'), '08:00', '18:00', 'Europe/London'), true);
  // 07:30 UTC in winter is 07:30 London time, so the window is closed.
  assert.equal(T.inSendWindow(new Date('2026-12-01T07:30:00Z'), '08:00', '18:00', 'Europe/London'), false);
  assert.equal(T.nextWindowOpen(new Date('2026-12-01T19:00:00Z'), '08:00', '18:00', 'Europe/London').toISOString(), '2026-12-02T08:00:00.000Z');
  assert.equal(T.nextWindowOpen(new Date('2026-07-01T05:00:00Z'), '08:00', '18:00', 'Europe/London').toISOString(), '2026-07-01T07:00:00.000Z');
  assert.equal(T.inSendWindow(new Date('2026-12-01T23:30:00Z'), '20:00', '06:00', 'Europe/London'), true);
});

// ---- exception agent guardrails ----
const agentOk = (data) => ({ ok: true, data });

test('confident agent fix creates a draft with a note', () => {
  const j = job({ 'Job value': 1000, 'Line items': JSON.stringify([{ description: 'Deposit', amount: 400 }, { description: 'Balance', amount: 600 }]) });
  const issues = I.assessJob(j, { client: A }).issues;
  const out = I.applyAgentDecision(j, agentOk({ decision: 'create_draft', confidence: 0.9, reasoning: 'Line items sum to job value', noteForDraft: 'Used line items', corrected: { customerName: 'Alex Morgan', customerEmail: 'alex@example.com', lineItems: [{ description: 'Deposit', amount: 400 }, { description: 'Balance', amount: 600 }] } }), issues);
  assert.equal(out.action, 'draft');
  assert.equal(out.job.value, 1000);
  assert.equal(out.forceMultiLine, true);
});

test('agent cannot invent an amount', () => {
  const j = job({ 'Job value': 0 });
  const out = I.applyAgentDecision(j, agentOk({ decision: 'create_draft', confidence: 0.95, reasoning: 'Typical boiler service price', noteForDraft: '', corrected: { customerName: 'Alex Morgan', customerEmail: '', lineItems: [{ description: 'Boiler service', amount: 95 }] } }), []);
  assert.equal(out.action, 'review');
  assert.match(out.reason, /does not match any amount/);
});

test('low confidence, needs_review and agent failure all go to review', () => {
  const j = job();
  const corrected = { customerName: 'Alex Morgan', customerEmail: '', lineItems: [{ description: 'x', amount: 95 }] };
  assert.equal(I.applyAgentDecision(j, agentOk({ decision: 'create_draft', confidence: 0.5, reasoning: 'unsure', noteForDraft: '', corrected }), []).action, 'review');
  assert.equal(I.applyAgentDecision(j, agentOk({ decision: 'needs_review', confidence: 0.9, reasoning: 'conflict', noteForDraft: '', corrected }), []).action, 'review');
  assert.equal(I.applyAgentDecision(j, { ok: false, error: 'refusal' }, []).action, 'review');
  assert.equal(I.applyAgentDecision(j, agentOk({ decision: 'skip_duplicate', confidence: 0.92, reasoning: 'same as INV-1', noteForDraft: '', corrected }), []).action, 'skip');
});
