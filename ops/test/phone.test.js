'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/phone');
const R = require('../lib/registry');
const { DEMO_A, DEMO_B } = require('../fixtures/clients');

const A = R.normalizeClient({ fields: DEMO_A });
const B = R.normalizeClient({ fields: DEMO_B });
const MON_0700_UTC = new Date('2026-11-09T07:00:00Z'); // Monday 07:00 London (GMT)

test('menu and routing TwiML come from the registry', () => {
  const t = P.menuTwiml(A, 'https://x/webhook/route');
  assert.match(t, /Brightwater Plumbing and Heating/);
  assert.match(t, /Press 1/);
  const sip = P.routeTwiml(A, '2', { vapiSipUri: 'sip:keystone@sip.vapi.ai', fallbackUrl: 'https://x/fallback' });
  assert.match(sip, /X-Keystone-Client=KS-DEMO-01/);
  assert.match(sip, /action="https:\/\/x\/fallback"/);
  assert.match(P.routeTwiml(A, '1', { vapiSipUri: 'sip:x' }), /\+447700900102/);
});

test('SIP failure falls back to reception (fail safe)', () => {
  assert.match(P.fallbackTwiml(A, 'failed'), /<Dial timeout="25">\+447700900102<\/Dial>/);
  assert.match(P.fallbackTwiml(A, 'completed'), /Hangup/);
  const noReception = R.normalizeClient({ fields: { ...DEMO_A, 'Reception forwarding number': '' } });
  assert.match(P.fallbackTwiml(noReception, 'no-answer'), /<Record/);
});

test('assistant prompt uses registry data, honest AI answer, estimate wording, no-money rule', () => {
  const s = P.assistantSystemPrompt(A, MON_0700_UTC);
  assert.match(s, /Brightwater/);
  assert.match(s, /Boiler service: about 60 minutes, from £95/);
  assert.match(s, /answer honestly/);
  assert.match(s, /Always say it is an estimate/);
  assert.match(s, /Never take card details/);
  assert.match(s, /mon: 08:00-17:30/);
  assert.doesNotMatch(s, /Northgate/);
  const asst = P.buildVapiAssistant(B, { serverUrl: 'https://x/vapi' });
  assert.equal(asst.assistant.metadata.clientId, 'KS-DEMO-02');
  assert.ok(asst.assistant.model.tools.some((t) => t.type === 'transferCall' && t.destinations[0].number === '+447700900202'));
  assert.equal(asst.assistant.model.tools.filter((t) => t.type === 'function').length, P.TOOL_DEFS.length);
});

test('empty calendar day returns slots (regression: n8n zero-items halt)', () => {
  const r = P.freeSlots(A, [], { serviceName: 'Boiler service', from: MON_0700_UTC });
  assert.equal(r.fullyBooked, false);
  assert.equal(r.slots.length, 3);
  assert.equal(r.slots[0].start, '2026-11-09T08:00:00.000Z');
});

test('busy events, buffers, all-day blocks and fully booked days', () => {
  const ev = [
    { start: { dateTime: '2026-11-09T08:00:00Z' }, end: { dateTime: '2026-11-09T12:00:00Z' } },
    { start: { dateTime: '2026-11-09T12:30:00Z' }, end: { dateTime: '2026-11-09T12:30:00Z' } }, // zero-duration event uses service duration
  ];
  const r = P.freeSlots(A, ev, { serviceName: 'Boiler service', from: MON_0700_UTC, max: 1 });
  // 08-12 busy, +15 buffer; 12:30 zero-duration becomes 12:30-13:30, +15 buffer, so the first free slot is 13:45 -> step 30 gives 14:00
  assert.equal(r.slots[0].start, '2026-11-09T14:00:00.000Z');
  const allDay = [{ start: { date: '2026-11-09' }, end: { date: '2026-11-10' } }];
  const r2 = P.freeSlots(A, allDay, { serviceName: 'Boiler service', from: MON_0700_UTC, days: 1 });
  assert.equal(r2.fullyBooked, true);
  const r3 = P.freeSlots(A, allDay, { serviceName: 'Boiler service', from: MON_0700_UTC, days: 2 });
  assert.match(r3.slots[0].label, /tue 2026-11-10 at 08:00/);
});

test('closed days are skipped (Sunday) and part of day respected', () => {
  const sun = new Date('2026-11-08T07:00:00Z');
  const r = P.freeSlots(A, [], { serviceName: 'Boiler service', from: sun, max: 1 });
  assert.match(r.slots[0].label, /^mon/);
  const pm = P.freeSlots(A, [], { serviceName: 'Boiler service', from: MON_0700_UTC, partOfDay: 'afternoon', max: 1 });
  assert.equal(pm.slots[0].start, '2026-11-09T12:00:00.000Z');
});

test('slotStillFree re-checks before booking', () => {
  const ev = [{ start: { dateTime: '2026-11-09T09:00:00Z' }, end: { dateTime: '2026-11-09T10:00:00Z' } }];
  assert.equal(P.slotStillFree(A, ev, '2026-11-09T09:30:00Z', 'Boiler service'), false);
  assert.equal(P.slotStillFree(A, ev, '2026-11-09T10:00:00Z', 'Boiler service'), true);
});

test('urgency detection uses client keywords; asked-if-AI detection', () => {
  assert.equal(P.detectUrgency('There is water coming through ceiling!', A.phone.urgentKeywords).urgent, true);
  assert.equal(P.detectUrgency('I would like a boiler service next week', A.phone.urgentKeywords).urgent, false);
  assert.equal(P.askedIfAi('Sorry, am I talking to a robot?'), true);
  assert.equal(P.askedIfAi('Are you a real person?'), true);
  assert.equal(P.askedIfAi('Can I book a service?'), false);
});

test('call outcome logs category, escalations and a safety-net urgent escalation', () => {
  const report = { callId: 'c1', transcript: 'Customer: my pipe has burst and there is a leak everywhere', summary: 'Burst pipe', call: { customer: { number: '+447700900999' } } };
  const o = P.callOutcome(A, report, [{ name: 'take_message', args: {} }]);
  assert.equal(o.row['Client ID'], 'KS-DEMO-01');
  assert.equal(o.row.Escalated, true);
  assert.deepEqual(o.safetyNetEscalation.slice(0, 2), ['leak', 'burst']);
  assert.ok(o.events.includes('urgent_escalated'));
  const b = P.callOutcome(A, { transcript: 'book please' }, [{ name: 'book_appointment', args: { service: 'Boiler service', start: '2026-11-10T09:00:00Z', customerName: 'Jo' } }]);
  assert.equal(b.row.Category, 'Booking');
  assert.equal(b.safetyNetEscalation, null);
  assert.ok(b.events.includes('booking_made'));
});

test('Vapi payload parsing and client id from metadata or SIP header', () => {
  const body = { message: { type: 'tool-calls', toolCallList: [{ id: 't1', function: { name: 'check_availability', arguments: '{"service":"Boiler service"}' } }], call: { assistant: { metadata: { clientId: 'KS-DEMO-01' } } } } };
  assert.deepEqual(P.parseToolCalls(body), [{ id: 't1', name: 'check_availability', args: { service: 'Boiler service' } }]);
  assert.equal(P.vapiClientId(body), 'KS-DEMO-01');
  assert.equal(P.vapiClientId({ message: { call: { phoneCallProviderDetails: { sipHeaders: { 'X-Keystone-Client': 'KS-DEMO-02' } } } } }), 'KS-DEMO-02');
});
