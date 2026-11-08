'use strict';
// KS Test - Xero helper: TEST ONLY. Lets the test scripts read Xero, delete DRAFT test invoices
// and archive test contacts. Locked by a secret token (passed at deploy time); deactivated after tests.
// Refuses anything else: no creating, approving or paying.
const n = require('../scripts/n8n');
const TOKEN = process.env.KS_XERO_HELPER_TOKEN || 'set-at-deploy';
const nodes = [
  n.webhook('Xero helper', 'ks-test-xero-helper'),
  n.code('Check request', `
const b = $json.body || {};
const TOKEN = ${JSON.stringify(TOKEN)};
if (b.token !== TOKEN) return [{ json: { allowed: false, response: { ok: false, error: 'bad token' } } }];
const m = String(b.method || 'GET').toUpperCase();
const path = String(b.path || '');
let allowed = false, url;
if (path === 'connections' && m === 'GET') { allowed = true; url = 'https://api.xero.com/connections'; }
else if (m === 'GET' && /^(Invoices|Contacts|Organisation)/.test(path)) { allowed = true; url = 'https://api.xero.com/api.xro/2.0/' + path; }
else if (m === 'POST' && path === 'Invoices' && (b.body && b.body.Invoices || []).every((i) => i.Status === 'DELETED' && i.InvoiceID)) { allowed = true; url = 'https://api.xero.com/api.xro/2.0/Invoices'; }
else if (m === 'POST' && path === 'Contacts' && (b.body && b.body.Contacts || []).every((c) => c.ContactStatus === 'ARCHIVED' && c.ContactID)) { allowed = true; url = 'https://api.xero.com/api.xro/2.0/Contacts'; }
if (!allowed) return [{ json: { allowed: false, response: { ok: false, error: 'not allowed' } } }];
return [{ json: { allowed: true, req: { url, method: m, body: b.body || {}, tenantId: b.tenantId || '' } } }];`),
  n.iff('Allowed?', 'allowed'),
  Object.assign(n.http('Call Xero', 'xero', { method: '={{ $json.req.method }}', headers: [['xero-tenant-id', '={{ $json.req.tenantId }}'], ['Accept', 'application/json']], sendBody: true }), {}),
  n.code('Wrap', `return [{ json: { response: { ok: $json.statusCode < 300, statusCode: $json.statusCode, body: $json.body } } }];`),
  n.respond('Respond'),
  n.respond('Respond refused'),
];
module.exports = n.workflow('KS Test - Xero helper', nodes, [['Xero helper', 'Check request'], ['Check request', 'Allowed?'], ['Allowed?', 'Call Xero', 0], ['Allowed?', 'Respond refused', 1], ['Call Xero', 'Wrap'], ['Wrap', 'Respond']], { tags: ['keystone', 'test'] });
