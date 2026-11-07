'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../lib/quote');
const { plumbingRules, chauffeurRules } = require('../fixtures/clients');

test('plumbing: boiler service matched by description, VAT added', () => {
  const r = Q.priceWithRules(plumbingRules, { description: 'Can you service my boiler please', inputs: { miles: 5 } });
  assert.equal(r.covered, true);
  assert.equal(r.service, 'boiler_service');
  const f = Q.finalizeQuote(plumbingRules, r.lines, { minMarginPct: 35 });
  assert.equal(f.subtotal, 95);
  assert.equal(f.vat, 19);
  assert.equal(f.total, 114);
  assert.equal(f.belowMarginFloor, false);
});

test('plumbing: travel beyond free miles, out-of-hours modifier, unit rates', () => {
  const r = Q.priceWithRules(plumbingRules, { description: 'leak under the sink', inputs: { miles: 25, out_of_hours: true, extra_hours: 1 } });
  const desc = r.lines.map((l) => l.description);
  assert.ok(desc.includes('Travel (10 miles)'));
  assert.ok(desc.some((d) => d.startsWith('Out of hours')));
  const f = Q.finalizeQuote(plumbingRules, r.lines);
  // (110 + 65) * 1.5 = 262.5, plus 11 travel = 273.5
  assert.equal(f.subtotal, 273.5);
});

test('minimum charge tops up small jobs', () => {
  const f = Q.finalizeQuote(plumbingRules, [{ description: 'Tiny job', amount: 40, cost: 10 }]);
  assert.equal(f.subtotal, 85);
  assert.ok(f.lines.some((l) => l.description === 'Minimum charge adjustment'));
});

test('missing required inputs are reported for follow-up', () => {
  const r = Q.priceWithRules(plumbingRules, { description: 'replace radiator in the lounge', inputs: {} });
  assert.equal(r.covered, false);
  assert.deepEqual(r.missingInputs, ['radiators']);
});

test('unknown jobs are not covered (handed to the quote agent)', () => {
  assert.equal(Q.priceWithRules(plumbingRules, { description: 'install a heat pump and solar thermal' }).covered, false);
  assert.equal(Q.priceWithRules(null, { description: 'x' }).reason, 'no_pricing_rules');
});

test('chauffeur rules (the original calculator, generalised): mileage, vehicle, location', () => {
  const r = Q.priceWithRules(chauffeurRules, { description: 'Airport run to Heathrow', inputs: { miles: 30, vehicle: 'executive', location: 'Heathrow Terminal 5' } });
  assert.equal(r.service, 'airport_transfer');
  const f = Q.finalizeQuote(chauffeurRules, r.lines, { minMarginPct: 40 });
  // (35 + 63) * 1.35 = 132.3, plus 12 airport fee = 144.3 inc VAT
  assert.equal(f.total, 144.3);
  assert.equal(f.subtotal, 120.25);
  assert.equal(f.vat, 24.05);
});

test('margin floor flagged', () => {
  const f = Q.finalizeQuote(plumbingRules, [{ description: 'Heat pump survey', amount: 200, cost: 180 }], { minMarginPct: 35 });
  assert.equal(f.marginPct, 10);
  assert.equal(f.belowMarginFloor, true);
});

test('similar past quotes are ranked by word overlap', () => {
  const past = [{ description: 'Replace two radiators and bleed system', total: 700 }, { description: 'Boiler service', total: 114 }];
  const s = Q.similarQuotes('fit three new radiators upstairs', past);
  assert.equal(s[0].total, 700);
});
