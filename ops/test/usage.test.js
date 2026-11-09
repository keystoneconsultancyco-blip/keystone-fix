'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../lib/usage');
const D = 864e5;
const t0 = Date.UTC(2026, 11, 1, 6); // 1 Dec 2026 06:00

test('new cycle starts from the newest execution id; no alert', () => {
  const r = U.execUsage({ S: {}, latestId: '30000', now: t0 });
  assert.equal(r.used, 0); assert.equal(r.alert, null); assert.equal(r.settings.n8n_exec_start_id, '30000'); assert.equal(r.partial, false);
});
test('alerts once at 80% and once at 100%', () => {
  const S = { n8n_exec_cycle: '2026-12-01', n8n_exec_start_id: '30000', n8n_monthly_executions: '2500' };
  const a = U.execUsage({ S, latestId: 32000, now: t0 + 20 * D });
  assert.equal(a.pct, 80); assert.equal(a.alert, '80'); assert.match(a.text, /2000 of its 2500/);
  const b = U.execUsage({ S: { ...S, n8n_exec_alerted: a.settings.n8n_exec_alerted }, latestId: 32100, now: t0 + 21 * D });
  assert.equal(b.alert, null);
  const c = U.execUsage({ S: { ...S, n8n_exec_alerted: '80' }, latestId: 32500, now: t0 + 25 * D });
  assert.equal(c.alert, '100'); assert.equal(c.settings.n8n_exec_alerted, '80,100');
});
test('reset day moves the cycle and clears alerts', () => {
  assert.equal(U.cycleStart(Date.UTC(2026, 10, 9), 15).toISOString().slice(0, 10), '2026-10-15');
  assert.equal(U.cycleStart(Date.UTC(2026, 10, 20), 15).toISOString().slice(0, 10), '2026-11-15');
  const r = U.execUsage({ S: { n8n_exec_cycle: '2026-11-01', n8n_exec_start_id: '1', n8n_exec_alerted: '80,100' }, latestId: 40000, now: t0 });
  assert.equal(r.used, 0); assert.equal(r.settings.n8n_exec_alerted, '');
});
test('bad read never alerts', () => { assert.equal(U.execUsage({ S: {}, latestId: undefined }).ok, false); });
