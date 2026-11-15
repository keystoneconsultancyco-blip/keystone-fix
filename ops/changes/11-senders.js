'use strict';
// Change 11 (apply at GREEN LIGHT): email senders and Reply-To in the [Stock] workflows.
//  - every Resend email node gets reply_to = the client's Reply-to (default keystoneconsultancy.co@gmail.com);
//  - the Client Config sub-workflows are rebuilt from lib/clientconfig.js, so invoices/reminders use the client's
//    "Accounts from email" and bookings use "From email" (both set to Keystone Accounts / Operations when the domain
//    is verified, unless the client has their own address).
// Usage: node changes/run.js <workflowId> 11-senders.js senders
const n = require('../scripts/n8n');
const { H } = require('../scripts/stock');
const L = ['clientconfig', 'registry', 'requests', 'log'];
const REPLY = "'keystoneconsultancy.co@gmail.com'";

function addReplyTo(w) {
  let changed = 0;
  for (const node of w.nodes) {
    const p = node.parameters || {};
    if (!/api\.resend\.com\/emails/.test(String(p.url || '')) || typeof p.jsonBody !== 'string' || /reply_to/.test(p.jsonBody)) continue;
    // "from: <expr>," -> "from: <expr>, reply_to: <same object>.replyTo || default,"
    const m = p.jsonBody.match(/from: ((?:\$\('[^']+'\)\.item\.json|\$json)\.(?:confirmationFromEmail|reportsFromEmail)(?: \|\| '[^']*')?),/);
    if (!m) continue;
    const obj = m[1].replace(/\.(confirmationFromEmail|reportsFromEmail).*$/, '');
    p.jsonBody = p.jsonBody.replace(m[0], `from: ${m[1]}, reply_to: ${obj}.replyTo || ${REPLY},`);
    changed++;
  }
  return changed;
}

function rebuildConfig(w) {
  if (!H.has(w, 'Client Config') || !H.has(w, 'Find client in registry')) return false;
  const old = H.node(w, 'Client Config');
  const mapFn = /toPhoneConfig/.test(old.parameters.jsCode) ? 'toPhoneConfig' : 'toInvoiceConfig';
  const service = mapFn === 'toPhoneConfig' ? 'phone' : 'invoicing';
  old.parameters.jsCode = n.code('x', `
const { clientconfig: CC, requests: R } = KS;
const res = $input.first().json;
if (!R.ok(res)) throw new Error('CLIENT CONFIG: could not read the Airtable registry (' + res.statusCode + ')');
const hint = $('Find client in registry').first().json.hint;
const out = CC.chooseClient(res.body.records || [], hint);
if (out.error) throw new Error('CLIENT CONFIG (${service}): ' + out.error);
return [{ json: CC.${mapFn}(out.client, out.record) }];`, { libs: L }).parameters.jsCode;
  return true;
}

module.exports = async function modify(w) {
  const replies = addReplyTo(w);
  const config = rebuildConfig(w);
  console.error(`  ${w.name}: reply_to added to ${replies} email node(s)${config ? ', Client Config rebuilt' : ''}`);
};
module.exports.addReplyTo = addReplyTo;
module.exports.rebuildConfig = rebuildConfig;
