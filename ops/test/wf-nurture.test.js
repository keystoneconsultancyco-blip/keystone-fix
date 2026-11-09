'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build-workflows');
const { simulate } = require('../scripts/simulate');
const N = require('../lib/nurture');
const AT = require('../config/airtable.json');
const TPL = require('../config/nurture-templates.json');
const all = build({ write: false }).workflows;
const wf = all['KS Agent - Nurture'];
const tr = all['KS Nurture Tracking'];
const ME = 'khan.bilalbk408@gmail.com';
const DAY = 864e5;
const T = AT.tables;

const tplRecs = (approved) => TPL.map((t, i) => ({ id: 'recTpl' + String(i).padStart(8, '0'), fields: { ...t, Approved: approved, Sent: 2, Bookings: 0 } }));
function settings(extra = {}) {
  return Object.entries({ agent_run_token: 'tok', email_from: 'Keystone <hello@keystone.co.uk>', domain_status: 'Verified', alert_email: ME, audit_slots_per_month: '5', nurture_social_proof: '', ...extra })
    .map(([k, v]) => ({ id: 'r' + k, fields: { Setting: k, Value: v } }));
}
const lead = (over = {}) => ({ id: 'recLead0000000001', createdTime: new Date(Date.now() - 1 * DAY).toISOString(), fields: { Source: 'Website', Company: 'Acme Plumbing Ltd', 'Contact name': 'Sam Jones', Email: 'sam@acme-plumbing.co.uk',
  'Revenue band': '£1M–£3M', 'Audit offer': '£100', 'Marketing consent': true, 'Unsubscribe token': 'u'.repeat(32), Status: 'New - review', 'Signed up at': new Date(Date.now() - 1 * DAY).toISOString(), ...over } });

function run({ leads = [lead()], approved = true, S = settings(), audits = 2, input } = {}) {
  const writes = [];
  const m = {
    'Read Airtable': (req) => {
      const u = req.url;
      if (u.includes(T.settings)) return { statusCode: 200, body: { records: S } };
      if (u.includes(T.agents)) return { statusCode: 200, body: { records: [{ id: 'recAg', fields: { Slug: 'nurture', Status: 'Live' } }] } };
      if (u.includes(T.prospects)) return { statusCode: 200, body: { records: leads } };
      if (u.includes(T.nurtureTemplates)) return { statusCode: 200, body: { records: tplRecs(approved) } };
      if (u.includes(T.auditIntakes)) return { statusCode: 200, body: { records: Array.from({ length: audits }, (_, i) => ({ id: 'a' + i, fields: {} })) } };
      return { statusCode: 200, body: { records: [] } };
    },
    'Airtable write': (req) => { writes.push(req); return { statusCode: 200, body: {} }; },
    'Send email': (req) => { writes.push(req); return { statusCode: 200, body: { id: 'e' } }; },
    'Call webhook': (req) => { writes.push(req); return { body: {} }; },
    'Email sender settings': () => ({ statusCode: 200, body: { records: S } }),
  };
  const start = input ? 'Run now' : 'Daily 10:20';
  const items = input ? [{ headers: {}, body: { token: 'tok', ...input } }] : [{}];
  return simulate(wf, { start, items, mocks: m }).then((r) => ({ r, writes, emails: writes.filter((w) => w.url === 'https://api.resend.com/emails'), at: (tbl) => writes.filter((w) => w.url && w.url.includes(tbl)) }));
}

test('nurture rules: sequence timing, monthly rotation, 12-month finish', () => {
  const seq = [1, 2, 3, 4].map((s) => ({ Kind: 'Sequence', Step: s, 'Send on day': [0, 5, 12, 21][s - 1] }));
  const mon = [5, 6, 7].map((s) => ({ Kind: 'Monthly', Step: s }));
  const now = Date.now();
  assert.equal(N.nextTemplate(seq.concat(mon), { step: 0, signedUp: now }, now).step, 1);
  assert.equal(N.nextTemplate(seq, { step: 1, signedUp: now - 4 * DAY, lastSent: now - 4 * DAY }, now), null); // day 5 not reached
  assert.equal(N.nextTemplate(seq, { step: 1, signedUp: now - 5 * DAY, lastSent: now - 5 * DAY }, now).step, 2);
  assert.equal(N.nextTemplate(seq.concat(mon), { step: 4, signedUp: now - 40 * DAY, lastSent: now - 10 * DAY }, now), null); // under a month
  assert.equal(N.nextTemplate(seq.concat(mon), { step: 4, signedUp: now - 60 * DAY, lastSent: now - 31 * DAY }, now).template.Step, 5);
  assert.equal(N.nextTemplate(seq.concat(mon), { step: 7, signedUp: now - 150 * DAY, lastSent: now - 31 * DAY }, now).template.Step, 5); // rotates
  assert.deepEqual(N.nextTemplate(seq.concat(mon), { step: 9, signedUp: now - 366 * DAY, lastSent: now - 31 * DAY }, now), { finished: true });
});

test('nurture rules: stops, slots only when set, proof hidden until real', () => {
  assert.equal(N.stopReason({ 'Marketing consent': false }), 'Stopped - unsubscribed');
  assert.equal(N.stopReason({ 'Marketing consent': true, Status: 'Discovery call booked' }), 'Stopped - booked');
  assert.equal(N.stopReason({ 'Marketing consent': true, Status: 'Replied' }), 'Stopped - replied');
  assert.equal(N.stopReason({ 'Marketing consent': true, Status: 'Won' }), 'Stopped - client');
  assert.equal(N.stopReason({ 'Marketing consent': true, 'Make my client': true }), 'Stopped - client');
  assert.equal(N.stopReason({ 'Marketing consent': true, Status: 'Contacted' }), null);
  assert.equal(N.slotsLine('', 0), ''); assert.equal(N.slotsLine('0', 0), '');
  assert.match(N.slotsLine('5', 2, '2026-11-09'), /3 are left for November/);
  assert.match(N.slotsLine('5', 5, '2026-11-09'), /November is full.*December/);
  assert.deepEqual(N.proofBlock(''), { text: '', html: '' });
  assert.match(N.proofBlock('Saved us 6 hours a week', 'Jo, Acme').html, /Saved us 6 hours/);
});

test('every template: placeholders known, no invented proof, one CTA, unsubscribe', () => {
  const vars = { first_name: 'Sam', company: 'Acme', revenue_band: '£1M–£3M', loss_line: N.lossLine('1m-3m'), audit_line: N.auditLine('£100'), slots_line: '' };
  for (const t of TPL) {
    assert.equal(t.Approved, false, t.Name + ' must start unapproved');
    const p = N.emailParts({ subject: t.Subject, body: t.Body, vars, ctaUrl: 'https://x/c', pixelUrl: 'https://x/p', unsubUrl: 'https://x/u', proof: { text: '', html: '' } });
    assert.ok(!/\{[a-z_]+\}/.test(p.text + p.subject), t.Name + ' has an unknown placeholder');
    assert.equal((p.html.match(/Book my audit/g) || []).length, 1, t.Name + ' needs exactly one CTA');
    assert.match(p.html, /Unsubscribe/); assert.match(p.text, /Unsubscribe: https:\/\/x\/u/);
    assert.ok(!/testimonial|case study/i.test(p.text), t.Name + ' must not invent proof');
  }
});

test('daily run: due lead gets email 1 with tracking, Sends row, lead + template totals updated', async () => {
  const x = await run();
  assert.deepEqual(x.r.errors, []);
  assert.equal(x.emails.length, 1);
  const mail = x.emails[0].body;
  assert.deepEqual(mail.to, ['sam@acme-plumbing.co.uk']);
  assert.match(mail.html, /ks-nurture-click\?s=[a-z0-9]{24}&amp;t=recTpl/); assert.match(mail.html, /ks-nurture-open\?s=/); assert.match(mail.html, /ks-unsubscribe\?p=recLead/);
  assert.match(mail.text, /Sam/); assert.match(mail.text, /3 are left for/);
  const send = x.at(T.nurtureSends)[0].body.records[0].fields;
  assert.equal(send.Step, 1); assert.equal(send.Test, false); assert.match(send['Template ID'], /^recTpl/);
  const upd = x.at(T.prospects)[0].body.records[0].fields;
  assert.equal(upd['Nurture step'], 1); assert.equal(upd['Nurture status'], 'Active'); assert.equal(upd['Nurture last send'], send['Send ID']);
  const tot = x.at(T.nurtureTemplates)[0].body.records[0];
  assert.equal(tot.fields.Sent, 3);
});

test('nothing sends without approval, consent or a verified domain', async () => {
  assert.equal((await run({ approved: false })).emails.length, 0);
  assert.equal((await run({ S: settings({ domain_status: '' }) })).emails.length, 0);
  const u = await run({ leads: [lead({ 'Marketing consent': false })] });
  assert.equal(u.emails.length, 0);
  assert.equal(u.at(T.prospects)[0].body.records[0].fields['Nurture status'], 'Stopped - unsubscribed');
});

test('slots line disappears when the cap is not set', async () => {
  const x = await run({ S: settings({ audit_slots_per_month: '' }) });
  assert.ok(!/audits a month/.test(x.emails[0].body.text));
});

test('booking stops emails and credits the last email', async () => {
  const x = await run({ leads: [lead({ Status: 'Discovery call booked', 'Nurture status': 'Active', 'Nurture step': 2, 'Nurture last send': 'abcdefghijkmnpqrstuvwxyz', 'Nurture last template': 'recTpl00000001' })] });
  assert.deepEqual(x.r.errors, []);
  assert.equal(x.emails.length, 0);
  assert.equal(x.at(T.prospects)[0].body.records[0].fields['Nurture status'], 'Stopped - booked');
  const up = x.at(T.nurtureSends)[0];
  assert.deepEqual(up.body.performUpsert, { fieldsToMergeOn: ['Send ID'] }); assert.equal(up.body.records[0].fields.Booked, true);
  assert.equal(x.at(T.nurtureTemplates)[0].body.records[0].fields.Bookings, 1);
});

test('after 12 months the lead is finished, not emailed', async () => {
  const old = new Date(Date.now() - 370 * DAY).toISOString();
  const x = await run({ leads: [lead({ 'Signed up at': old, 'Nurture step': 14, 'Nurture last sent': new Date(Date.now() - 40 * DAY).toISOString() })] });
  assert.equal(x.emails.length, 0);
  assert.equal(x.at(T.prospects)[0].body.records[0].fields['Nurture status'], 'Finished (12 months)');
});

test('preview sends all 10 templates to Bilal only, marked Test, lead untouched', async () => {
  const x = await run({ approved: false, S: settings({ domain_status: '' }), input: { preview: true, prospectId: 'recLead0000000001' } });
  assert.deepEqual(x.r.errors, []);
  assert.equal(x.emails.length, TPL.length);
  assert.ok(x.emails.every((e) => e.body.to.length === 1 && e.body.to[0] === ME && /^\[PREVIEW /.test(e.body.subject)));
  assert.equal(x.at(T.prospects).length, 0);
  assert.equal(x.at(T.nurtureTemplates).length, 0);
  assert.ok(x.at(T.nurtureSends).every((w) => w.body.records[0].fields.Test === true));
});

// ---- tracking ----
function track(start, q, { send, S = settings() } = {}) {
  const writes = [];
  const m = {
    [start + ': read Airtable']: (req) => {
      if (req.url.includes(T.nurtureSends)) return { statusCode: 200, body: { records: send ? [send] : [] } };
      if (req.url.includes(T.nurtureTemplates)) return { statusCode: 200, body: { records: [{ id: 'recTplA0000000001', fields: { Name: 'S1', Opened: 4, Clicked: 1 } }] } };
      return { statusCode: 200, body: { records: S } };
    },
    'Airtable write': (req) => { writes.push(req); return { body: {} }; },
  };
  return simulate(tr, { start, items: [{ query: q }], mocks: m }).then((r) => ({ r, writes }));
}
const sendRow = (over = {}) => ({ id: 'recSend', fields: { 'Send ID': 'abcdefghijkmnpqrstuvwxyz', 'Template ID': 'recTplA0000000001', Company: 'Acme', Opens: 0, Clicks: 0, Test: false, ...over } });
const Q = { s: 'abcdefghijkmnpqrstuvwxyz', t: 'recTplA0000000001' };

test('open: pixel returned, first open counted on the send and the template', async () => {
  const x = await track('Open', Q, { send: sendRow() });
  assert.deepEqual(x.r.errors, []);
  assert.equal(x.r.responses[0].body.data.mimeType, 'image/gif');
  assert.equal(x.writes[0].body.records[0].fields.Opens, 1); assert.ok(x.writes[0].body.records[0].fields['First opened']);
  assert.equal(x.writes[1].body.records[0].fields.Opened, 5);
  const again = await track('Open', Q, { send: sendRow({ Opens: 1, 'First opened': '2026-11-09T10:00:00Z' }) });
  assert.equal(again.writes.length, 1); assert.equal(again.writes[0].body.records[0].fields.Opens, 2);
});

test('open: bad or mismatched links count nothing but still return the pixel', async () => {
  const x = await track('Open', { s: 'x', t: 'y' }, { send: null });
  assert.equal(x.writes.length, 0); assert.equal(x.r.responses[0].body.data.mimeType, 'image/gif');
  const y = await track('Open', { ...Q, t: 'recTplA0000000002' }, { send: sendRow() });
  assert.equal(y.writes.length, 0);
});

test('click: counted, then redirect to booking page (or an email to Bilal until it is set)', async () => {
  const x = await track('Click', Q, { send: sendRow() });
  assert.deepEqual(x.r.errors, []);
  assert.match(x.r.responses[0].body, /url=mailto:khan\.bilalbk408@gmail\.com\?subject=Book%20my%20Finance%20Ops%20Audit%20-%20Acme/);
  assert.equal(x.writes[0].body.records[0].fields.Clicks, 1); assert.equal(x.writes[1].body.records[0].fields.Clicked, 2);
  const y = await track('Click', Q, { send: sendRow({ Test: true }), S: settings({ audit_booking_url: 'https://cal.example.com/keystone' }) });
  assert.match(y.r.responses[0].body, /url=https:\/\/cal\.example\.com\/keystone"/);
  assert.equal(y.writes.length, 1); // test sends never touch template totals
});
