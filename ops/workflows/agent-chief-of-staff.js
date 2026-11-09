'use strict';
// KS Agent - Chief of Staff.
//  Daily 07:05: brief to Bilal (top 3 actions, pipeline, approvals waiting, agent problems, AI spend).
//  Sunday 18:10: weekly scorecard towards the £1M profit goal.
//  Every run: if active clients reach an agent's switch-on threshold, asks Bilal YES/NO to switch it on.
const { makeAgent, BASE } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Chief of Staff',
  slug: 'chief-of-staff',
  crons: [{ label: 'Daily 07:05', cron: '5 7 * * *' }, { label: 'Sunday 18:10', cron: '10 18 * * 0' }],
  libs: ['agentprompts'],
  reads: `
return [
  ['clients', list('clients', { formula: "{Status} = 'Active'", fields: ['Client name', 'Client ID', 'Is demo/test'], maxRecords: 100 })],
  ['prospects', list('prospects', { fields: ['Company', 'Status', 'Potential', 'Email approval', 'Make my client', 'Monthly fee', 'Found on', 'Next step', 'Next step date', 'Client health'], maxRecords: 100, sort: [{ field: 'Found on', direction: 'desc' }] })],
  ['wonClients', list('prospects', { formula: '{Make my client}', fields: ['Company', 'Monthly fee', 'Client health', 'Services active'], maxRecords: 100 })],
  ['approvals', list('opsApprovals', { formula: "{Status} = 'Pending'", fields: ['Code', 'Type', 'Summary', 'Created'], maxRecords: 50 })],
  ['log', list('teamLog', { formula: "IS_AFTER({Timestamp}, DATEADD(NOW(), -7, 'days'))", fields: ['Agent', 'Kind', 'Summary', 'Timestamp'], maxRecords: 100, sort: [{ field: 'Timestamp', direction: 'desc' }] })],
  ['reviews', list('needsReview', { formula: "{Status} = 'Open'", fields: ['Title', 'Client ID'], maxRecords: 50 })],
  ['audits', list('auditIntakes', { fields: ['Business name', 'Status', 'Created'], maxRecords: 20, sort: [{ field: 'Created', direction: 'desc' }] })],
];`,
  plan: `
const P = KS.agentprompts;
const ukNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
const weekly = input.mode === 'scorecard' || (input.mode !== 'brief' && ukNow.getDay() === 0 && ukNow.getHours() >= 17);
const f = (r) => r.fields || {};
const sel = (v) => (v && v.name) || v || '';
const realActive = D.clients.filter((r) => !f(r)['Is demo/test']);
const activeClients = Number(input.simulateActiveClients) >= 0 && input.simulateActiveClients !== undefined ? Number(input.simulateActiveClients) : realActive.length;
const mrr = D.wonClients.reduce((s, r) => s + (Number(f(r)['Monthly fee']) || 0), 0);
const rate = Number(S.usd_to_gbp) || 0.79;
const aiMonthGbp = (Number(S.ai_spend_usd) || 0) * rate;
const fixed = Number(S.keystone_fixed_costs_gbp) || 0;
const target = Number(S.keystone_profit_target_gbp) || 1000000;
const annualProfit = Math.round((mrr - aiMonthGbp - fixed) * 12);
const weekAgo = Date.now() - 7 * 864e5, dayAgo = Date.now() - 864e5;
const P7 = D.prospects.filter((r) => Date.parse(f(r)['Found on']) >= weekAgo);
const stats = {
  mode: weekly ? 'weekly scorecard' : 'daily brief', date: now.toISOString().slice(0, 10),
  money: { monthly_recurring_fees_gbp: mrr, ai_cost_this_month_gbp: Math.round(aiMonthGbp * 100) / 100, fixed_costs_per_month_gbp: fixed || 'not set (Keystone Settings > keystone_fixed_costs_gbp)', annual_profit_run_rate_gbp: annualProfit, profit_goal_gbp: target, progress_pct: Math.max(0, Math.round(annualProfit / target * 1000) / 10) },
  clients: { active_real_clients: activeClients, demo_clients_running: D.clients.length - realActive.length, won_clients: D.wonClients.map((r) => f(r).Company + (f(r)['Client health'] ? ' (' + sel(f(r)['Client health']) + ')' : '')) },
  pipeline: { new_prospects_7d: P7.length, high_potential_7d: P7.filter((r) => sel(f(r).Potential) === 'High potential').length,
    emails_awaiting_approval: D.prospects.filter((r) => sel(f(r)['Email approval']) === 'Pending approval').map((r) => f(r).Company),
    calls_booked: D.prospects.filter((r) => sel(f(r).Status) === 'Discovery call booked').map((r) => f(r).Company),
    proposals_sent: D.prospects.filter((r) => sel(f(r).Status) === 'Proposal sent').map((r) => f(r).Company),
    follow_ups_due: D.prospects.filter((r) => f(r)['Next step date'] && Date.parse(f(r)['Next step date']) <= Date.now()).map((r) => f(r).Company + ': ' + (f(r)['Next step'] || '')).slice(0, 10) },
  approvals_waiting: D.approvals.map((r) => '#' + f(r).Code + ' ' + (f(r).Summary || sel(f(r).Type)) + ' (since ' + String(f(r).Created || '').slice(0, 10) + ')'),
  open_review_items: D.reviews.length,
  audits: D.audits.slice(0, 5).map((r) => f(r)['Business name'] + ': ' + sel(f(r).Status)),
  agents: T.TEAM.map((a) => ({ agent: a.name, status: (rows[a.slug] || {}).status || 'missing', done_this_week: T.readCounters((rows[a.slug] || {}).counters).weekN, errors_7d: D.log.filter((x) => f(x).Agent === a.slug && sel(f(x).Kind) === 'Error').length })),
  agent_errors_24h: D.log.filter((x) => sel(f(x).Kind) === 'Error' && Date.parse(f(x).Timestamp) >= dayAgo).map((x) => f(x).Agent + ': ' + f(x).Summary).slice(0, 8),
  ai_budget: { spent_usd: Number(S.ai_spend_usd) || 0, credit_usd: Number(S.ai_monthly_credit_usd) || 0, status: S.ai_status || 'ok' },
};
const reached = T.thresholdsReached(rows, activeClients).map((a) => ({ slug: a.slug, name: a.name, threshold: a.threshold, rowId: rows[a.slug].id }));
const task = weekly ? 'chief_scorecard' : 'chief_brief';
return [{ task, req: A.buildClaudeRequest({ task, system: weekly ? P.SCORECARD_SYSTEM : P.CHIEF_SYSTEM, prompt: P.chiefPrompt(stats), schema: weekly ? P.SCORECARD_SCHEMA : P.CHIEF_SCHEMA, effort: 'low', maxTokens: 4000 }),
  ctx: { weekly, stats, reached, activeClients, to: (S.alert_email || Lg.OPS_EMAIL).split(',').map((s) => s.trim()).filter(Boolean), from: S.email_from || R.EMAIL_FROM, test: !!input.test } }];`,
  handle: `
const st = ctx.stats;
const ai = parsed && parsed.ok ? parsed.data : null;
const money = '£' + st.money.monthly_recurring_fees_gbp + '/month in fees; profit run-rate £' + st.money.annual_profit_run_rate_gbp.toLocaleString('en-GB') + ' a year = ' + st.money.progress_pct + '% of the £' + st.money.profit_goal_gbp.toLocaleString('en-GB') + ' goal';
const agentLines = st.agents.map((a) => a.agent + ': ' + a.status + (a.status === 'Live' ? ', ' + a.done_this_week + ' done this week' + (a.errors_7d ? ', ' + a.errors_7d + ' error(s)' : '') : ''));
let title, sections;
if (ctx.weekly) {
  title = 'Weekly scorecard: ' + (ai ? ai.headline : money);
  sections = [ { heading: 'Towards £1M profit', items: [money, ai ? ai.profit_note : ''].filter(Boolean) },
    { heading: 'Wins', items: ai ? ai.wins : [] }, { heading: 'Misses', items: ai ? ai.misses : [] },
    { heading: 'Focus next week', items: ai ? ai.focus_next_week : [] }, { heading: 'Agent team', items: agentLines },
    { heading: 'Pipeline (7 days)', items: [st.pipeline.new_prospects_7d + ' new prospects, ' + st.pipeline.high_potential_7d + ' high potential', 'Calls booked: ' + (st.pipeline.calls_booked.join(', ') || 'none'), 'Proposals out: ' + (st.pipeline.proposals_sent.join(', ') || 'none')] } ];
} else {
  title = 'Daily brief: ' + (ai ? ai.headline : 'your day');
  sections = [ { heading: 'Do these 3 things today', items: ai ? ai.top3 : ['Clear the approvals below', 'Review new high-potential prospects', 'Check any agent errors'] },
    { heading: 'Waiting for your approval', items: st.approvals_waiting.concat(st.pipeline.emails_awaiting_approval.map((c) => 'Email to ' + c)) },
    { heading: 'Follow-ups due', items: st.pipeline.follow_ups_due },
    { heading: 'Money', items: [money, 'AI spend this month: $' + st.ai_budget.spent_usd + ' of $' + st.ai_budget.credit_usd + ' (' + st.ai_budget.status + ')'] },
    { heading: 'Agent team', items: (ai && ai.agents_note ? [ai.agents_note] : []).concat(st.agent_errors_24h.map((e) => 'Error: ' + e)) },
    { heading: 'Risks', items: ai ? ai.risks : [] } ];
}
if (!ai) sections.push({ heading: 'Note', items: ['AI summary unavailable this time (' + (parsed ? parsed.error : 'no AI') + '); these are the raw numbers.'] });
const W = [R.write.email(R.email({ from: ctx.from, to: ctx.to, subject: '[Keystone] ' + title, html: T.briefHtml(title, sections, 'Keystone Chief of Staff · numbers from Airtable, profit excludes costs you have not entered'), text: T.briefText(title, sections) }))];
const notices = ctx.reached.map((a) => ({ kind: 'info', text: 'Threshold reached: you now have ' + ctx.activeClients + ' active clients, so the ' + a.name + ' agent can be switched on (threshold ' + a.threshold + '). YES switches it on now; NO leaves it off.',
  approval: { type: 'agent_switch_on', ref: a.slug, summary: 'Switch on the ' + a.name + ' agent', action: { webhook: '${BASE}/ks-switch-agent', body: { slug: a.slug } } } }));
if (ctx.reached.length && !ctx.test) W.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.agents, ctx.reached.map((a) => ({ id: a.rowId, fields: { 'Threshold alert sent': true } })))));
return { writes: W, notices, done: 1, summary: (ctx.weekly ? 'Weekly scorecard' : 'Daily brief') + ' sent' + (ctx.reached.length ? '; threshold reached for ' + ctx.reached.map((a) => a.name).join(', ') : ''),
  log: ctx.reached.map((a) => ({ kind: 'Threshold', summary: a.name + ' threshold reached (' + ctx.activeClients + ' active clients): asked Bilal to switch on', ref: a.slug })) };`,
});
