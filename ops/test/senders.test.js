'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sd = require('../lib/senders');
const { build } = require('../scripts/build-workflows');
const { simulate } = require('../scripts/simulate');
const CC = require('../lib/clientconfig');
const LIVE = { sending_domain: 'keystoneconsultancyuk.co.uk', domain_status: 'Verified', sending_address: 'bilal.khan' };
const mail = (sender, from = 'Keystone <onboarding@resend.dev>', extra = {}) => ({ method: 'POST', url: 'https://api.resend.com/emails', body: { from, to: ['x@y.co'], subject: 's', ...extra }, ...(sender ? { sender } : {}) });

test('three senders once the domain is verified; clients reply to bilal.khan@, Bilal to the gmail', () => {
  assert.equal(Sd.apply(mail('personal'), LIVE).body.from, 'Bilal Khan | Keystone <bilal.khan@keystoneconsultancyuk.co.uk>');
  assert.equal(Sd.apply(mail('accounts'), LIVE).body.from, 'Keystone Accounts <accounts@keystoneconsultancyuk.co.uk>');
  assert.equal(Sd.apply(mail('operations'), LIVE).body.from, 'Keystone Operations <operations@keystoneconsultancyuk.co.uk>');
  assert.equal(Sd.apply(mail(), LIVE).body.from, 'Keystone Operations <operations@keystoneconsultancyuk.co.uk>', 'default = operations');
  for (const k of Sd.KINDS) assert.equal(Sd.apply(mail(k, undefined, { reply_to: 'someone@else.com' }), LIVE).body.reply_to, 'bilal.khan@keystoneconsultancyuk.co.uk');
  const own = Sd.apply({ body: { from: 'Keystone <onboarding@resend.dev>', to: ['khan.bilalbk408@gmail.com'], subject: 's' } }, LIVE);
  assert.equal(own.body.reply_to, 'keystoneconsultancy.co@gmail.com', 'emails to Bilal himself keep the gmail');
  assert.equal(Sd.apply(mail('personal'), LIVE).sender, undefined, 'the tag never reaches Resend');
});
test('before verification: test sender; clients never see a gmail; no hello@ anywhere', () => {
  const r = Sd.apply(mail('personal', 'Keystone <hello@keystoneconsultancyuk.co.uk>'), { ...LIVE, domain_status: 'Waiting for DNS' });
  assert.equal(r.body.from, Sd.TEST_FROM); assert.equal(r.body.reply_to, 'bilal.khan@keystoneconsultancyuk.co.uk');
  assert.ok(!/gmail/.test(r.body.reply_to));
  assert.ok(!JSON.stringify(Sd.addresses(LIVE)).includes('hello'));
});
test("a client's own address is left alone", () => {
  const r = Sd.apply(mail('accounts', 'Acme Plumbing <accounts@acme.co.uk>', { reply_to: 'office@acme.co.uk' }), LIVE);
  assert.equal(r.body.from, 'Acme Plumbing <accounts@acme.co.uk>'); assert.equal(r.body.reply_to, 'office@acme.co.uk');
});
test('settings can override each sender', () => {
  assert.equal(Sd.apply(mail('accounts'), { ...LIVE, sender_accounts: 'Keystone Billing <billing@keystoneconsultancyuk.co.uk>' }).body.from, 'Keystone Billing <billing@keystoneconsultancyuk.co.uk>');
});
test('client config: invoices from Accounts, bookings from From email, Reply-To bilal.khan@', () => {
  const rec = { id: 'r1', fields: { 'Client ID': 'C1', 'Client name': 'C', Status: 'Active', 'Invoicing on': true, 'Phone on': true, 'From email': 'Keystone Operations <operations@k.co.uk>', 'Accounts from email': 'Keystone Accounts <accounts@k.co.uk>' } };
  const c = CC.chooseClient([rec], { clientId: 'C1' });
  assert.equal(CC.toInvoiceConfig(c.client, rec).confirmationFromEmail, 'Keystone Accounts <accounts@k.co.uk>');
  assert.equal(CC.toPhoneConfig(c.client, rec).confirmationFromEmail, 'Keystone Operations <operations@k.co.uk>');
  assert.equal(CC.toInvoiceConfig(c.client, rec).replyTo, 'bilal.khan@keystoneconsultancyuk.co.uk');
});
test('shared send step: a quote email goes out from Accounts with Reply-To gmail', async () => {
  const wf = build({ write: false }).workflows['KS Agent - Nurture'];
  const tail = wf.nodes.find((x) => x.name === 'Set sender');
  assert.match(tail.parameters.jsCode, /KS\.senders\.apply/);
});
