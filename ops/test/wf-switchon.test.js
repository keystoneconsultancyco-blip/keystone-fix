'use strict';
// KS Switch-On: the paths that can't run live until Bilal finishes his steps (verified domain, real Twilio number).
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build-workflows');
const { simulate } = require('../scripts/simulate');
const wf = build({ write: false }).workflows['KS Switch-On'];

const SID = 'AC' + 'a'.repeat(32);
function setup(settings, extra = {}) {
  const writes = [], calls = [];
  const S = Object.entries({ agent_run_token: 'tok', sending_address: 'hello', ...settings }).map(([k, v]) => ({ id: 'r' + k, fields: { Setting: k, Value: v } }));
  const m = {
    'Read Airtable': (req) => {
      if (req.url.includes('tblpgFrCOqt5H5yFn')) return { body: { records: S } };
      if (req.url.includes('tbl1p0MQLs1MA0DnY')) return { body: { records: [{ id: 'recHeld1', fields: { 'Business name': 'X' } }] } };
      if (req.url.includes(encodeURIComponent("'KS-DEMO-01'"))) return { body: { records: [{ id: 'recDemo', fields: { 'Client ID': 'KS-DEMO-01', 'Business phone number': '+447700900123' } }] } };
      return { body: { records: [{ id: 'recC1', fields: { 'Client ID': 'KS-DEMO-01' } }, { id: 'recC2', fields: { 'Client ID': 'KS-DEMO-02' } }] } };
    },
    'Airtable write': (req) => { writes.push(req); return { body: {} }; },
    'Call webhook': (req) => { calls.push(req); return { body: {} }; },
    'Send email': () => ({ body: { id: 'e' } }),
    ...extra,
  };
  return { m, writes, calls };
}

test('domain verified -> sender switched, clients moved, held outreach and proposals released, Bilal told', async () => {
  const x = setup({ sending_domain: 'keystoneops.co.uk', domain_registered_name: 'keystoneops.co.uk', domain_resend_id: 'd1', domain_status: 'Waiting for DNS' },
    { 'Resend: domain status': () => ({ body: { id: 'd1', status: 'verified' } }) });
  const r = await simulate(wf, { start: '4 times a day', items: [{}], mocks: x.m });
  assert.deepEqual(r.errors, []);
  const settings = x.writes.filter((w) => w.url.includes('tblpgFrCOqt5H5yFn')).flatMap((w) => w.body.records.map((rec) => rec.fields));
  assert.deepEqual(settings.find((f) => f.Setting === 'email_from'), { Setting: 'email_from', Value: 'Keystone <hello@keystoneops.co.uk>' });
  assert.ok(settings.some((f) => f.Setting === 'domain_status' && f.Value === 'Verified'));
  const clientUpdates = x.writes.filter((w) => w.url.includes('tbl3vmAkTQlzaU9ac')).flatMap((w) => w.body.records);
  assert.equal(clientUpdates.length, 2);
  assert.ok(x.calls.some((c) => c.url.endsWith('/ks-agent-outreach') && c.body.release === true && c.body.token === 'tok'));
  assert.ok(x.calls.some((c) => c.url.endsWith('/ks-agent-sales-prep') && c.body.intakeId === 'recHeld1'));
  assert.ok(r.calls.some((c) => c.node === 'Tell Bilal' && /is verified/.test(c.req.text)));
  assert.ok(!r.ran.includes('Resend: verify'));
});

test('domain still pending -> asks Resend to verify, no sender change', async () => {
  const x = setup({ sending_domain: 'keystoneops.co.uk', domain_registered_name: 'keystoneops.co.uk', domain_resend_id: 'd1', domain_status: 'Waiting for DNS' },
    { 'Resend: domain status': () => ({ body: { id: 'd1', status: 'pending' } }), 'Resend: verify': () => ({ body: { id: 'd1' } }) });
  const r = await simulate(wf, { start: '4 times a day', items: [{}], mocks: x.m });
  assert.deepEqual(r.errors, []);
  assert.ok(r.ran.includes('Resend: verify'));
  assert.equal(x.writes.filter((w) => JSON.stringify(w.body).includes('email_from')).length, 0);
});

test('twilio number filled + SID -> calls to IVR, texts to Ops Manager, demo client gets the number', async () => {
  let posted = null;
  const x = setup({ twilio_from: '+441234567890', twilio_account_sid: SID },
    { 'Twilio: find number': (req) => { assert.ok(req.url.includes(SID) && req.url.includes(encodeURIComponent('+441234567890'))); return { body: { incoming_phone_numbers: [{ sid: 'PN1' }] } }; },
      'Twilio: set webhooks': (req) => { posted = req; return { body: { sid: 'PN1' } }; } });
  const r = await simulate(wf, { start: '4 times a day', items: [{}], mocks: x.m });
  assert.deepEqual(r.errors, []);
  assert.ok(posted.url.endsWith('/IncomingPhoneNumbers/PN1.json'));
  const node = wf.nodes.find((nd) => nd.name === 'Twilio: set webhooks');
  assert.equal(node.parameters.rawContentType, 'application/x-www-form-urlencoded');
  const form = r.state.outputs['Point number at Keystone'][0].json.req.form;
  assert.match(form, /VoiceUrl=.*twilio%2Finbound-call/); assert.match(form, /SmsUrl=.*ks-ops-sms/);
  const settings = x.writes.filter((w) => w.url.includes('tblpgFrCOqt5H5yFn')).flatMap((w) => w.body.records.map((rec) => rec.fields));
  assert.ok(settings.some((f) => f.Setting === 'twilio_connected' && f.Value === '+441234567890'));
  assert.ok(x.writes.some((w) => w.url.includes('tbl3vmAkTQlzaU9ac') && w.body.records[0].fields['Business phone number'] === '+441234567890'));
});

test('twilio number without SID -> asks Bilal once for the Account SID', async () => {
  const x = setup({ twilio_from: '+441234567890' });
  const r = await simulate(wf, { start: '4 times a day', items: [{}], mocks: x.m });
  assert.deepEqual(r.errors, []);
  assert.ok(r.calls.some((c) => c.node === 'Tell Bilal' && /Account SID/.test(c.req.text)));
  const again = setup({ twilio_from: '+441234567890', twilio_connected: 'needs account SID' });
  const r2 = await simulate(wf, { start: '4 times a day', items: [{}], mocks: again.m });
  assert.ok(!r2.calls.some((c) => c.node === 'Tell Bilal'));
});

test('run-now without the token is refused', async () => {
  const x = setup({ sending_domain: 'keystoneops.co.uk' });
  const r = await simulate(wf, { start: 'Check now', items: [{ headers: {}, body: { token: 'wrong' } }], mocks: x.m });
  assert.deepEqual(r.errors, []);
  assert.ok(!r.ran.includes('Resend: add domain'));
});
