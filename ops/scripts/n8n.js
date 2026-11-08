'use strict';
// Tiny DSL for writing n8n workflows as code. Generated JSON imports through
// n8n: Workflows > Import from file. Credentials are referenced by NAME; after import,
// open each HTTP node once and pick the credential if n8n asks (see docs/DEPLOY_N8N.md).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIB_DIR = path.join(__dirname, '..', 'lib');
const AIRTABLE = require('../config/airtable.json');

// Credential names Bilal creates or already has in n8n.
const CREDS = {
  airtable: { type: 'airtableTokenApi', name: 'Keystone Airtable' },
  xero: { type: 'xeroOAuth2Api', name: 'Xero account' },
  anthropic: { type: 'httpHeaderAuth', name: 'Keystone Anthropic' },
  resend: { type: 'httpHeaderAuth', name: 'Header Auth account 2' },
  vapi: { type: 'httpHeaderAuth', name: 'Vapi AP1' },
  gcal: { type: 'googleCalendarOAuth2Api', name: 'Google Calendar account' },
  twilio: { type: 'twilioApi', name: 'Twilio' },
  n8n: { type: 'n8nApi', name: 'Keystone n8n API' },
  sheets: { type: 'googleSheetsOAuth2Api', name: 'Google Sheets account' },
};

function uuid(seed) {
  const h = crypto.createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ----- library bundling for Code nodes -----
function libDeps(name, seen = new Set()) {
  if (seen.has(name)) return seen;
  seen.add(name);
  const src = fs.readFileSync(path.join(LIB_DIR, name + '.js'), 'utf8');
  for (const m of src.matchAll(/require\('\.\/([a-z]+)'\)/g)) libDeps(m[1], seen);
  return seen;
}

function bundle(libs) {
  const all = new Set();
  for (const l of libs) libDeps(l, all);
  const mods = [...all].map((n) => {
    const src = fs.readFileSync(path.join(LIB_DIR, n + '.js'), 'utf8');
    return `  '${n}': function (module, exports, require) {\n${src}\n  }`;
  }).join(',\n');
  return `// ===== Keystone shared library (generated from ops/lib; do not edit here) =====
const __KS = (() => {
  const defs = {
${mods}
  };
  const cache = {};
  function req(p) {
    const n = String(p).replace(/^\\.\\//, '');
    if (defs[n]) {
      if (!cache[n]) { const module = { exports: {} }; cache[n] = module; defs[n](module, module.exports, req); }
      return cache[n].exports;
    }
    if (typeof require === 'function') return require(p);
    throw new Error('module not available: ' + p);
  }
  return req;
})();
const KS = {${[...all].map((n) => ` ${n}: __KS('./${n}')`).join(',')} };
const AIRTABLE = ${JSON.stringify(AIRTABLE)};
// ===== end library =====
`;
}

// ----- node helpers -----
function base(name, type, typeVersion, parameters, extra = {}) {
  return { name, type, typeVersion, parameters, ...extra };
}

function code(name, body, { libs = [], mode = 'runOnceForAllItems' } = {}) {
  const jsCode = (libs.length ? bundle(libs) : '') + body.trim() + '\n';
  return base(name, 'n8n-nodes-base.code', 2, { mode, jsCode });
}

function webhook(name, pathName, { method = 'POST', respond = 'responseNode' } = {}) {
  return base(name, 'n8n-nodes-base.webhook', 2, { httpMethod: method, path: pathName, responseMode: respond, options: {} }, { webhookId: uuid('wh-' + pathName) });
}

function schedule(name, cron) {
  return base(name, 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'cronExpression', expression: cron }] } });
}

function manual(name) { return base(name, 'n8n-nodes-base.manualTrigger', 1, {}); }
function errorTrigger(name) { return base(name, 'n8n-nodes-base.errorTrigger', 1, {}); }
function noop(name) { return base(name, 'n8n-nodes-base.noOp', 1, {}); }

// HTTP node: every request is described by $json.req = {url, method?, body?, headers?}
// prepared by the Code node before it. fullResponse + neverError so the next Code node
// sees {statusCode, body} and decides what to do (fail safe).
function http(name, cred, { method = 'POST', headers = [], sendBody = true, timeout = 30000 } = {}) {
  // method may be '={{ $json.req.method }}' for nodes that serve several verbs.
  const c = CREDS[cred];
  const p = {
    method,
    url: '={{ $json.req.url }}',
    authentication: c ? (['httpHeaderAuth'].includes(c.type) ? 'genericCredentialType' : 'predefinedCredentialType') : 'none',
    ...(c && c.type === 'httpHeaderAuth' ? { genericAuthType: 'httpHeaderAuth' } : {}),
    ...(c && c.type !== 'httpHeaderAuth' ? { nodeCredentialType: c.type } : {}),
    sendHeaders: headers.length > 0,
    headerParameters: { parameters: headers.map(([n, v]) => ({ name: n, value: v })) },
    sendBody,
    ...(sendBody ? { specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.req.body || {}) }}' } : {}),
    options: { response: { response: { fullResponse: true, neverError: true } }, timeout },
  };
  if (!headers.length) delete p.headerParameters;
  const node = base(name, 'n8n-nodes-base.httpRequest', 4.2, p);
  if (c) node.credentials = { [c.type]: { id: '', name: c.name } };
  return node;
}

// Convenience: Claude, Airtable, Resend, Xero HTTP nodes with the right headers.
const claudeHttp = (name) => http(name, 'anthropic', { headers: [['anthropic-version', '2026-10-21'], ['anthropic-beta', 'server-side-fallback-2026-07-01']], timeout: 120000 });
const airtableHttp = (name, method = 'POST') => http(name, 'airtable', { method, sendBody: method !== 'GET' && method !== 'DELETE' });
const airtableWrite = (name) => http(name, 'airtable', { method: '={{ $json.req.method }}', sendBody: true });
const xeroHttp = (name, method = 'POST') => http(name, 'xero', { method, sendBody: method !== 'GET', headers: [['xero-tenant-id', '={{ $json.req.tenantId }}'], ['Accept', 'application/json']] });
const resendHttp = (name) => http(name, 'resend');

// IF on a boolean field of $json.
function iff(name, field) {
  return base(name, 'n8n-nodes-base.if', 2, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
      conditions: [{ id: uuid(name + field), leftValue: `={{ $json.${field} }}`, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and',
    },
    options: {},
  });
}

// Switch on a numeric output index computed in code ($json.route), with n outputs.
function route(name, n) {
  return base(name, 'n8n-nodes-base.switch', 3, { mode: 'expression', numberOutputs: n, output: '={{ $json.route }}', options: {} });
}

function twilioSms(name) {
  const node = base(name, 'n8n-nodes-base.twilio', 1, { from: '={{ $json.sms.from }}', to: '={{ $json.sms.to }}', message: '={{ $json.sms.message }}', options: {} });
  node.credentials = { twilioApi: { id: '', name: CREDS.twilio.name } };
  return node;
}

// Shared tail: a Code node emits $json.writes = [{kind, req|sms}], and this fans them out.
function writesTail() {
  const nodes = [
    code('Fan out writes', `
const out = [];
for (const it of $input.all()) for (const w of (it.json.writes || [])) out.push({ json: { ...w, route: w.kind === 'email' ? 1 : w.kind === 'sms' ? 2 : 0 } });
return out;`),
    route('Write kind', 3),
    airtableWrite('Airtable write'),
    Object.assign(resendHttp('Send email'), { onError: 'continueRegularOutput' }),
    Object.assign(twilioSms('Send SMS'), { onError: 'continueRegularOutput' }),
  ];
  const edges = [['Fan out writes', 'Write kind'], ['Write kind', 'Airtable write', 0], ['Write kind', 'Send email', 1], ['Write kind', 'Send SMS', 2]];
  return { nodes, edges };
}

// Calls the private KS Ops - Notify sub-workflow. Never blocks the caller if it fails.
function notify(name) {
  const id = require('../config/n8n.json').notifyWorkflowId;
  return Object.assign(base(name, 'n8n-nodes-base.executeWorkflow', 1.2, { source: 'database', workflowId: { __rl: true, value: id, mode: 'id' }, mode: 'each', options: { waitForSubWorkflow: true } }), { onError: 'continueRegularOutput' });
}

function respond(name, kind = 'json') {
  const p = kind === 'xml'
    ? { respondWith: 'text', responseBody: '={{ $json.twiml }}', options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/xml' }] } } }
    : kind === 'html'
      ? { respondWith: 'text', responseBody: '={{ $json.html }}', options: { responseCode: '={{ $json.statusCode || 200 }}', responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }] } } }
      : { respondWith: 'json', responseBody: '={{ JSON.stringify($json.response) }}', options: {} };
  return base(name, 'n8n-nodes-base.respondToWebhook', 1.1, p);
}

// ----- workflow assembly -----
// edges: [from, to] or [from, to, outputIndex]
function workflow(name, nodes, edges, { errorWorkflow = true, tags = [] } = {}) {
  const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
  // layout: breadth-first columns from triggers
  const incoming = {};
  for (const [f, t] of edges) (incoming[t] = incoming[t] || []).push(f);
  const depth = {};
  const visit = (n, d) => { if (depth[n] !== undefined && depth[n] >= d) return; depth[n] = d; for (const [f, t] of edges) if (f === n) visit(t, d + 1); };
  nodes.filter((n) => !incoming[n.name]).forEach((n) => visit(n.name, 0));
  const rows = {};
  for (const n of nodes) {
    const d = depth[n.name] || 0;
    rows[d] = (rows[d] || 0) + 1;
    n.position = [d * 260, (rows[d] - 1) * 180];
    n.id = uuid(name + '/' + n.name);
  }
  const connections = {};
  for (const [from, to, out = 0] of edges) {
    if (!byName[from] || !byName[to]) throw new Error(`${name}: bad edge ${from} -> ${to}`);
    connections[from] = connections[from] || { main: [] };
    while (connections[from].main.length <= out) connections[from].main.push([]);
    connections[from].main[out].push({ node: to, type: 'main', index: 0 });
  }
  return {
    name,
    nodes,
    connections,
    active: false,
    settings: { executionOrder: 'v1', timezone: 'Europe/London', saveManualExecutions: true },
    // errorWorkflow is set by scripts/deploy.js (needs the Error Handler's n8n ID after import).
    __wantsErrorWorkflow: errorWorkflow,
    tags: tags.map((t) => ({ name: t })),
    meta: { keystone: true, generatedFrom: 'ops/workflows' },
  };
}

module.exports = { CREDS, AIRTABLE, uuid, bundle, code, webhook, schedule, manual, errorTrigger, noop, http, claudeHttp, airtableHttp, airtableWrite, xeroHttp, resendHttp, twilioSms, writesTail, notify, iff, route, respond, workflow };
