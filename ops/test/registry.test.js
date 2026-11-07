'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/registry');
const { DEMO_A, DEMO_B } = require('../fixtures/clients');

const rec = (fields, id) => ({ id, fields: { ...fields } });

test('two clients resolve independently by ID and by phone number', () => {
  const rows = [rec(DEMO_A, 'recA'), rec(DEMO_B, 'recB')];
  assert.equal(R.resolveClient(rows, { clientId: 'KS-DEMO-01' }).client.clientName, DEMO_A['Client name']);
  assert.equal(R.resolveClient(rows, { phoneNumber: '07700 900200' }).client.clientId, 'KS-DEMO-02');
  assert.equal(R.resolveClient(rows, { clientId: 'KS-NOPE' }).error, 'client_not_found');
});

test('stopping one client stops every service for it and does not affect the other', () => {
  const stoppedA = { ...DEMO_A, Status: 'Stopped' };
  const rows = [rec(stoppedA, 'recA'), rec(DEMO_B, 'recB')];
  const a = R.resolveClient(rows, { clientId: 'KS-DEMO-01' }).client;
  const b = R.resolveClient(rows, { clientId: 'KS-DEMO-02' }).client;
  for (const s of ['invoicing', 'phone', 'quotes', 'reporting', 'monitoring']) {
    assert.deepEqual(R.gate(a, s), { ok: false, reason: 'status_stopped' }, s);
    assert.deepEqual(R.gate(b, s), { ok: true }, s);
  }
});

test('paused and onboarding clients are blocked', () => {
  assert.equal(R.gate(R.normalizeClient(rec({ ...DEMO_A, Status: 'Paused' }))).reason, 'status_paused');
  assert.equal(R.gate(R.normalizeClient(rec({ ...DEMO_A, Status: 'Onboarding' }))).reason, 'status_onboarding');
});

test('service toggle off blocks only that service', () => {
  const c = R.normalizeClient(rec({ ...DEMO_A, 'Phone on': false }));
  assert.equal(R.gate(c, 'phone').reason, 'phone_toggle_off');
  assert.equal(R.gate(c, 'invoicing').ok, true);
});

test('halal screen and AI-disclosure checks are enforced', () => {
  assert.equal(R.gate(R.normalizeClient(rec({ ...DEMO_A, 'Halal screen passed': false })), 'invoicing').reason, 'halal_screen_not_passed');
  assert.equal(R.gate(R.normalizeClient(rec({ ...DEMO_A, 'AI disclosure check passed': false })), 'phone').reason, 'ai_disclosure_check_not_passed');
  const eu = R.normalizeClient(rec({ ...DEMO_A, Jurisdiction: 'Republic of Ireland / EU' }));
  assert.equal(R.gate(eu, 'phone').reason, 'jurisdiction_requires_ai_disclosure');
  assert.equal(R.gate(eu, 'invoicing').ok, true);
});

test('Airtable single-select objects and flattened n8n items both normalise', () => {
  const flat = { id: 'recX', ...DEMO_B, Status: { name: 'Active' } };
  const c = R.normalizeClient(flat);
  assert.equal(c.status, 'Active');
  assert.equal(c.recordId, 'recX');
  assert.equal(c.phone.services.length, 3);
});

test('invalid JSON in Services blocks the phone service only', () => {
  const c = R.normalizeClient(rec({ ...DEMO_A, Services: '{not json' }));
  assert.match(R.gate(c, 'phone').reason, /invalid_json/);
  assert.equal(R.gate(c, 'invoicing').ok, true);
});

test('duplicate keys across clients are reported (isolation)', () => {
  const clash = { ...DEMO_B, 'Business phone number': DEMO_A['Business phone number'] };
  const problems = R.validateRegistry([rec(DEMO_A), rec(clash)]);
  assert.ok(problems.some((p) => p.includes('Duplicate Business phone number')));
  assert.equal(R.resolveClient([rec(DEMO_A), rec(clash)], { phoneNumber: DEMO_A['Business phone number'] }).error, 'ambiguous_client_match');
  assert.deepEqual(R.validateRegistry([rec(DEMO_A), rec(DEMO_B)]), []);
});

test('demo clients never email anyone except the Keystone test inbox', () => {
  const demo = R.normalizeClient(rec(DEMO_A));
  assert.deepEqual(R.safeRecipients(demo, ['real.customer@example.com']), [R.TEST_INBOX]);
  const live = R.normalizeClient(rec({ ...DEMO_A, 'Is demo/test': false }));
  assert.deepEqual(R.safeRecipients(live, ['a@b.co']), ['a@b.co']);
});

test('UK phone numbers normalise to E.164', () => {
  assert.equal(R.normalizePhone('07700 900100'), '+447700900100');
  assert.equal(R.normalizePhone('0044 7700 900100'), '+447700900100');
  assert.equal(R.normalizePhone('+44 (0)20 7946 0000').startsWith('+44'), true);
});
