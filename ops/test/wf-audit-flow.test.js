'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build-workflows');
const { simulate } = require('../scripts/simulate');
const A = require('../lib/auditflow');
const AT = require('../config/airtable.json');
const wf = build({ write: false }).workflows['KS Audit Flow'];
const T = AT.tables;
const DAY = 864e5;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
// London time slots N days ahead at 10:00 / 14:00 (written the way Bilal would type them)
const slotLine = (days, hh) => { const d = new Date(NOW + days * DAY); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${hh}:00`; };

const SETTINGS = { agent_run_token: 'tok', audit_hook_token: 'hook', audit_payment_link_id: 'plink_audit', alert_email: 'khan.bilalbk408@gmail.com', sending_domain: 'keystoneconsultancyuk.co.uk', domain_status: 'Verified',
  sending_address: 'bilal.khan', client_contact_email: 'bilal.khan@keystoneconsultancyuk.co.uk', email_from: 'Bilal Khan | Keystone <bilal.khan@keystoneconsultancyuk.co.uk>', keystone_xero_tenant_id: 'tenant-1', agreement_approved: 'yes' };
const settingsRecs = (extra = {}) => Object.entries({ ...SETTINGS, ...extra }).map(([k, v]) => ({ id: 'r' + k, fields: { Setting: k, Value: v } }));
const rec = (fields) => ({ id: 'recAudit000000001', fields: { 'Business name': 'Acme Plumbing Ltd', 'Contact name': 'Sam Jones', 'Contact email': 'sam@acme-plumbing.co.uk', 'Client token': 'clienttoken123', 'Revenue band': '£1M–£3M', ...fields } });

function mocks({ intakes = [], S = {}, extra = {} } = {}) {
  const writes = [];
  const m = {
    'Read Airtable': (req) => ({ statusCode: 200, body: { records: req.url.includes(T.settings) ? settingsRecs(S) : intakes } }),
    'Stripe: read Airtable': (req) => ({ statusCode: 200, body: { records: req.url.includes(T.settings) ? settingsRecs(S) : intakes } }),
    'Page: read record': () => ({ statusCode: 200, body: { records: intakes } }),
    'Page: read settings': () => ({ statusCode: 200, body: { records: settingsRecs(S) } }),
    'Email sender settings': () => ({ statusCode: 200, body: { records: settingsRecs(S) } }),
    'Airtable write': (req) => { writes.push(req); return { statusCode: 200, body: {} }; },
    'Send email': (req) => { writes.push(req); return { statusCode: 200, body: { id: 'e' } }; },
    'Call webhook': (req) => { writes.push(req); return { statusCode: 200, body: {} }; },
    'Tell Bilal': () => ({ ok: true }),
    ...extra,
  };
  return { m, writes };
}
const emails = (x) => x.writes.filter((w) => w.url === 'https://api.resend.com/emails').map((w) => w.body);
const updates = (x, tbl = T.auditIntakes) => x.writes.filter((w) => w.url && w.url.includes(tbl) && w.method === 'PATCH').flatMap((w) => w.body.records);
const notices = (r) => r.calls.filter((c) => c.node === 'Tell Bilal').map((c) => c.req.text);
const event = (id = 'recAudit000000001', token = 'hook') => [{ headers: { 'content-type': 'application/json' }, body: { recordId: id, token } }];
const noGmail = (mail) => assert.ok(!/gmail/i.test(JSON.stringify({ from: mail.from, reply_to: mail.reply_to, html: mail.html, text: mail.text })), 'a gmail address was shown to the client');

test('slot parsing: UK time, readable formats, wrong weekday caught', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  assert.equal(A.parseSlot('2026-11-18 10:00', now), '2026-11-18T10:00:00.000Z');
  assert.equal(A.parseSlot('18/6/2027 10:00', now), '2027-06-18T09:00:00.000Z', 'summer time');
  assert.equal(A.parseSlot('19 November at 2pm', now), '2026-11-19T14:00:00.000Z');
  const p = A.parseSlots('Tue 18 Nov 10:00\nThu 19 Nov 14:00\nsoon', now);
  assert.equal(p.slots.length, 1); assert.equal(p.errors.length, 2); assert.match(p.errors[0], /Wednesday/);
});

test('Stripe: a held payment from the audit link -> Audit Intakes "Held", Bilal alerted; other links ignored', async () => {
  const session = { object: 'checkout.session', id: 'cs_1', status: 'complete', payment_link: 'plink_audit', customer_details: { email: 'Sam@Acme-Plumbing.co.uk', name: 'Sam Jones' }, collected_information: { individual_name: 'Sam Jones', business_name: 'Acme Plumbing Ltd' }, payment_intent: { id: 'pi_1', status: 'requires_capture' } };
  const x = mocks({ extra: { 'Stripe: read object': () => ({ statusCode: 200, body: session }) } });
  const r = await simulate(wf, { start: 'Stripe event', items: [{ body: { type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } } }], mocks: x.m });
  assert.deepEqual(r.errors, []);
  const created = x.writes.find((w) => w.method === 'POST' && w.url.includes(T.auditIntakes)).body.records[0].fields;
  assert.equal(created['Payment status'], 'Held'); assert.equal(created.Status, 'Held'); assert.equal(created['Payment intent ID'], 'pi_1'); assert.equal(created['Business name'], 'Acme Plumbing Ltd'); assert.equal(created['Contact email'], 'sam@acme-plumbing.co.uk');
  assert.match(notices(r)[0], /£100 audit hold placed by Sam Jones/);
  const y = mocks({ extra: { 'Stripe: read object': () => ({ statusCode: 200, body: { ...session, payment_link: 'plink_other' } }) } });
  await simulate(wf, { start: 'Stripe event', items: [{ body: { type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } } }], mocks: y.m });
  assert.equal(y.writes.length, 0);
  const z = mocks({ extra: { 'Stripe: read object': () => ({ statusCode: 200, body: { ...session, payment_intent: { id: 'pi_1', status: 'succeeded' } } }) } });
  await simulate(wf, { start: 'Stripe event', items: [{ body: { type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } } }], mocks: z.m });
  assert.equal(z.writes.length, 0, 'only holds (manual capture) are accepted');
});

test('Bilal fills Available slots -> client emailed from bilal.khan@: reserved not charged, times, recording line; no gmail', async () => {
  const x = mocks({ intakes: [rec({ 'Payment status': 'Held', Status: 'Held', 'Hold placed at': iso(NOW - 3600e3), 'Available slots': `${slotLine(2, 10)}\n${slotLine(3, 14)}` })] });
  const r = await simulate(wf, { start: 'Airtable change', items: event(), mocks: x.m });
  assert.deepEqual(r.errors, []);
  const [mail] = emails(x);
  assert.equal(mail.from, 'Bilal Khan | Keystone <bilal.khan@keystoneconsultancyuk.co.uk>');
  assert.equal(mail.reply_to, 'bilal.khan@keystoneconsultancyuk.co.uk');
  assert.match(mail.text, /reserved, not charged/); assert.match(mail.text, /Calls are recorded for note-taking\. Let us know if you’d prefer not\./);
  assert.match(mail.html, /ks-audit-pick\?r=recAudit000000001&amp;t=clienttoken123&amp;c=1&amp;s=0/);
  noGmail(mail);
  assert.ok(updates(x)[0].fields['Slots emailed at']);
  // a wrong token does nothing
  const y = mocks({ intakes: x.m['Read Airtable']({ url: '' }).body.records });
  await simulate(wf, { start: 'Airtable change', items: event(undefined, 'wrong'), mocks: y.m });
  assert.equal(y.writes.length, 0);
});

test('unreadable slots: nothing sent, Bilal told why', async () => {
  const x = mocks({ intakes: [rec({ 'Payment status': 'Held', 'Hold placed at': iso(NOW), 'Available slots': 'sometime next week' })] });
  const r = await simulate(wf, { start: 'Airtable change', items: event(), mocks: x.m });
  assert.equal(emails(x).length, 0); assert.match(notices(r)[0], /not sent/);
});

test('client picks a time: confirmation page, then Confirmed time logged and Bilal alerted', async () => {
  const r0 = rec({ 'Payment status': 'Held', 'Available slots': `${slotLine(2, 10)}\n${slotLine(3, 14)}`, 'Slots emailed at': iso(NOW) });
  const x = mocks({ intakes: [r0] });
  const g = await simulate(wf, { start: 'Pick page', items: [{ query: { r: r0.id, t: 'clienttoken123', c: '1', s: '1' } }], mocks: x.m });
  assert.deepEqual(g.errors, []); assert.match(g.responses[0].body, /Yes, book this time/); assert.equal(x.writes.length, 0, 'clicking a link changes nothing (link scanners)');
  const p = await simulate(wf, { start: 'Pick submit', items: [{ body: { r: r0.id, t: 'clienttoken123', c: '1', s: '1', norec: '1' } }], mocks: x.m });
  assert.deepEqual(p.errors, []);
  const f = updates(x)[0].fields;
  assert.ok(f['Confirmed time']); assert.ok(f['Confirmed time at']); assert.equal(f.Recording, 'Prefers not'); assert.equal(f.Status, 'Time chosen');
  assert.match(notices(p)[0], /picked .* for call 1 \(prefers the call NOT recorded\)/);
  const bad = await simulate(wf, { start: 'Pick page', items: [{ query: { r: r0.id, t: 'guess', c: '1', s: '0' } }], mocks: mocks({ intakes: [r0] }).m });
  assert.match(bad.responses[0].body, /not valid/);
  assert.ok(!/gmail/.test(bad.responses[0].body));
});

test('Confirm -> £100 captured, Google Meet (client not a Google attendee), invite + .ics + intake form emailed', async () => {
  const start = A.parseSlot(slotLine(2, 10));
  let meetReq = null;
  const x = mocks({ intakes: [rec({ 'Payment status': 'Held', 'Payment intent ID': 'pi_1', Confirm: true, 'Confirmed time': 'x', 'Confirmed time at': start, 'Hold placed at': iso(NOW - DAY) })], extra: {
    'Stripe: capture': (req) => { assert.match(req.url, /payment_intents\/pi_1\/capture$/); return { statusCode: 200, body: { id: 'pi_1', status: 'succeeded' } }; },
    'Google Meet: call 1': (req) => { meetReq = req; return { statusCode: 200, body: { id: 'ev1', hangoutLink: 'https://meet.google.com/abc-defg-hij' } }; },
  } });
  const r = await simulate(wf, { start: 'Airtable change', items: event(), mocks: x.m });
  assert.deepEqual(r.errors, []);
  assert.match(meetReq.url, /sendUpdates=none/); assert.equal(meetReq.body.attendees, undefined);
  const f = updates(x)[0].fields;
  assert.equal(f['Payment status'], 'Captured'); assert.equal(f.Status, 'Call 1 booked'); assert.equal(f['Call 1 Meet link'], 'https://meet.google.com/abc-defg-hij');
  const [mail] = emails(x);
  noGmail(mail);
  assert.match(mail.html, /ks-audit-prep\?r=recAudit000000001/); assert.match(mail.text, /meet\.google\.com/);
  const ics = Buffer.from(mail.attachments[0].content, 'base64').toString();
  assert.match(ics, /ORGANIZER;CN=Bilal Khan \(Keystone\):mailto:bilal\.khan@keystoneconsultancyuk\.co\.uk/); assert.ok(!/gmail/.test(ics));
});

test('capture fails (hold expired) -> nothing booked, Bilal told', async () => {
  const x = mocks({ intakes: [rec({ 'Payment status': 'Held', 'Payment intent ID': 'pi_1', Confirm: true, 'Confirmed time at': A.parseSlot(slotLine(2, 10)) })], extra: {
    'Stripe: capture': () => ({ statusCode: 400, body: { error: { message: 'This PaymentIntent could not be captured because it has a status of canceled.' } } }),
  } });
  const r = await simulate(wf, { start: 'Airtable change', items: event(), mocks: x.m });
  assert.ok(!r.ran.includes('Google Meet: call 1')); assert.equal(emails(x).length, 0);
  assert.equal(updates(x)[0].fields['Payment status'], 'Capture failed'); assert.match(notices(r)[0], /Could not take the £100/);
});

test('day 3 and day 5 chases, day 6 hold released and client told nothing was charged', async () => {
  const slots = `${slotLine(2, 10)}`;
  const d3 = mocks({ intakes: [rec({ 'Payment status': 'Held', 'Hold placed at': iso(NOW - 3.2 * DAY), 'Available slots': slots, 'Slots emailed at': iso(NOW - 3 * DAY) })] });
  await simulate(wf, { start: 'Every 2 hours, 09-19', items: [{}], mocks: d3.m });
  assert.match(emails(d3)[0].subject, /pick a time/); assert.ok(updates(d3)[0].fields['Chase 1 sent at']);
  const d5 = mocks({ intakes: [rec({ 'Payment status': 'Held', 'Hold placed at': iso(NOW - 5.1 * DAY), 'Available slots': slots, 'Slots emailed at': iso(NOW - 5 * DAY), 'Chase 1 sent at': iso(NOW - 2 * DAY), 'Confirmed time': 'Wed 18 Nov, 10:00' })] });
  const r5 = await simulate(wf, { start: 'Every 2 hours, 09-19', items: [{}], mocks: d5.m });
  assert.equal(emails(d5).length, 0, 'they picked a time: Bilal is chased, not the client'); assert.match(notices(r5)[0], /Tick Confirm/);
  let cancelUrl = null;
  const d6 = mocks({ intakes: [rec({ 'Payment status': 'Held', 'Payment intent ID': 'pi_9', 'Hold placed at': iso(NOW - 6.1 * DAY), 'Chase 1 sent at': iso(NOW), 'Chase 2 sent at': iso(NOW) })], extra: { 'Stripe: call': (req) => { cancelUrl = req.url; return { statusCode: 200, body: { status: 'canceled' } }; } } });
  await simulate(wf, { start: 'Every 2 hours, 09-19', items: [{}], mocks: d6.m });
  assert.match(cancelUrl, /payment_intents\/pi_9\/cancel$/);
  assert.match(emails(d6)[0].text, /Nothing was charged/); assert.equal(updates(d6)[0].fields['Payment status'], 'Released');
  noGmail(emails(d6)[0]);
});

test('24h reminder for call 1, once', async () => {
  const x = mocks({ intakes: [rec({ 'Payment status': 'Captured', 'Call 1 at': iso(NOW + 25 * 3600e3), 'Call 1 Meet link': 'https://meet.google.com/x' })] });
  await simulate(wf, { start: 'Every 2 hours, 09-19', items: [{}], mocks: x.m });
  assert.match(emails(x)[0].subject, /^Tomorrow/); assert.equal(updates(x)[0].fields['Call 1 reminder sent'], true);
  assert.equal(emails(x)[0].from, 'Keystone Operations <operations@keystoneconsultancyuk.co.uk>');
});

test('transcript -> Opus -> PDF -> "Report ready" with the exact quote (multi-service discount, £100 credit)', async () => {
  const report = { summary: 'Too much admin.', findings: [{ area: 'invoicing', problem: 'Invoices typed by hand', evidence: '6 h/week x 52', hours_per_year: 312, gbp_per_year: 6137 }, { area: 'calls', problem: 'Missed calls', evidence: '5 a week', hours_per_year: 50, gbp_per_year: 9000 }],
    hours_lost_per_year: 362, money_lost_per_year_gbp: 60000, recommended_services: ['invoicing', 'phone'], why_these: 'Biggest losses.', quick_wins: ['Turn on Xero reminders'] };
  let attach = null;
  const x = mocks({ intakes: [rec({ 'Payment status': 'Captured', 'Call 1 at': iso(NOW - DAY), Transcript: 'Bilal: ... Sam: we lose calls ...' })], extra: {
    'Claude: report': (req) => { assert.equal(req.body.model, 'claude-opus-5-5'); return { statusCode: 200, body: { content: [{ type: 'text', text: JSON.stringify(report) }], usage: { input_tokens: 1000, output_tokens: 500 }, model: 'claude-opus-5-5' } }; },
    'Drive: create doc': (req) => { assert.match(req.contentType, /^multipart\/related; boundary=/); assert.match(req.body, /application\/vnd\.google-apps\.document/); return { statusCode: 200, body: { id: 'doc1' } }; },
    'Drive: export PDF': () => ({ __binary: { data: { data: Buffer.from('%PDF-1.4 test').toString('base64'), mimeType: 'application/pdf' } } }),
    'Airtable: attach PDF': (req) => { attach = req; return { statusCode: 200, body: { fields: { 'Report PDF': [{ url: 'https://dl.airtable.com/r.pdf' }] } } }; },
  } });
  const r = await simulate(wf, { start: 'Every 2 hours, 09-19', items: [{}], mocks: x.m });
  assert.deepEqual(r.errors, []);
  assert.match(attach.url, /content\.airtable\.com\/v0\/.+\/recAudit000000001\/Report%20PDF\/uploadAttachment/); assert.equal(Buffer.from(attach.body.file, 'base64').toString(), '%PDF-1.4 test');
  const f = updates(x)[0].fields;
  assert.equal(f.Status, 'Report ready');
  const q = JSON.parse(f['Report JSON']).quote;
  assert.equal(q.setup.total, 3000 * 0.9); assert.equal(q.setupAfterCredit, 2600); assert.equal(q.package.name, 'Growth'); assert.equal(q.package.price, 1500);
  assert.match(notices(r)[0], /setup £2,600 after the £100 credit/);
  assert.ok(x.writes.some((w) => w.url.includes(T.aiUsage)), 'AI cost logged');
});

test('Call 2: slots must be 3-7 days after Call 1; confirm -> Meet; report emailed 24h before with the PDF', async () => {
  const call1 = NOW - DAY;
  const base = { 'Payment status': 'Captured', 'Call 1 at': iso(call1), Transcript: 't', 'Report JSON': '{}', 'Report PDF': [{ url: 'https://dl.airtable.com/r.pdf' }], 'Approve report': true };
  const early = mocks({ intakes: [rec({ ...base, 'Call 2 slots': slotLine(1, 10) })] });
  const re = await simulate(wf, { start: 'Airtable change', items: event(), mocks: early.m });
  assert.equal(emails(early).length, 0); assert.match(notices(re)[0], /not 3-7 days after Call 1/);
  const ok = mocks({ intakes: [rec({ ...base, 'Call 2 slots': `${slotLine(3, 10)}\n${slotLine(4, 14)}` })] });
  await simulate(wf, { start: 'Airtable change', items: event(), mocks: ok.m });
  assert.match(emails(ok)[0].html, /c=2&amp;s=1/); assert.equal(updates(ok)[0].fields.Status, 'Call 2 offered');
  const start2 = A.parseSlot(slotLine(3, 10));
  const conf = mocks({ intakes: [rec({ ...base, 'Call 2 slots': slotLine(3, 10), 'Call 2 slots emailed at': iso(NOW), 'Call 2 confirmed at': start2, 'Confirm call 2': true })], extra: { 'Google Meet: call 2': () => ({ statusCode: 200, body: { id: 'ev2', hangoutLink: 'https://meet.google.com/two' } }) } });
  await simulate(wf, { start: 'Airtable change', items: event(), mocks: conf.m });
  assert.equal(updates(conf)[0].fields.Status, 'Call 2 booked');
  const send = mocks({ intakes: [rec({ ...base, 'Call 2 slots emailed at': iso(NOW), 'Call 2 event ID': 'ev2', 'Call 2 at': iso(NOW + 26 * 3600e3), 'Call 2 Meet link': 'https://meet.google.com/two' })] });
  await simulate(wf, { start: 'Every 2 hours, 09-19', items: [{}], mocks: send.m });
  const rep = emails(send)[0];
  assert.equal(rep.attachments[0].path, 'https://dl.airtable.com/r.pdf'); assert.ok(updates(send)[0].fields['Report sent at']); noGmail(rep);
});

test('Won -> agreement PDF + Xero setup invoice (setup minus £100) from Accounts; blocked until the agreement is approved', async () => {
  const quote = A.quoteFor(['invoicing', 'phone'], '£1M–£3M', 60000);
  const base = { 'Payment status': 'Captured', Outcome: 'Won', 'Report JSON': JSON.stringify({ findings: {}, quote }) };
  const blocked = mocks({ intakes: [rec(base)], S: { agreement_approved: 'no' } });
  const rb = await simulate(wf, { start: 'Airtable change', items: event(), mocks: blocked.m });
  assert.equal(emails(blocked).length, 0); assert.match(notices(rb)[0], /solicitor-checked/);
  let invoice = null;
  const x = mocks({ intakes: [rec(base)], extra: {
    'Drive: create doc': () => ({ statusCode: 200, body: { id: 'doc2' } }),
    'Drive: export PDF': () => ({ __binary: { data: { data: Buffer.from('%PDF agreement').toString('base64') } } }),
    'Airtable: attach PDF': () => ({ statusCode: 200, body: { fields: { 'Agreement PDF': [{ url: 'https://dl.airtable.com/a.pdf' }] } } }),
    'Xero: create invoice': (req) => { invoice = { ...req, tenantId: req.headers['xero-tenant-id'] }; return { statusCode: 200, body: { Invoices: [{ InvoiceID: 'inv-1', InvoiceNumber: 'INV-0042' }] } }; },
    'Xero: online invoice': () => ({ statusCode: 200, body: { OnlineInvoices: [{ OnlineInvoiceUrl: 'https://in.xero.com/abc' }] } }),
  } });
  const r = await simulate(wf, { start: 'Airtable change', items: event(), mocks: x.m });
  assert.deepEqual(r.errors, []);
  const total = invoice.body.Invoices[0].LineItems.reduce((s, l) => s + l.UnitAmount * l.Quantity, 0);
  assert.equal(total, 2600); assert.equal(invoice.tenantId, 'tenant-1');
  const [welcome, inv] = emails(x);
  assert.equal(welcome.from, 'Bilal Khan | Keystone <bilal.khan@keystoneconsultancyuk.co.uk>'); assert.equal(welcome.attachments[0].path, 'https://dl.airtable.com/a.pdf');
  assert.equal(inv.from, 'Keystone Accounts <accounts@keystoneconsultancyuk.co.uk>'); assert.match(inv.text, /£2,600/); assert.match(inv.text, /in\.xero\.com/);
  noGmail(welcome); noGmail(inv);
  assert.equal(updates(x)[0].fields.Status, 'Won');
});

test('Lost -> nurture only with consent', async () => {
  const yes = mocks({ intakes: [rec({ 'Payment status': 'Captured', Outcome: 'Lost', 'Marketing consent': true })] });
  await simulate(wf, { start: 'Airtable change', items: event(), mocks: yes.m });
  const up = yes.writes.find((w) => w.url.includes(T.prospects));
  assert.deepEqual(up.body.performUpsert, { fieldsToMergeOn: ['Email'] }); assert.equal(up.body.records[0].fields['Nurture status'], 'Active'); assert.equal(up.body.records[0].fields.Source, 'Audit');
  const no = mocks({ intakes: [rec({ 'Payment status': 'Captured', Outcome: 'Lost' })] });
  const r = await simulate(wf, { start: 'Airtable change', items: event(), mocks: no.m });
  assert.ok(!no.writes.some((w) => w.url.includes(T.prospects))); assert.match(notices(r)[0], /did not tick the consent box/);
});

test('intake form: only after capture; answers saved to Audit Intakes', async () => {
  const r0 = rec({ 'Payment status': 'Captured' });
  const x = mocks({ intakes: [r0] });
  const g = await simulate(wf, { start: 'Prep page', items: [{ query: { r: r0.id, t: 'clienttoken123' } }], mocks: x.m });
  assert.match(g.responses[0].body, /top 3 manual tasks/i);
  const p = await simulate(wf, { start: 'Prep submit', items: [{ body: { r: r0.id, t: 'clienttoken123', tools: 'Xero, Tradify', team: '12', band: '£1M–£3M', tasks: 'invoices\nquotes\nchasing', hours: '15', consent: '1' } }], mocks: x.m });
  assert.deepEqual(p.errors, []);
  const f = updates(x)[0].fields;
  assert.equal(f['Admin hours per week'], 15); assert.equal(f['Marketing consent'], true); assert.ok(f['Intake form done at']); assert.equal(f['Revenue band'], '£1M–£3M');
  const held = await simulate(wf, { start: 'Prep page', items: [{ query: { r: r0.id, t: 'clienttoken123' } }], mocks: mocks({ intakes: [rec({ 'Payment status': 'Held' })] }).m });
  assert.match(held.responses[0].body, /opens once your call is confirmed/);
});
