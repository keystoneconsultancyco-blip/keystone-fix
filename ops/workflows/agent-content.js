'use strict';
// KS Agent - Content (OFF until 20 active clients). Wednesday 11:10: drafts one LinkedIn post from anonymised
// results. Nothing is posted: Bilal approves and posts it himself.
const { makeAgent, BASE } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Content',
  slug: 'content',
  inactive: true,
  crons: [{ label: 'Wednesday 11:10', cron: '10 11 * * 3' }],
  libs: ['agentprompts'],
  reads: `
if (input.stage === 'approved') return [];
return [['activity', list('agentLog', { formula: "IS_AFTER({Timestamp}, DATEADD(NOW(), -30, 'days'))", fields: ['Service', 'Event', 'Outcome', 'Minutes saved'], maxRecords: 100 })],
  ['ideas', list('growthIdeas', { fields: ['Idea', 'Summary'], maxRecords: 10, sort: [{ field: 'Found on', direction: 'desc' }] })]];`,
  plan: `
const P = KS.agentprompts;
if (input.stage === 'approved') return [{ ctx: { stage: 'approved', title: input.title } }];
const a = D.activity.map((r) => r.fields);
const results = { period: 'last 30 days', actions_by_keystone: a.length, hours_saved: Math.round(a.reduce((s, x) => s + (Number(x['Minutes saved']) || 0), 0) / 60),
  by_service: a.reduce((m, x) => { const k = (x.Service && x.Service.name) || x.Service || 'other'; m[k] = (m[k] || 0) + 1; return m; }, {}), note: 'Anonymised totals only. No client names.' };
return [{ task: 'content_draft', req: A.buildClaudeRequest({ task: 'content_draft', system: P.CONTENT_SYSTEM, prompt: 'RESULTS\\n' + JSON.stringify(results, null, 1) + '\\nRecent ideas: ' + D.ideas.map((r) => r.fields.Idea).join('; '), schema: P.CONTENT_SCHEMA, effort: 'low', maxTokens: 3000 }), ctx: { stage: 'draft' } }];`,
  handle: `
if (ctx.stage === 'approved') return { log: [{ kind: 'Completed', summary: 'Post approved by Bilal: ' + ctx.title, items: 0 }], result: { message: 'Approved. Copy it from the email and post it on LinkedIn.' } };
if (!parsed.ok) return { error: 'content draft failed (' + parsed.error + ')' };
const d = parsed.data;
return { done: 1, notices: [{ kind: 'info', text: 'Draft ' + d.format + ': ' + d.title + '\\n\\n' + d.body + '\\n\\nAnonymised check: ' + d.anonymised_check,
  approval: { type: 'content_post', ref: d.title, summary: 'Approve post: ' + d.title, action: { webhook: '${BASE}/ks-agent-content', body: { stage: 'approved', title: d.title } } } }],
  log: [{ kind: 'Awaiting approval', summary: 'Post draft: ' + d.title }] };`,
});
