'use strict';
// Change 3b: a failed customer confirmation email must not fail the job (the Xero DRAFT already exists).
// Demo clients' customer emails go to the Keystone test inbox.
const { H } = require('../scripts/stock');
module.exports = async function modify(w) {
  const e = H.node(w, 'Send Confirmation Email (Resend)');
  e.onError = 'continueRegularOutput';
  e.parameters.jsonBody = e.parameters.jsonBody.replace('to: [$json.customerEmail]', "to: [$json.isDemo ? 'khan.bilalbk408@gmail.com' : $json.customerEmail]");
  if (!e.parameters.jsonBody.includes('$json.isDemo')) throw new Error('could not rewrite email recipient');
  const b = H.node(w, 'Build Success Result (Email Sent)');
  b.parameters.jsCode = b.parameters.jsCode.replace('emailSent: true,', "emailSent: !($input.item.json && $input.item.json.error), emailError: ($input.item.json && $input.item.json.error) ? String($input.item.json.error.message || $input.item.json.error).slice(0, 300) : null,");
  if (!b.parameters.jsCode.includes('emailError')) throw new Error('could not rewrite success result');
};
