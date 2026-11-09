'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build-workflows');
const { simulate } = require('../scripts/simulate');
const C = require('../lib/calc');
const P = require('../lib/pricing');
const wf = build({ write: false }).workflows['KS Website Calculator'];
const ME = 'khan.bilalbk408@gmail.com';

function settings(extra = {}) {
  return Object.entries({ agent_run_token: 'salt', email_from: 'Keystone <onboarding@resend.dev>', domain_status: '', website_calculator: 'auto', ...extra }).map(([k, v]) => ({ id: 'r' + k, fields: { Setting: k, Value: v } }));
}
function startMocks({ S = settings(), recent = [] } = {}) {
  const writes = [];
  return { writes, m: {
    'Get settings (start)': () => ({ body: { records: S } }), 'Get recent requests': () => ({ body: { records: recent.map((f) => ({ fields: f })) } }),
    'Airtable write': (req) => { writes.push(req); return { body: {} }; }, 'Send email': (req) => { writes.push(req); return { body: { id: 'e' } }; }, 'Call webhook': (req) => { writes.push(req); return { body: {} }; },
  } };
}
const form = (over = {}) => ({ headers: { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ name: 'Sam Test', email: ME, company: 'KS TEST Calc Ltd', revenueBand: '1m-3m', services: ['phone', 'invoicing'], consent: true, website: '', ...over }) });
const resp = (r) => JSON.parse(r.responses[0].body);

test('pricing: approved numbers', () => {
  assert.equal(P.packagePrice('starter', '500k-1m'), 600); assert.equal(P.packagePrice('growth', '1m-3m'), 1500); assert.equal(P.packagePrice('complete', '3m-10m'), 3750);
  assert.equal(P.setupQuote(['invoicing', 'phone']).total, 3000 * 0.9);
  assert.equal(P.setupQuote(['invoicing', 'phone', 'quotes', 'reporting']).total, 5750 * 0.8);
  assert.equal(P.packageFor(2).name, 'Growth');
  assert.equal(P.priceProposal(['invoicing'], { revenue: '1m-3m', monthlyLoss: 1500 }).senseCheck.ok, false);
  assert.equal(P.priceProposal(['invoicing'], { revenue: '1m-3m', monthlyLoss: 3000 }).senseCheck.ok, true);
  assert.equal(P.setupQuote(['invoicing'], { pilot: true }).total, 875);
});

test('calc rules: free-mail, rate limit, code checks', () => {
  assert.equal(C.isFreeMail('a@gmail.com'), true); assert.equal(C.isFreeMail('a@acme.co.uk'), false);
  assert.equal(C.rateLimited([{ Email: 'a@b.co' }, { Email: 'a@b.co' }, { Email: 'a@b.co' }], 'a@b.co', 'x'), true);
  assert.equal(C.rateLimited([{ 'IP hash': 'x' }, { 'IP hash': 'x' }], 'a@b.co', 'x'), false);
  const row = { 'Code hash': C.hash('123456', 's'), Expires: new Date(Date.now() + 60000).toISOString(), Attempts: 0 };
  assert.equal(C.checkCode(row, '123456', 's').ok, true);
  assert.equal(C.checkCode(row, '000000', 's').reason, 'wrong');
  assert.equal(C.checkCode({ ...row, Attempts: 3 }, '123456', 's').reason, 'locked');
  assert.equal(C.checkCode({ ...row, Expires: new Date(Date.now() - 1000).toISOString() }, '123456', 's').reason, 'expired');
  assert.equal(C.sendingAllowed({ domain_status: '' }, 'someone@acme.co.uk', ME), false);
  assert.equal(C.sendingAllowed({ domain_status: '' }, ME, ME), true);
  assert.equal(C.sendingAllowed({ domain_status: 'Verified', email_from: 'Keystone <hello@k.co.uk>' }, 'someone@acme.co.uk', ME), true);
  assert.equal(C.sendingAllowed({ domain_status: 'Verified', email_from: 'Keystone <hello@k.co.uk>', website_calculator: 'off' }, 'someone@acme.co.uk', ME), false);
});

test('start: honeypot -> fake success, nothing stored or sent', async () => {
  const x = startMocks();
  const r = await simulate(wf, { start: 'Calc start', items: [form({ website: 'http://spam' })], mocks: x.m });
  assert.deepEqual(r.errors, []); assert.equal(resp(r).ok, true); assert.equal(x.writes.length, 0);
});

test('start: before the domain is verified only Bilal\'s inbox gets a code; others see "coming soon"', async () => {
  const a = startMocks();
  const r = await simulate(wf, { start: 'Calc start', items: [form()], mocks: a.m });
  assert.deepEqual(r.errors, []); assert.equal(resp(r).ok, true);
  const mail = a.writes.find((w) => w.url === 'https://api.resend.com/emails');
  assert.ok(mail && mail.body.to[0] === ME && /\d{6}/.test(mail.body.subject));
  const row = a.writes.find((w) => w.url && w.url.includes('tblEYlJXiMuNdRYkw')).body.records[0].fields;
  assert.ok(row['Code hash'] && !JSON.stringify(row).includes(mail.body.subject.slice(-6)));
  const b = startMocks();
  const r2 = await simulate(wf, { start: 'Calc start', items: [form({ email: 'owner@acme-plumbing.co.uk' })], mocks: b.m });
  assert.equal(resp(r2).comingSoon, true); assert.equal(b.writes.length, 0);
  const c = startMocks({ S: settings({ domain_status: 'Verified', email_from: 'Keystone <hello@keystone.co.uk>' }) });
  const r3 = await simulate(wf, { start: 'Calc start', items: [form({ email: 'owner@acme-plumbing.co.uk' })], mocks: c.m });
  assert.equal(resp(r3).ok, true); assert.ok(c.writes.some((w) => w.url === 'https://api.resend.com/emails'));
});

test('start: validation errors and the daily limit', async () => {
  const a = startMocks();
  const r = await simulate(wf, { start: 'Calc start', items: [form({ email: 'nope', revenueBand: '' })], mocks: a.m });
  assert.equal(r.responses[0].body.includes('valid business email'), true);
  const b = startMocks({ recent: [{ Email: ME }, { Email: ME }, { Email: ME }] });
  const r2 = await simulate(wf, { start: 'Calc start', items: [form()], mocks: b.m });
  assert.match(resp(r2).message, /3 codes today/); assert.equal(b.writes.length, 0);
});

function verifyMocks(row, prospects = []) {
  const writes = [];
  return { writes, m: {
    'Get settings (verify)': () => ({ body: { records: settings() } }), 'Get request row': () => ({ body: { records: row ? [{ id: 'recReq', fields: row }] : [] } }),
    'Find prospect': () => ({ body: { records: prospects } }), 'Save prospect': (req) => { writes.push(req); return { body: { records: [{ id: 'recNewLead' }] } }; },
    'Airtable write': (req) => { writes.push(req); return { body: {} }; }, 'Call webhook': (req) => { writes.push(req); return { body: {} }; }, 'Send email': () => ({ body: {} }),
  } };
}
const reqRow = (over = {}) => ({ 'Code hash': C.hash('482913', 'salt'), Expires: new Date(Date.now() + 600000).toISOString(), Attempts: 0, Email: ME, 'Data JSON': JSON.stringify({ name: 'Sam Test', email: 'sam@gmail.com', company: 'KS TEST Calc Ltd', revenueBand: '1m-3m', services: ['phone', 'invoicing'], consent: true }), ...over });

test('verify: right code -> from-prices only, lead saved (Website, free-mail flagged, consent), Client Hunter scores it', async () => {
  const x = verifyMocks(reqRow());
  const r = await simulate(wf, { start: 'Calc verify', items: [{ body: JSON.stringify({ requestId: 'abc', code: '482913' }) }], mocks: x.m });
  assert.deepEqual(r.errors, []);
  const out = resp(r);
  assert.equal(out.ok, true); assert.equal(out.setupFrom, 2700); assert.equal(out.monthlyFrom, 1500); assert.equal(out.note, 'Exact price depends on business size.');
  assert.match(out.cta, /£100 \(normally £750\)/);
  const lead = x.writes.find((w) => w.url && w.url.includes('tblnjK4LLfZSqiGRc')).body.records[0].fields;
  assert.equal(lead.Source, 'Website'); assert.equal(lead['Free-mail address'], true); assert.equal(lead['Marketing consent'], true); assert.ok(lead['Unsubscribe token']);
  assert.ok(x.writes.some((w) => w.url && w.url.endsWith('/ks-agent-lead-researcher') && w.body.stage === 'score' && w.body.prospectId === 'recNewLead'));
  assert.ok(x.writes.some((w) => w.url && w.url.includes('tblEYlJXiMuNdRYkw') && w.body.records[0].fields.Verified === true));
});

test('verify: wrong code counts an attempt; expired and locked codes refused', async () => {
  const a = verifyMocks(reqRow());
  const r = await simulate(wf, { start: 'Calc verify', items: [{ body: { requestId: 'abc', code: '111111' } }], mocks: a.m });
  assert.match(resp(r).message, /2 attempts left/); assert.equal(a.writes[0].body.records[0].fields.Attempts, 1);
  const b = verifyMocks(reqRow({ Expires: new Date(Date.now() - 1000).toISOString() }));
  assert.equal(resp(await simulate(wf, { start: 'Calc verify', items: [{ body: { requestId: 'abc', code: '482913' } }], mocks: b.m })).reason, 'expired');
  const c = verifyMocks(reqRow({ Attempts: 3 }));
  assert.equal(resp(await simulate(wf, { start: 'Calc verify', items: [{ body: { requestId: 'abc', code: '482913' } }], mocks: c.m })).reason, 'locked');
});
