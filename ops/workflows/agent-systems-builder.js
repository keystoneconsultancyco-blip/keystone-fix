'use strict';
// KS Agent - Systems Builder (OFF until 20 active clients). Friday 15:10: reads the week's failures, review items
// and agent errors and proposes the improvements that would save the most time (Haiku). Proposals only.
const { makeAgent } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Systems Builder',
  slug: 'systems-builder',
  inactive: true,
  crons: [{ label: 'Friday 15:10', cron: '10 15 * * 5' }],
  libs: ['agentprompts'],
  reads: `return [
  ['problems', list('agentLog', { formula: "AND(IS_AFTER({Timestamp}, DATEADD(NOW(), -7, 'days')), OR({Outcome} = 'Failed', {Outcome} = 'Escalated', {Outcome} = 'Needs review'))", fields: ['Workflow', 'Event', 'Summary', 'Outcome'], maxRecords: 100 })],
  ['reviews', list('needsReview', { formula: "IS_AFTER({Created}, DATEADD(NOW(), -7, 'days'))", fields: ['Title', 'Problem', 'Service'], maxRecords: 50 })],
  ['agentErrors', list('teamLog', { formula: "AND({Kind} = 'Error', IS_AFTER({Timestamp}, DATEADD(NOW(), -7, 'days')))", fields: ['Agent', 'Summary'], maxRecords: 50 })],
];`,
  plan: `
const P = KS.agentprompts;
const week = { workflow_problems: D.problems.map((r) => r.fields), review_items: D.reviews.map((r) => r.fields), agent_errors: D.agentErrors.map((r) => r.fields) };
if (!week.workflow_problems.length && !week.review_items.length && !week.agent_errors.length) return [{ ctx: { quiet: true } }];
return [{ task: 'systems_review', req: A.buildClaudeRequest({ task: 'systems_review', system: P.SYSTEMS_SYSTEM, prompt: 'THIS WEEK\\n' + JSON.stringify(week, null, 1).slice(0, 60000), schema: P.SYSTEMS_SCHEMA, effort: 'medium', maxTokens: 5000 }), ctx: {} }];`,
  handle: `
if (ctx.quiet) return { done: 0, summary: 'Quiet week: no failures or review items to learn from.' };
if (!parsed.ok) return { error: 'systems review failed (' + parsed.error + ')' };
const d = parsed.data;
const items = (d.proposals || []).map((p) => p.title + ' (' + p.effort + ' effort, ~' + p.time_saved_per_month_hours + 'h/month): ' + p.problem + ' -> ' + p.fix);
return { done: items.length, notices: [{ kind: 'info', text: 'Systems Builder: ' + d.summary + '\\n\\n- ' + items.join('\\n- ') + '\\n\\nTell me which to build.' }], log: items.map((x) => ({ kind: 'Completed', summary: x.slice(0, 240), items: 0 })) };`,
});
