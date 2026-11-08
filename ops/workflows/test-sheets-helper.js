'use strict';
// KS Test - Sheets helper: TEST ONLY. Reads or clears data rows (row 2 down) in the Keystone TEST log sheets listed below. Nothing else.
const n = require('../scripts/n8n');
const TOKEN = process.env.KS_SHEETS_HELPER_TOKEN || 'set-at-deploy';
const SHEETS = { calllog: '1pvDZQ2RBAPT6YrPCNQpShrug0wLLvmPWDKva-xA3h78' };
const nodes = [
  n.webhook('Sheets helper', 'ks-test-sheets-helper'),
  n.code('Check request', `
const b = $json.body || {};
const S = ${JSON.stringify(SHEETS)};
if (b.token !== ${JSON.stringify(TOKEN)} || !S[b.sheet] || !/^[A-Za-z]+$/.test(b.tab || '')) return [{ json: { allowed: false, response: { ok: false, error: 'not allowed' } } }];
const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + S[b.sheet] + '/values/' + b.tab + '!A2:Z1000';
return [{ json: { allowed: true, req: b.op === 'clear' ? { method: 'POST', url: base + ':clear', body: {} } : { method: 'GET', url: base, body: {} } } }];`),
  n.iff('Allowed?', 'allowed'),
  n.http('Call Sheets', 'sheets', { method: '={{ $json.req.method }}', sendBody: true }),
  n.code('Wrap', `return [{ json: { response: { ok: $json.statusCode < 300, statusCode: $json.statusCode, body: $json.body } } }];`),
  n.respond('Respond'), n.respond('Respond refused'),
];
module.exports = n.workflow('KS Test - Sheets helper', nodes, [['Sheets helper', 'Check request'], ['Check request', 'Allowed?'], ['Allowed?', 'Call Sheets', 0], ['Allowed?', 'Respond refused', 1], ['Call Sheets', 'Wrap'], ['Wrap', 'Respond']], { tags: ['keystone', 'test'] });
