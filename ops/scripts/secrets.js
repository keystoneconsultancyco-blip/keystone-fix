'use strict';
// Where the ops scripts get their keys.
// Keys live in the cloud environment's network secrets: the HTTPS proxy adds them to requests to
// n8n and Airtable, so no script ever holds a real key. We send a placeholder that the proxy replaces.
// Node's built-in fetch only uses the proxy when NODE_USE_ENV_PROXY=1 is set, so we check for it.
// If an old-style key is still in the environment (KS_N8N_KEY / KS_AIRTABLE_TOKEN), that is used instead.

const PLACEHOLDER = 'proxy-injected';

function requireProxy() {
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== '1') {
    throw new Error('Run this with NODE_USE_ENV_PROXY=1 so requests go through the proxy that adds the keys, e.g.\n  NODE_USE_ENV_PROXY=1 node ' + process.argv.slice(1).join(' '));
  }
}

function n8nKey() { requireProxy(); return process.env.KS_N8N_KEY || PLACEHOLDER; }
function airtableToken() { requireProxy(); return process.env.KS_AIRTABLE_TOKEN || PLACEHOLDER; }

module.exports = { n8nKey, airtableToken, PLACEHOLDER };
