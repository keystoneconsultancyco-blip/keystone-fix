'use strict';
// Who every Keystone email comes from (applied in the shared "Set sender" step that all KS workflows send through).
//  personal   "Bilal Khan | Keystone <bilal.khan@domain>"     outreach, proposals, audits, nurture, client success
//  accounts   "Keystone Accounts <accounts@domain>"            invoices, quotes, payment reminders
//  operations "Keystone Operations <operations@domain>"        bookings, reports, alerts and other automatic emails (default)
// Reply-To on every email: keystoneconsultancy.co@gmail.com (Keystone Settings > reply_to).
// Until Resend has verified the domain (domain_status = Verified) everything goes from Resend's test sender, which only
// delivers to Bilal's own inbox. A client's own custom From address (set on their My Clients row) is left alone.
// Keystone Settings can override each one: sender_personal, sender_accounts, sender_operations, reply_to.
const TEST_FROM = 'Keystone <onboarding@resend.dev>';
const REPLY_TO = 'keystoneconsultancy.co@gmail.com';
const KINDS = ['personal', 'accounts', 'operations'];

function addresses(S = {}) {
  const domain = String(S.sending_domain || '').trim().toLowerCase();
  const verified = !!domain && S.domain_status === 'Verified';
  const local = String(S.sending_address || 'bilal.khan').trim() || 'bilal.khan';
  return {
    domain, verified,
    personal: S.sender_personal || `Bilal Khan | Keystone <${local}@${domain}>`,
    accounts: S.sender_accounts || `Keystone Accounts <accounts@${domain}>`,
    operations: S.sender_operations || `Keystone Operations <operations@${domain}>`,
    replyTo: S.reply_to || REPLY_TO,
  };
}

const addrOf = (from) => ((String(from || '').match(/<([^>]+)>/) || [])[1] || String(from || '')).trim().toLowerCase();

// Keystone's own sender (test sender, blank, or anything on our domain) vs a client's own address.
function isKeystoneSender(from, S = {}) {
  const a = addrOf(from);
  const domain = String(S.sending_domain || '').trim().toLowerCase();
  return !a || /@resend\.dev$/.test(a) || (!!domain && a.endsWith('@' + domain));
}

// Takes a Resend request ({ body, sender? }) and returns a copy with the right From and Reply-To.
function apply(req, S = {}) {
  const out = JSON.parse(JSON.stringify(req || {}));
  const body = out.body || (out.body = {});
  const kind = KINDS.includes(out.sender) ? out.sender : 'operations';
  delete out.sender;
  const A = addresses(S);
  if (isKeystoneSender(body.from, S)) {
    body.from = A.verified ? A[kind] : TEST_FROM;
    body.reply_to = A.replyTo;
  } else if (!body.reply_to) {
    body.reply_to = A.replyTo;
  }
  return out;
}

module.exports = { TEST_FROM, REPLY_TO, KINDS, addresses, isKeystoneSender, apply };
