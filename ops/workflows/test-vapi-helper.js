'use strict';
// KS Util - Vapi helper: lets Keystone scripts read Vapi config and update an assistant's tools.
// Locked by a secret token (set at deploy, never committed). Allowed: GET assistant/phone-number/credential, PATCH assistant.
const n = require('../scripts/n8n');
const TOKEN = process.env.KS_VAPI_HELPER_TOKEN || 'set-at-deploy';
const nodes = [
  n.webhook('Vapi helper', 'ks-util-vapi-helper'),
  n.code('Check request', `
const b = $json.body || {};
if (b.token !== ${JSON.stringify(TOKEN)}) return [{ json: { allowed: false, response: { ok: false, error: 'bad token' } } }];
const m = String(b.method || 'GET').toUpperCase();
const p = String(b.path || '');
const ok = (m === 'GET' && /^(assistant|phone-number|credential|tool)(\\/[A-Za-z0-9-]+)?$/.test(p)) || ((m === 'PATCH') && /^(assistant|tool)\\/[A-Za-z0-9-]+$/.test(p)) || (m === 'POST' && p === 'tool');
if (!ok) return [{ json: { allowed: false, response: { ok: false, error: 'not allowed' } } }];
return [{ json: { allowed: true, req: { url: 'https://api.vapi.ai/' + p, method: m, body: b.body || {} } } }];`),
  n.iff('Allowed?', 'allowed'),
  n.http('Call Vapi', 'vapi', { method: '={{ $json.req.method }}', sendBody: true }),
  n.code('Wrap', `return [{ json: { response: { ok: $json.statusCode < 300, statusCode: $json.statusCode, body: $json.body } } }];`),
  n.respond('Respond'),
  n.respond('Respond refused'),
];
module.exports = n.workflow('KS Util - Vapi helper', nodes, [['Vapi helper', 'Check request'], ['Check request', 'Allowed?'], ['Allowed?', 'Call Vapi', 0], ['Allowed?', 'Respond refused', 1], ['Call Vapi', 'Wrap'], ['Wrap', 'Respond']], { tags: ['keystone', 'util'] });
