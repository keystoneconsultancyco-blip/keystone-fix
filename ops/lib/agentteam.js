'use strict';
// Keystone's AI agent team: who does what, how they log, and the data each Jarvis page shows.
// The Airtable "Agents" table is the live switchboard (Status Live / Off / Paused). This file holds the defaults.

const { escapeHtml: e } = require('./log');

const TEAM = [
  { slug: 'chief-of-staff', name: 'Chief of Staff', live: true, tier: 'Routine (Haiku)', schedule: 'Daily brief 07:05, weekly scorecard Sunday 18:10',
    role: 'Oversees every agent. Sends Bilal a daily brief and a weekly scorecard towards £1M profit, chases approvals, and says when a switch-on threshold is reached.',
    goal: 'Bilal starts every day knowing the 3 things that matter, and every week sees progress towards £1M profit.', metric: 'briefs_sent', target: 7, period: 'Week' },
  { slug: 'lead-researcher', name: 'Lead Researcher', live: true, tier: 'Routine (Haiku)', schedule: 'Daily 20:35',
    role: 'Finds UK founder-led SMEs that would gain most from Keystone (halal-screened), researches each one and adds them to Prospects with weak points and a price band. Replaces the old Client Finder task.',
    goal: 'A steady pipeline of well-researched, high-potential prospects.', metric: 'high_potential_leads', target: 15, period: 'Week' },
  { slug: 'outreach', name: 'Outreach', live: true, tier: 'Routine (Haiku)', schedule: 'Daily 08:20 and after each research run',
    role: 'Drafts a personal email for each high-potential prospect. Never sends on its own: Bilal approves each one (YES/NO). Approved emails go out once the email domain is verified.',
    goal: 'Every high-potential prospect has a ready-to-approve email within a day.', metric: 'drafts_ready', target: 10, period: 'Week' },
  { slug: 'sales-prep', name: 'Sales Prep', live: true, tier: 'Routine (Haiku) for briefs, Strong (Opus) for proposals', schedule: 'Every 30 minutes',
    role: 'When a discovery call is booked it writes a call brief. It turns the prospect into an audit intake, and once Bilal approves the audit it drafts the proposal and quote (Opus) for his approval.',
    goal: 'Walk into every call prepared; turn every approved audit into a proposal the same day.', metric: 'sales_docs_ready', target: 3, period: 'Week' },
  { slug: 'ops-monitor', name: 'Ops Monitor', live: true, tier: 'No AI', schedule: 'Hourly',
    role: 'Checks every live workflow every hour (still switched on, recent failures) on top of the instant failure alerts, and alerts Bilal if anything is off.',
    goal: 'Every client workflow healthy, every failure noticed within the hour.', metric: 'health_checks', target: 168, period: 'Week' },
  { slug: 'onboarding', name: 'Onboarding', live: false, threshold: 5, tier: 'Routine (Haiku)', schedule: 'Daily 09:10',
    role: 'Checks each client in Onboarding against the setup checklist (halal screen, AI disclosure, Xero, jobs sheet, phone, email) and tells Bilal exactly what is missing.',
    goal: 'New clients live within 14 days with nothing missed.', metric: 'checklists_run', target: 5, period: 'Week' },
  { slug: 'client-success', name: 'Client Success', live: false, threshold: 5, tier: 'Routine (Haiku)', schedule: 'Monday 10:10',
    role: 'Reviews each active client weekly (hours saved, invoices, calls, problems) and drafts a short check-in for Bilal to approve.',
    goal: 'Every client hears from Keystone every week; no client goes quiet.', metric: 'checkins_drafted', target: 5, period: 'Week' },
  { slug: 'cfo', name: 'Keystone CFO', live: false, threshold: 5, tier: 'Strong (Opus)', schedule: '1st of the month 08:10',
    role: "Keystone's own finance: monthly fees, AI and tool costs, profit, cash runway and pricing advice. Recommendations only; Bilal decides.",
    goal: 'Bilal knows Keystone\'s profit and margin every month and what to change.', metric: 'monthly_reviews', target: 1, period: 'Month' },
  { slug: 'content', name: 'Content', live: false, threshold: 20, tier: 'Routine (Haiku)', schedule: 'Wednesday 11:10',
    role: 'Drafts one LinkedIn post or case study a week from anonymised results. Nothing is posted without approval.',
    goal: 'A steady stream of proof that brings in leads.', metric: 'posts_drafted', target: 1, period: 'Week' },
  { slug: 'compliance', name: 'Compliance', live: false, threshold: 20, tier: 'Routine (Haiku)', schedule: '2nd of the month 09:10',
    role: 'Monthly checks: halal screen still valid for every client, AI phone disclosure rules per jurisdiction, data kept no longer than needed (UK GDPR).',
    goal: 'No compliance surprises.', metric: 'compliance_checks', target: 1, period: 'Month' },
  { slug: 'systems-builder', name: 'Systems Builder', live: false, threshold: 20, tier: 'Routine (Haiku)', schedule: 'Friday 15:10',
    role: 'Reads the week\'s failures, review items and manual fixes and proposes the improvements that would save the most time.',
    goal: 'Fewer manual fixes every month.', metric: 'improvements_proposed', target: 2, period: 'Week' },
];

// Which approval types belong to which agent's page.
const APPROVAL_OWNER = {
  outreach_send: 'outreach', proposal_send: 'sales-prep', agent_switch_on: 'chief-of-staff', client_checkin: 'client-success',
  content_post: 'content', quote_send: 'ops-monitor', invoice_resubmit: 'ops-monitor',
};

const f = (r) => (r && r.fields ? r.fields : r || {});
const sel = (v) => (v && v.name) || v || '';
const num = (v) => Number(v) || 0;

function bySlug(slug) { return TEAM.find((a) => a.slug === slug); }

// Agents table rows -> {slug: {status, ...}}
function agentRows(records) {
  const out = {};
  for (const r of records || []) { const x = f(r); if (x.Slug) out[x.Slug] = { id: r.id, status: sel(x.Status), threshold: x['Switch on at active clients'], workflowId: x['Workflow ID'], alertSent: !!x['Threshold alert sent'], lastRun: x['Last run'], lastResult: x['Last result'], counters: x['Counters JSON'] || '' }; }
  return out;
}

function isLive(rows, slug) { return !!(rows[slug] && rows[slug].status === 'Live'); }

// One Agent Team Log row.
function logRow({ agent, kind = 'Run', summary, items, metric, ref, details, cost, executionId, now }) {
  return {
    'Summary': String(summary || '').slice(0, 250), 'Agent': agent, 'Kind': kind, 'Timestamp': (now || new Date()).toISOString(),
    ...(items !== undefined ? { 'Items': num(items) } : {}), ...(metric ? { 'Metric': metric } : {}), ...(ref ? { 'Ref': String(ref).slice(0, 200) } : {}),
    ...(details ? { 'Details': String(details).slice(0, 20000) } : {}), ...(cost !== undefined ? { 'Cost USD': Math.round(num(cost) * 10000) / 10000 } : {}),
    ...(executionId ? { 'Execution ID': String(executionId) } : {}),
  };
}

// Running counters kept on each Agents row (Airtable reads cap at 100 rows, so we don't recount the log).
function dayKey(d) { return new Date(d).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); }
function bumpCounters(prevJson, done, cost, now) {
  let c = {};
  try { c = JSON.parse(prevJson || '{}') || {}; } catch (err) { c = {}; }
  const t = now || new Date();
  const day = dayKey(t), week = dayKey(periodStart('Week', t)), month = day.slice(0, 7);
  const out = {
    day, dayN: (c.day === day ? num(c.dayN) : 0) + num(done),
    week, weekN: (c.week === week ? num(c.weekN) : 0) + num(done),
    month, monthN: (c.month === month ? num(c.monthN) : 0) + num(done),
    costMonth: Math.round(((c.month === month ? num(c.costMonth) : 0) + num(cost)) * 10000) / 10000,
    costWeek: Math.round(((c.week === week ? num(c.costWeek) : 0) + num(cost)) * 10000) / 10000,
    costDay: Math.round(((c.day === day ? num(c.costDay) : 0) + num(cost)) * 10000) / 10000,
  };
  return out;
}
function readCounters(json, now) {
  const fresh = bumpCounters(json, 0, 0, now);
  return fresh;
}

// Off agents whose threshold is reached and whose alert hasn't been sent.
function thresholdsReached(rows, activeClients) {
  return TEAM.filter((a) => !a.live && a.threshold && activeClients >= a.threshold)
    .filter((a) => rows[a.slug] && rows[a.slug].status !== 'Live' && !rows[a.slug].alertSent);
}

// Start of today / this week (Monday) / this month in UK time, as Date.
function periodStart(period, now) {
  const d = new Date(now || Date.now());
  const uk = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const offset = d.getTime() - uk.getTime();
  const s = new Date(uk); s.setHours(0, 0, 0, 0);
  if (period === 'Week') s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  if (period === 'Month') s.setDate(1);
  return new Date(s.getTime() + offset);
}

// Everything the Jarvis agent pages show. Inputs are raw Airtable records.
function buildFeed({ agents = [], log = [], approvals = [], settings = {}, activeClients = 0, now }) {
  const t = now ? new Date(now) : new Date();
  const rows = agentRows(agents);
  const L = log.map(f), A = approvals.map((r) => ({ id: r.id, ...f(r) }));
  const after = (ts, d) => Date.parse(ts) >= d.getTime();
  const team = TEAM.map((a) => {
    const row = rows[a.slug] || {};
    const mine = L.filter((x) => x.Agent === a.slug).sort((x, y) => Date.parse(y.Timestamp) - Date.parse(x.Timestamp));
    const c = readCounters(row.counters, t);
    const progress = a.period === 'Day' ? c.dayN : a.period === 'Month' ? c.monthN : c.weekN;
    const target = a.target;
    const lastRun = mine.find((x) => ['Run', 'Completed', 'Skipped'].includes(sel(x.Kind)));
    return {
      slug: a.slug, name: a.name, status: row.status || (a.live ? 'Live' : 'Off - waiting for threshold'), threshold: a.threshold || null,
      role: a.role, goal: a.goal, schedule: a.schedule, tier: a.tier,
      metric: a.metric, target, period: a.period, progress, pct: target ? Math.min(100, Math.round(progress / target * 100)) : 0,
      currentWork: row.status !== 'Live' ? (a.threshold ? `Switched off until ${a.threshold} active clients (now ${activeClients}).` : 'Paused.') : (lastRun ? `Last: ${lastRun.Summary}` : 'Waiting for its first run.'),
      lastRunAt: lastRun ? lastRun.Timestamp : row.lastRun || null,
      completedToday: c.dayN, completedWeek: c.weekN, completedMonth: c.monthN,
      awaitingApproval: A.filter((x) => sel(x.Status) === 'Pending' && APPROVAL_OWNER[sel(x.Type)] === a.slug).map((x) => ({ code: x.Code, type: sel(x.Type), summary: x.Summary, created: x.Created })),
      errors: mine.filter((x) => sel(x.Kind) === 'Error' && after(x.Timestamp, new Date(t.getTime() - 7 * 864e5))).slice(0, 10).map((x) => ({ at: x.Timestamp, summary: x.Summary })),
      aiCost: { today: round2(c.costDay), week: round2(c.costWeek), month: round2(c.costMonth) },
      recent: mine.slice(0, 8).map((x) => ({ at: x.Timestamp, kind: sel(x.Kind), summary: x.Summary })),
    };
  });
  const monthSpend = num(settings.ai_spend_month) === 0 && settings.ai_spend_month !== dayKey(t).slice(0, 7) ? 0 : num(settings.ai_spend_usd);
  return {
    generatedAt: t.toISOString(), activeClients,
    ai: { monthSpendUsd: round2(monthSpend), creditUsd: num(settings.ai_monthly_credit_usd), status: settings.ai_status || 'ok', alertPct: num(settings.ai_alert_pct) || 80 },
    team,
  };
}
function round2(n) { return Math.round(num(n) * 100) / 100; }

// ---------- emails ----------
function briefHtml(title, sections, footer) {
  return `<div style="font-family:Arial,sans-serif;max-width:640px;color:#111">
<h2 style="color:#1F3A5F;margin:0 0 12px">${e(title)}</h2>
${sections.map((s) => `<h3 style="margin:18px 0 6px;font-size:15px">${e(s.heading)}</h3><ul style="margin:0;padding-left:18px">${(s.items || []).map((i) => `<li style="margin:3px 0">${e(i)}</li>`).join('') || '<li>Nothing today.</li>'}</ul>`).join('\n')}
${footer ? `<p style="font-size:12px;color:#6b7280;margin-top:18px">${e(footer)}</p>` : ''}</div>`;
}
function briefText(title, sections) {
  return [title, ''].concat(...sections.map((s) => [s.heading + ':', ...(s.items || []).map((i) => '- ' + i), ''])).join('\n');
}

module.exports = { TEAM, APPROVAL_OWNER, bySlug, agentRows, isLive, logRow, thresholdsReached, periodStart, dayKey, bumpCounters, readCounters, buildFeed, briefHtml, briefText };
