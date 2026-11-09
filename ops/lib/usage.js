'use strict';
// n8n execution usage, checked by Ops Monitor (no extra runs of its own).
// n8n numbers every execution on the instance in order, so "executions this cycle" = newest execution id minus the
// newest id seen when the cycle started. That also counts test, sub-workflow and error runs, which n8n may not bill,
// so the figure reads a little high: the safe direction for an alert.
// Keystone Settings: n8n_monthly_executions (plan limit, default 2500 = Starter), n8n_reset_day (day of month the
// n8n allowance resets, default 1); the rest are kept by this code: n8n_exec_cycle, n8n_exec_start_id, n8n_exec_alerted.
const DAY = 864e5;

function cycleStart(now, resetDay) {
  const d = new Date(now);
  const day = Math.min(Math.max(Number(resetDay) || 1, 1), 28);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (d.getUTCDate() < day) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  return new Date(Date.UTC(y, m, day));
}

function execUsage({ S = {}, latestId, now = Date.now() }) {
  const limit = Number(S.n8n_monthly_executions) || 2500;
  const start = cycleStart(now, S.n8n_reset_day);
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()));
  const key = start.toISOString().slice(0, 10);
  const id = Number(latestId);
  if (!(id > 0)) return { ok: false, reason: 'could not read the latest n8n execution' };
  const fresh = S.n8n_exec_cycle !== key || !(Number(S.n8n_exec_start_id) > 0);
  const startId = fresh ? id : Number(S.n8n_exec_start_id);
  // A cycle first seen part-way through (e.g. the day this check was added) can't know the runs before it.
  const partial = fresh ? (now - start.getTime() > DAY) : S.n8n_exec_partial === 'yes';
  const used = Math.max(0, id - startId);
  const pct = Math.round(used / limit * 100);
  const elapsed = Math.max((now - start.getTime()) / DAY, 0.5);
  const cycleDays = (next - start) / DAY;
  const projected = Math.round(used / elapsed * cycleDays);
  const alerted = fresh ? '' : String(S.n8n_exec_alerted || '');
  const level = pct >= 100 ? '100' : pct >= 80 ? '80' : '';
  const alert = level && !alerted.split(',').includes(level) ? level : null;
  const settings = { n8n_exec_cycle: key, n8n_exec_start_id: String(startId), n8n_exec_used: String(used), n8n_exec_partial: partial ? 'yes' : 'no',
    n8n_exec_alerted: alert ? (alerted ? alerted + ',' + alert : alert) : alerted };
  const resets = next.toISOString().slice(0, 10);
  const line = 'n8n executions: ' + used + ' of ' + limit + ' (' + pct + '%) this cycle' + (partial ? ' (counted since ' + new Date(now).toISOString().slice(0, 10) + ')' : '') + ', on course for about ' + projected + ' by ' + resets + '.';
  const text = alert ? (alert === '100'
    ? 'n8n has used ' + used + ' of its ' + limit + ' monthly executions (' + pct + '%). n8n stops running workflows at the limit (phone, invoices, website). It resets on ' + resets + '; to keep running before then, upgrade the n8n plan (a cost decision for you).'
    : 'n8n has used ' + used + ' of its ' + limit + ' monthly executions (' + pct + '%) and is on course for about ' + projected + ' by ' + resets + '. If that passes ' + limit + ', n8n stops running workflows. Options: upgrade the n8n plan, or tell me to slow more schedules down.') : null;
  return { ok: true, used, limit, pct, projected, partial, resets, settings, alert, text, line };
}

module.exports = { execUsage, cycleStart };
