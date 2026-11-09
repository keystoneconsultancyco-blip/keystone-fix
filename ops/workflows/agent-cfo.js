'use strict';
// KS Agent - Keystone CFO (OFF until 5 active clients). 1st of the month: Keystone's own fees, AI and tool costs,
// profit and margin, and pricing advice (Opus: finance decisions). Recommendations only; Bilal decides.
const { makeAgent } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Keystone CFO',
  slug: 'cfo',
  inactive: true,
  crons: [{ label: '1st of month 08:10', cron: '10 8 1 * *' }],
  libs: ['agentprompts', 'pricing'],
  reads: `return [
  ['won', list('prospects', { formula: '{Make my client}', fields: ['Company', 'Monthly fee', 'Services active', 'Client since', 'Client health'], maxRecords: 100 })],
  ['audits', list('auditIntakes', { fields: ['Business name', 'Status', 'Proposal JSON', 'Created'], maxRecords: 30, sort: [{ field: 'Created', direction: 'desc' }] })],
];`,
  plan: `
const P = KS.agentprompts;
const rate = Number(S.usd_to_gbp) || 0.79;
const numbers = {
  month: now.toISOString().slice(0, 7),
  clients: D.won.map((r) => ({ company: r.fields.Company, monthly_fee_gbp: Number(r.fields['Monthly fee']) || null, services: r.fields['Services active'] || null, since: r.fields['Client since'] || null, health: (r.fields['Client health'] && r.fields['Client health'].name) || r.fields['Client health'] || null })),
  ai_cost_this_month_gbp: Math.round((Number(S.ai_spend_usd) || 0) * rate * 100) / 100, ai_credit_usd: Number(S.ai_monthly_credit_usd) || null,
  fixed_tool_costs_gbp: Number(S.keystone_fixed_costs_gbp) || 'not set',
  proposals: D.audits.filter((r) => r.fields['Proposal JSON']).map((r) => { try { const j = JSON.parse(r.fields['Proposal JSON']); return { business: r.fields['Business name'], status: (r.fields.Status && r.fields.Status.name) || r.fields.Status, setup: j.setupFeeGbp, monthly: j.monthlyFeeGbp }; } catch (e) { return null; } }).filter(Boolean),
  price_list: KS.pricing.PRICING, profit_goal_gbp: Number(S.keystone_profit_target_gbp) || 1000000,
};
return [{ task: 'cfo_review', req: A.buildClaudeRequest({ task: 'cfo_review', system: P.CFO_SYSTEM, prompt: 'NUMBERS\\n' + JSON.stringify(numbers, null, 1), schema: P.CFO_SCHEMA, effort: 'medium', maxTokens: 8000 }),
  ctx: { to: (S.alert_email || Lg.OPS_EMAIL).split(',').map((s) => s.trim()), from: S.email_from || R.EMAIL_FROM } }];`,
  handle: `
if (!parsed.ok) return { error: 'CFO review failed (' + parsed.error + ')' };
const d = parsed.data;
const sections = [{ heading: 'Profit and loss', items: [d.profit_and_loss] }, { heading: 'Margin', items: [d.margin_note] }, { heading: 'Recommendations (you decide)', items: d.recommendations }, { heading: 'Pricing', items: [d.pricing_advice] }, { heading: 'Warnings', items: d.warnings }];
return { done: 1, writes: [R.write.email(R.email({ from: ctx.from, to: ctx.to, subject: '[Keystone] CFO review: ' + d.headline, html: T.briefHtml('CFO review: ' + d.headline, sections, 'Keystone CFO agent (Claude Opus). Recommendations only.'), text: T.briefText('CFO review: ' + d.headline, sections) }))], summary: 'Monthly CFO review sent: ' + d.headline };`,
});
