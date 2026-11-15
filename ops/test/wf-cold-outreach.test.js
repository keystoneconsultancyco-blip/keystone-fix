'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build-workflows');
const { simulate } = require('../scripts/simulate');
const Co = require('../lib/coldoutreach');
const AT = require('../config/airtable.json');
const all = build({ write: false }).workflows;
const wf = all['KS Cold Outreach'];
const T = AT.tables;
const MON_AM = new Date('2026-11-16T09:40:00Z'); // Monday 09:40 London
const TUE_PM = new Date('2026-11-17T13:40:00Z');

const SET = { agent_run_token: 'tok', alert_email: 'khan.bilalbk408@gmail.com', sending_domain: 'keystoneconsultancyuk.co.uk', domain_status: 'Verified', email_from: 'Bilal Khan | Keystone <bilal.khan@keystoneconsultancyuk.co.uk>',
  business_address: '1 High Street, Slough SL1 1AA', cold_outreach: 'on', cold_outreach_start: '2026-11-16', cold_summary_week: '2026-11-16' };
const sRecs = (x = {}) => Object.entries({ ...SET, ...x }).map(([k, v]) => ({ id: 'r' + k, fields: { Setting: k, Value: v } }));
const pros = (i, over = {}) => ({ id: 'recPros0000000' + String(i).padStart(3, '0'), fields: { Company: 'Acme ' + i + ' Ltd', Email: `owner@acme${i}.co.uk`, Potential: 'High potential', 'Cold email OK': 'Yes', 'Audit offer': '£100', Industry: 'Plumbing', 'What they do': 'Plumbing and heating', ...over } });
const draft = { subject: 'A quick idea for your invoicing', body: 'Hi Sam,\n\nNoticed you take bookings by phone only...\n\nWould a short audit help?', personal_hook: 'x', risk_flags: [] };

function mocks({ S = {}, toCheck = [], ready = [], approvedSent = 20, sentToday = 0, week = [], extra = {} } = {}) {
  const writes = [];
  const pick = (url) => url.includes(T.settings) ? sRecs(S)
    : /Companies%20House%20checked%20at%7D%20%3D%20BLANK|Companies House checked at\} = BLANK/.test(decodeURIComponent(url)) && !/OR\(IS_AFTER/.test(decodeURIComponent(url)) ? toCheck
    : /Cold email OK\} = 'Yes'/.test(decodeURIComponent(url)) && /Email approval\} = ''/.test(decodeURIComponent(url)) ? ready
    : /Outreach mode\} != 'Automatic'/.test(decodeURIComponent(url)) ? Array.from({ length: approvedSent }, (_, i) => ({ id: 'a' + i, fields: {} }))
    : /IS_SAME\(\{Sent on\}, TODAY/.test(decodeURIComponent(url)) ? Array.from({ length: sentToday }, (_, i) => ({ id: 's' + i, fields: {} }))
    : /OR\(IS_AFTER/.test(decodeURIComponent(url)) ? week : [];
  const m = {
    'Read Airtable': (req) => ({ statusCode: 200, body: { records: pick(req.url) } }),
    'Companies House': (req) => (extra.ch ? extra.ch(req) : { statusCode: 200, body: { items: [] } }),
    'Claude: draft': () => ({ statusCode: 200, body: { content: [{ type: 'text', text: JSON.stringify(extra.draft || draft) }], usage: { input_tokens: 10, output_tokens: 10 }, model: 'claude-haiku-5-5' } }),
    'Email sender settings': () => ({ statusCode: 200, body: { records: sRecs(S) } }),
    'Airtable write': (req) => { writes.push(req); return { statusCode: 200, body: {} }; },
    'Send email': (req) => { writes.push(req); return { statusCode: 200, body: { id: 'em1' } }; },
    'Tell Bilal': () => ({ ok: true }),
    ...extra.mocks,
  };
  return { m, writes };
}
const emails = (x) => x.writes.filter((w) => w.url === 'https://api.resend.com/emails').map((w) => w.body);
const prospectUpdates = (x) => x.writes.filter((w) => w.url && w.url.includes(T.prospects)).flatMap((w) => w.body.records);

test('Companies House: only active limited companies / LLPs may be cold-emailed', () => {
  const rec = pros(1);
  const ok = Co.chResult(rec, { statusCode: 200, body: { items: [{ title: 'ACME 1 LIMITED', company_number: '01234567', company_type: 'ltd', company_status: 'active' }] } }, 'search');
  assert.equal(ok.ok, true); assert.equal(ok.fields['Cold email OK'], 'Yes'); assert.equal(ok.fields['Company number'], '01234567');
  assert.equal(Co.chResult(rec, { statusCode: 200, body: { items: [] } }, 'search').fields['Cold email OK'], 'No', 'no match = sole trader / partnership');
  assert.equal(Co.chResult(rec, { statusCode: 200, body: { items: [{ title: 'Acme 1 Ltd', company_number: '1', company_type: 'ltd', company_status: 'dissolved' }] } }, 'search').fields['Cold email OK'], 'No');
  assert.equal(Co.chResult(rec, { statusCode: 200, body: { company_number: 'OC123456', company_name: 'ACME 1 LLP', type: 'llp', company_status: 'active' } }, 'company').ok, true);
  assert.equal(Co.chResult(pros(2, { Email: 'acme@gmail.com' }), { statusCode: 200, body: {} }, 'search').fields['Cold email OK'], 'No', 'free-mail never');
  const two = Co.chResult(rec, { statusCode: 200, body: { items: [{ title: 'Acme 1 Ltd', company_type: 'ltd', company_status: 'active' }, { title: 'ACME 1 LIMITED', company_type: 'ltd', company_status: 'active' }] } }, 'search');
  assert.equal(two.fields['Cold email OK'], 'No'); assert.match(two.fields['Cold email check'], /Several/);
  assert.equal(Co.chResult(rec, { statusCode: 500 }, 'search').retry, true);
});

test('ramp: 20 approvals first; then 10 -> 20 -> 30 -> 40 a day on weekdays, split over two runs', () => {
  assert.equal(Co.quota({ S: SET, approvedSent: 19, now: MON_AM }).n, 0);
  assert.equal(Co.quota({ S: SET, approvedSent: 20, now: MON_AM }).n, 5);
  assert.equal(Co.quota({ S: SET, approvedSent: 20, sentToday: 5, now: TUE_PM }).n, 5);
  assert.equal(Co.quota({ S: { ...SET, cold_outreach_start: '2026-11-02' }, approvedSent: 20, now: TUE_PM }).limit, 30);
  assert.equal(Co.quota({ S: { ...SET, cold_outreach_start: '2026-10-01' }, approvedSent: 20, now: TUE_PM }).limit, 40);
  assert.equal(Co.quota({ S: SET, approvedSent: 20, now: new Date('2026-11-21T10:00:00Z') }).n, 0, 'Saturday');
  assert.equal(Co.quota({ S: { ...SET, cold_outreach: 'off' }, approvedSent: 50, now: MON_AM }).n, 0);
});

test('automatic run: Companies House checks + 5 emails from The Keystone Team with unsubscribe + address; replies to team@reply', async () => {
  const x = mocks({ toCheck: [pros(90)], ready: Array.from({ length: 8 }, (_, i) => pros(i)), extra: { ch: () => ({ statusCode: 200, body: { items: [{ title: 'Acme 90 Ltd', company_number: '09000000', company_type: 'ltd', company_status: 'active' }] } }) } });
  const r = await simulate(wf, { start: 'Weekdays 09:40 and 13:40', items: [{}], mocks: x.m, now: MON_AM });
  assert.deepEqual(r.errors, []);
  const sent = emails(x);
  assert.equal(sent.length, 5);
  const e = sent[0];
  assert.equal(e.from, 'The Keystone Team <team@keystoneconsultancyuk.co.uk>'); assert.equal(e.reply_to, 'team@reply.keystoneconsultancyuk.co.uk');
  assert.match(e.text, /1 High Street, Slough SL1 1AA/); assert.match(e.text, /ks-unsubscribe\?p=recPros0000000000&t=/); assert.match(e.html, /Unsubscribe<\/a>/);
  assert.match(e.headers['List-Unsubscribe'], /^<https:\/\/.+ks-unsubscribe/); assert.deepEqual(e.tags[0], { name: 'prospect', value: 'recPros0000000000' });
  assert.ok(!/gmail/.test(JSON.stringify(e)));
  const ups = prospectUpdates(x);
  assert.ok(ups.some((u) => u.fields['Cold email OK'] === 'Yes' && u.fields['Company number'] === '09000000'));
  const s = ups.find((u) => u.fields['Outreach mode'] === 'Automatic');
  assert.equal(s.fields['Email approval'], 'Sent'); assert.ok(s.fields['Unsubscribe token']);
});

test('no business address -> nothing sent, Bilal told once; approval stage -> no automatic sends', async () => {
  const x = mocks({ S: { business_address: '' }, ready: [pros(1)] });
  const r = await simulate(wf, { start: 'Weekdays 09:40 and 13:40', items: [{}], mocks: x.m, now: MON_AM });
  assert.equal(emails(x).length, 0); assert.ok(r.calls.some((c) => c.node === 'Tell Bilal' && /business_address is empty/.test(c.req.text)));
  const y = mocks({ approvedSent: 12, ready: [pros(1)] });
  await simulate(wf, { start: 'Weekdays 09:40 and 13:40', items: [{}], mocks: y.m, now: MON_AM });
  assert.equal(emails(y).length, 0);
});

test('a draft that mentions a price is never sent', async () => {
  const x = mocks({ ready: [pros(1)], extra: { draft: { ...draft, body: 'Setup from £1,750.' } } });
  await simulate(wf, { start: 'Weekdays 09:40 and 13:40', items: [{}], mocks: x.m, now: MON_AM });
  assert.equal(emails(x).length, 0); assert.equal(prospectUpdates(x)[0].fields['Email approval'], 'Edit requested');
});

test('Monday: weekly summary to Bilal', async () => {
  const week = [{ id: 'w1', fields: { Company: 'Acme', 'Sent on': '2026-11-12', 'Outreach mode': 'Automatic', 'Reply received at': '2026-11-13T10:00:00Z', 'Reply type': 'Interested', 'Last reply': 'Yes please, call me' } }];
  const x = mocks({ S: { cold_summary_week: '2026-11-09' }, week, approvedSent: 20 });
  await simulate(wf, { start: 'Weekdays 09:40 and 13:40', items: [{}], mocks: x.m, now: MON_AM });
  const s = emails(x).find((e) => /weekly summary/.test(e.subject));
  assert.ok(s); assert.deepEqual(s.to, ['khan.bilalbk408@gmail.com']); assert.match(s.text, /interested 1/); assert.match(s.text, /Acme: Yes please/);
});

function replyMocks(cls, prospect = pros(1, { 'Email subject': 'A quick idea', 'Email draft': 'Hi...' })) {
  const x = mocks();
  x.m['Resend: read email'] = (req) => (req.url.includes('/receiving/') ? { statusCode: 200, body: { from: 'Sam <owner@acme1.co.uk>', to: ['team@reply.keystoneconsultancyuk.co.uk'], subject: 'Re: A quick idea', text: 'Sounds interesting, what does it involve?\n\nOn Mon, The Keystone Team wrote:\n> Hi Sam' } } : { statusCode: 200, body: { last_event: 'bounced', to: ['owner@acme1.co.uk'] } });
  x.m['Resend: read Airtable'] = (req) => ({ statusCode: 200, body: { records: req.url.includes(T.settings) ? sRecs() : prospect ? [prospect] : [] } });
  x.m['Claude: reply'] = () => ({ statusCode: 200, body: { content: [{ type: 'text', text: JSON.stringify(cls) }], usage: {}, model: 'claude-haiku-5-5' } });
  return x;
}
test('replies: interested -> draft for YES/NO; not interested -> never emailed again; auto-reply ignored', async () => {
  const a = replyMocks({ type: 'Question', summary: 'Asks what the audit involves', draft_subject: 'Re: A quick idea', draft_body: 'Hi Sam, happy to explain...\nBilal Khan, Keystone' });
  const r = await simulate(wf, { start: 'Resend event', items: [{ body: { type: 'email.received', data: { email_id: 'abcd-1234-efgh' } } }], mocks: a.m });
  assert.deepEqual(r.errors, []);
  const u = prospectUpdates(a)[0].fields;
  assert.equal(u['Reply type'], 'Question'); assert.equal(u.Status, 'Replied'); assert.match(u['Last reply'], /^Sounds interesting/); assert.ok(!/wrote:/.test(u['Last reply']));
  const n = r.calls.find((c) => c.node === 'Tell Bilal').req;
  assert.equal(n.approval.type, 'cold_reply'); assert.equal(n.approval.action.webhook, 'https://keystoneconsultancy.app.n8n.cloud/webhook/ks-agent-cold-reply');
  const b = replyMocks({ type: 'Not interested', summary: 'no', draft_subject: '', draft_body: '' });
  await simulate(wf, { start: 'Resend event', items: [{ body: { type: 'email.received', data: { email_id: 'abcd-1234-efgh' } } }], mocks: b.m });
  assert.equal(prospectUpdates(b)[0].fields['Do not email'], true);
  const c = replyMocks({ type: 'Auto-reply', summary: 'OOO', draft_subject: '', draft_body: '' });
  await simulate(wf, { start: 'Resend event', items: [{ body: { type: 'email.received', data: { email_id: 'abcd-1234-efgh' } } }], mocks: c.m });
  assert.equal(prospectUpdates(c).length, 0);
});

test('bounce -> Do not email (matched by the prospect tag)', async () => {
  const x = replyMocks({});
  const r = await simulate(wf, { start: 'Resend event', items: [{ body: { type: 'email.bounced', data: { email_id: 'abcd-1234-efgh', tags: { prospect: 'recPros0000000001' }, to: ['owner@acme1.co.uk'] } } }], mocks: x.m });
  assert.deepEqual(r.errors, []);
  const u = prospectUpdates(x)[0].fields; assert.equal(u['Do not email'], true); assert.equal(u['Reply type'], 'Bounced');
});

test('YES on a reply draft -> sent from bilal.khan@ (token checked)', async () => {
  const p = pros(1, { 'Reply draft': 'Hi Sam, happy to explain.', 'Reply subject': 'Re: A quick idea', 'Last reply': 'What does it involve?' });
  const x = mocks();
  x.m['Reply: read Airtable'] = (req) => ({ statusCode: 200, body: { records: req.url.includes(T.settings) ? sRecs() : [p] } });
  await simulate(wf, { start: 'Send approved reply', items: [{ body: { prospectId: p.id, token: 'tok', approvedByBilal: true } }], mocks: x.m });
  const [e] = emails(x);
  assert.equal(e.from, 'Bilal Khan | Keystone <bilal.khan@keystoneconsultancyuk.co.uk>'); assert.match(e.text, /> What does it involve\?/);
  const y = mocks(); y.m['Reply: read Airtable'] = x.m['Reply: read Airtable'];
  await simulate(wf, { start: 'Send approved reply', items: [{ body: { prospectId: p.id, token: 'wrong' } }], mocks: y.m });
  assert.equal(emails(y).length, 0);
});

test('Outreach agent: Companies House gate in the draft list, footer + team sender on approved sends, stops at 20', () => {
  const o = all['KS Agent - Outreach'];
  const reads = o.nodes.find((n) => n.name === 'Plan reads').parameters.jsCode;
  assert.match(reads, /\{Cold email OK\} = 'Yes'/); assert.match(reads, /NOT\(\{Do not email\}\)/);
  const plan = o.nodes.find((n) => n.name === 'Plan').parameters.jsCode;
  assert.match(plan, /APPROVED_FIRST\) return \[\]/);
  const h = o.nodes.find((n) => n.name === 'Handle job').parameters.jsCode;
  assert.match(h, /sender: 'team'/); assert.match(h, /buildEmail/); assert.match(h, /business_address/);
});
