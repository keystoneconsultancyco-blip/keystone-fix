'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../lib/quotecalc');
const Al = require('../lib/alerts');
const R = require('../lib/registry');
const { DEMO_A, DEMO_B } = require('../fixtures/clients');

const A = R.normalizeClient({ fields: { ...DEMO_A, 'Prices include VAT': false } });
const B = R.normalizeClient({ fields: { ...DEMO_B, 'Prices include VAT': true } });
// Same rows as seeded in Airtable (Quote Services / Quote Factors)
const services = [
  { 'Service': 'Boiler service', 'Client ID': 'KS-DEMO-01', Active: true, 'Base price': 95, 'Cost (base)': 38, Keywords: 'boiler service, annual service' },
  { 'Service': 'Boiler repair', 'Client ID': 'KS-DEMO-01', Active: true, 'Base price': 120, 'Unit name': 'hour', 'Price per unit': 65, 'Units included in base': 1, 'Cost (base)': 45, 'Cost per unit': 28, Keywords: 'boiler repair, no heating' },
  { 'Service': 'Radiator supply and fit', 'Client ID': 'KS-DEMO-01', Active: true, 'Base price': 0, 'Unit name': 'radiator', 'Price per unit': 285, 'Cost per unit': 165, Keywords: 'new radiator' },
  { 'Service': 'Airport transfer', 'Client ID': 'KS-DEMO-02', Active: true, 'Base price': 35, 'Unit name': 'mile', 'Price per unit': 2.1, 'Cost (base)': 12, 'Cost per unit': 0.95, Keywords: 'airport, heathrow' },
];
const factors = [
  { Factor: 'Call-out fee', 'Client ID': 'KS-DEMO-01', Active: true, Type: 'Fixed fee', Amount: 45, 'Ask as': 'callout', Applies: 'When customer says yes', 'Waived if booked': true, Cost: 10, Question: 'Is this a call-out visit?' },
  { Factor: 'Travel', 'Client ID': 'KS-DEMO-01', Active: true, Type: 'Per unit', Amount: 1.1, 'Ask as': 'miles', Applies: 'When a number is given', 'Free units': 15, Cost: 0.45, Question: 'How many miles?' },
  { Factor: 'Urgent', 'Client ID': 'KS-DEMO-01', Active: true, Type: 'Multiplier', Amount: 1.5, 'Ask as': 'urgent', Applies: 'When customer says yes' },
  { Factor: 'Materials', 'Client ID': 'KS-DEMO-01', Active: true, Type: 'Materials markup %', Amount: 20, 'Ask as': 'materials', Applies: 'Manual quotes only' },
  { Factor: 'Trade discount', 'Client ID': 'KS-DEMO-01', Active: true, Type: 'Percent of job', Amount: -10, 'Ask as': 'trade', Applies: 'Manual quotes only' },
  { Factor: 'Executive vehicle', 'Client ID': 'KS-DEMO-02', Active: true, Type: 'Multiplier', Amount: 1.35, 'Ask as': 'executive', Applies: 'When customer says yes' },
  { Factor: 'Airport parking', 'Client ID': 'KS-DEMO-02', Active: true, Type: 'Fixed fee', Amount: 12, 'Ask as': 'airport_fee', Applies: 'Always', 'Only for services': 'Airport transfer', Cost: 12 },
];
const calc = (client, input) => Q.calculate({ services: Q.loadServices(services, client.clientId), factors: Q.loadFactors(factors, client.clientId), client, input });

test('only this client\'s rows are used', () => {
  assert.equal(Q.loadServices(services, 'KS-DEMO-01').length, 3);
  assert.equal(Q.loadFactors(factors, 'KS-DEMO-02').length, 2);
});

test('simple fixed-price service plus VAT', () => {
  const q = calc(A, { description: 'please service my boiler, annual service', answers: {} });
  assert.equal(q.service, 'Boiler service');
  assert.deepEqual([q.subtotal, q.vat, q.total], [95, 19, 114]);
  assert.equal(q.belowMarginFloor, false);
  assert.match(Q.phoneSentence(q, 'Brightwater'), /estimate is about £114/);
});

test('hours beyond included, call-out fee, travel beyond free miles, urgency multiplier', () => {
  const q = calc(A, { service: 'Boiler repair', quantity: 3, answers: { callout: 'yes', miles: 25, urgent: true }, source: 'phone' });
  // 120 + 2x65 = 250 service; x1.5 urgent adds 125; call-out 45; travel 10 x 1.1 = 11 → 431
  assert.equal(q.subtotal, 431);
  assert.ok(q.notes[0].includes('waived'));
  const booked = calc(A, { service: 'Boiler repair', quantity: 1, answers: { callout: 'yes', booked: 'yes' } });
  assert.equal(booked.lines.find((l) => l.description.startsWith('Call-out')).amount, 0);
});

test('materials markup and trade discount only on manual quotes', () => {
  const web = calc(A, { service: 'Boiler service', answers: { materials: 100, trade: 'yes' }, source: 'web' });
  assert.equal(web.subtotal, 95);
  const man = calc(A, { service: 'Boiler service', answers: { materials: 100, trade: 'yes' }, source: 'manual' });
  // 95 + 120 materials (100 + 20%) - 9.5 (10% of service) = 205.5
  assert.equal(man.subtotal, 205.5);
});

test('per-unit service needs a quantity', () => {
  const q = calc(A, { description: 'new radiator', answers: {} });
  assert.deepEqual(q.missing, ['How many radiators?']);
  assert.match(Q.phoneSentence(q, 'x'), /How many radiators/);
  assert.equal(calc(A, { description: 'new radiator', quantity: 2 }).subtotal, 570);
});

test('VAT-inclusive client (chauffeur): always-on fee limited to one service', () => {
  const q = calc(B, { description: 'Heathrow airport run', quantity: 30, answers: { executive: 'yes' } });
  // 35 + 63 = 98 service; x1.35 adds 34.3; + 12 parking = 144.3 inc VAT
  assert.equal(q.total, 144.3);
  assert.equal(q.subtotal, 120.25);
  assert.equal(q.pricesIncludeVat, true);
});

test('margin floor and unmatched jobs', () => {
  const lowA = R.normalizeClient({ fields: { ...DEMO_A, 'Minimum margin %': 80 } });
  assert.equal(calc(lowA, { service: 'Boiler service' }).belowMarginFloor, true);
  const none = calc(A, { description: 'install a heat pump' });
  assert.equal(none.matched, false);
  assert.match(Q.phoneSentence(none, 'Brightwater'), /pass the details/);
  const t = Q.totalsFromLines([{ description: 'x', amount: 100, cost: 90 }], A);
  assert.equal(t.belowMarginFloor, true);
});

test('failure alert: phone workflow is URGENT, client found, plain English, SMS short', () => {
  const payload = { execution: { id: '901', url: 'https://x/execution/901', error: { message: 'Request failed with status code 401 Unauthorized' }, lastNodeExecuted: 'Google Calendar - Book Slot' }, workflow: { id: 'w', name: '[Stock] Phone Booking - 2. Vapi Tools' } };
  const a = Al.buildAlert(payload, { executionData: { x: { clientId: 'KS-DEMO-01' } }, clientName: 'Brightwater' });
  assert.equal(a.level, 'URGENT');
  assert.equal(a.clientId, 'KS-DEMO-01');
  assert.match(a.customerAffected, /^YES/);
  assert.match(a.plain, /rejected our login/);
  assert.match(a.plain, /Google Calendar/);
  assert.ok(a.sms.length <= 320);
  assert.match(a.sms, /Customer\/call affected: YES/);
  assert.match(a.html, /Suggested fix/);
});

test('failure alert: unknown client and template placeholders are ignored', () => {
  const a = Al.buildAlert({ execution: { error: { message: 'connect ETIMEDOUT' }, lastNodeExecuted: 'Xero - Create Invoice' }, workflow: { name: '[Stock] Invoice Automation' } }, { executionData: '{"clientId":"REPLACE_WITH_CLIENT_ID"}' });
  assert.equal(a.clientId, null);
  assert.match(a.plain, /down or too slow/);
  assert.match(a.customerAffected, /^POSSIBLY/);
});

test('alert throttle: one SMS per 30 min, email per 10 min, counts repeats', () => {
  const st = {};
  const t0 = new Date('2026-11-08T10:00:00Z');
  assert.deepEqual(Al.throttle(st, 'wf', t0), { sendSms: true, sendEmail: true, repeats: 0 });
  assert.deepEqual(Al.throttle(st, 'wf', new Date(t0.getTime() + 5 * 60000)), { sendSms: false, sendEmail: false, repeats: 0 });
  const r = Al.throttle(st, 'wf', new Date(t0.getTime() + 11 * 60000));
  assert.deepEqual(r, { sendSms: false, sendEmail: true, repeats: 1 });
  assert.equal(Al.throttle(st, 'wf', new Date(t0.getTime() + 31 * 60000)).sendSms, true);
  assert.equal(Al.throttle(st, 'other', t0).sendSms, true);
});
