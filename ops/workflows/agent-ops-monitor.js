'use strict';
// KS Agent - Ops Monitor (hourly, no AI). Sits on top of the instant failure alerts (KS Ops - Failure Alerts):
// checks that every workflow that should be on is still on, counts failures in the last hour/day,
// and alerts Bilal once per new problem (not every hour).
const { makeAgent } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Ops Monitor',
  slug: 'ops-monitor',
  crons: [{ label: 'Hourly at :17', cron: '17 * * * *' }],
  n8nReads: `return [['workflows', '/workflows?limit=200'], ['errors', '/executions?status=error&limit=100']];`,
  plan: `
const wfs = (N.workflows && N.workflows.data) || [];
const errs = (N.errors && N.errors.data) || [];
if (!wfs.length) return [{ ctx: { problem: 'Could not read the n8n workflow list (' + JSON.stringify(N.workflows || {}).slice(0, 120) + ')', fatal: true } }];
// Workflows that are meant to be off: test/util helpers, out-of-scope stock, and agents waiting for a threshold.
const offAgentIds = new Set(Object.values(rows).filter((r) => r.status !== 'Live' && r.workflowId).map((r) => r.workflowId));
const intentionallyOff = (w) => /^KS (Test|Util)\\b/.test(w.name) || /Collections Reminders/.test(w.name) || offAgentIds.has(w.id);
const production = wfs.filter((w) => (/^\\[Stock\\]/.test(w.name) || /^KS /.test(w.name)) && !intentionallyOff(w));
const off = production.filter((w) => !w.active).map((w) => w.name);
const hourAgo = Date.now() - 3600e3, dayAgo = Date.now() - 864e5;
const nameOf = Object.fromEntries(wfs.map((w) => [w.id, w.name]));
const errHour = errs.filter((e) => Date.parse(e.startedAt) >= hourAgo);
const errDay = errs.filter((e) => Date.parse(e.startedAt) >= dayAgo);
const byWf = {};
for (const e of errDay) byWf[nameOf[e.workflowId] || e.workflowId] = (byWf[nameOf[e.workflowId] || e.workflowId] || 0) + 1;
const last = (rows[SLUG] || {}).lastResult || '';
return [{ ctx: { production: production.length, off, errHour: errHour.length, errDay: errDay.length, byWf, last } }];`,
  handle: `
if (ctx.fatal) return { error: ctx.problem };
const healthy = ctx.production - ctx.off.length;
const summary = 'Health check: ' + healthy + '/' + ctx.production + ' workflows on; ' + ctx.errHour + ' failure(s) in the last hour, ' + ctx.errDay + ' in 24h' + (ctx.off.length ? '. OFF: ' + ctx.off.join(', ') : '');
const notices = [];
// Alert once when a production workflow is found switched off (the instant alerts cover individual failures).
const newOff = ctx.off.filter((n) => !ctx.last.includes(n));
if (newOff.length) notices.push({ kind: 'failure', text: 'Ops Monitor: these Keystone workflows are switched OFF and should be on: ' + newOff.join(', ') + '. Customers may not be served. Open n8n and switch them back on (or tell me to).' });
const busy = Object.entries(ctx.byWf).filter(([, n]) => n >= 5).map(([w, n]) => w + ' (' + n + ')');
if (busy.length && !ctx.last.includes('Repeated failures')) notices.push({ kind: 'failure', text: 'Ops Monitor: repeated failures in the last 24 hours: ' + busy.join(', ') + '. Each failure was already alerted; this is the pattern.' });
return { done: 1, notices, summary: summary + (busy.length ? '. Repeated failures: ' + busy.join(', ') : ''), log: ctx.off.length ? [{ kind: 'Error', summary: 'Workflows switched off: ' + ctx.off.join(', ') }] : [] };`,
});
