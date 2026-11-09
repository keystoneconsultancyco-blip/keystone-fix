'use strict';
// KS Agent - Sales Prep (every 30 minutes).
//  1. Prospect Status = "Discovery call booked" and no Call brief -> Haiku writes the call brief (+ audit link to send after).
//  2. Audit Intake Status = "Approved" (Bilal reviewed the AI audit) and no proposal -> Opus drafts proposal + quote
//     within the pricing rules -> YES/NO approval to Bilal.
//  3. YES -> proposal emailed to the prospect (held until the email domain is verified) and statuses move on.
const { makeAgent, BASE } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Sales Prep',
  slug: 'sales-prep',
  crons: [{ label: 'Every 30 minutes', cron: '*/30 * * * *' }],
  libs: ['agentprompts', 'pricing', 'audit'],
  nothingToDo: 'No calls to prepare and no approved audits waiting for a proposal.',
  reads: `
if (input.stage === 'send_proposal') return [['intake', list('auditIntakes', { formula: 'RECORD_ID() = ' + Lg.formulaString(input.intakeId || 'none'), maxRecords: 1 })]];
return [
  ['calls', list('prospects', { formula: "AND({Status} = 'Discovery call booked', {Call brief} = '')", maxRecords: 5 })],
  ['approvedAudits', list('auditIntakes', { formula: "AND({Status} = 'Approved', {Proposal draft} = '')", maxRecords: 3 })],
];`,
  plan: `
const P = KS.agentprompts;
const verified = S.domain_status === 'Verified' && S.email_from && !/@resend\\.dev/i.test(S.email_from);
if (input.stage === 'send_proposal') {
  const rec = D.intake[0];
  return [{ ctx: { stage: 'send', rec: rec ? { id: rec.id, f: rec.fields } : null, verified, from: S.email_from } }];
}
const jobs = [];
for (const r of D.calls) jobs.push({ task: 'call_brief', req: A.buildClaudeRequest({ task: 'call_brief', system: P.BRIEF_SYSTEM, prompt: P.briefPrompt(r.fields, '${BASE}/ks-audit-form'), schema: P.BRIEF_SCHEMA, effort: 'low', maxTokens: 5000 }), ctx: { stage: 'brief', id: r.id, company: r.fields.Company } });
const rules = { audit: KS.pricing.PRICING.audit, setup: KS.pricing.PRICING.setup, monthly: KS.pricing.PRICING.monthly, tiers: KS.pricing.PRICING.tiers, multiServiceSetupDiscount: KS.pricing.PRICING.multiServiceSetupDiscount, note: 'Prices adjust with revenue and volume like the website calculator: setup x0.8-1.6, monthly tier x0.9-1.5. First pilot client: audit fee waived and 50% off setup in exchange for a case study.' };
for (const r of D.approvedAudits) {
  if (!KS.audit.halalScreen(r.fields.Industry, r.fields['What the business sells'], r.fields['Business name']).pass) continue;
  jobs.push({ task: 'proposal', req: A.buildClaudeRequest({ task: 'proposal', system: P.PROPOSAL_SYSTEM, prompt: P.proposalPrompt(r.fields, rules), schema: P.PROPOSAL_SCHEMA, effort: 'high', maxTokens: 16000 }), ctx: { stage: 'proposal', id: r.id, business: r.fields['Business name'], email: r.fields['Contact email'] } });
}
return jobs;`,
  handle: `
if (ctx.stage === 'brief') {
  if (!parsed.ok) return { error: ctx.company + ': call brief failed (' + parsed.error + ')' };
  const d = parsed.data;
  const text = d.brief + '\\n\\nDISCOVERY QUESTIONS\\n' + (d.questions || []).map((q, i) => (i + 1) + '. ' + q).join('\\n') + '\\n\\nOBJECTIONS\\n' + (d.likely_objections || []).map((o) => '- ' + o.objection + ' -> ' + o.answer).join('\\n') + '\\n\\nNEXT STEP\\n' + d.next_step;
  return { writes: [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: ctx.id, fields: { 'Call brief': text, 'Next step': 'Bilal: read the call brief before the call' } }]))],
    notices: [{ kind: 'info', text: 'Call brief ready for ' + ctx.company + ':\\n\\n' + text.slice(0, 3000) }], done: 1, log: [{ kind: 'Completed', summary: 'Call brief: ' + ctx.company, items: 0, ref: ctx.id }] };
}
if (ctx.stage === 'proposal') {
  if (!parsed.ok) return { error: ctx.business + ': proposal failed (' + parsed.error + ')' };
  const d = parsed.data;
  const W = [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [{ id: ctx.id, fields: { 'Proposal draft': d.proposal_markdown, 'Proposal JSON': JSON.stringify({ title: d.title, services: d.services, setupFeeGbp: d.setup_fee_gbp, monthlyFeeGbp: d.monthly_fee_gbp, tier: d.tier, email: d.email_to_client, reasoning: d.pricing_reasoning }), 'Status': 'Proposal for approval' } }]))];
  const text = d.title + '\\nSetup £' + d.setup_fee_gbp + ' + £' + d.monthly_fee_gbp + '/month (' + d.tier + ')\\nWhy: ' + d.pricing_reasoning + (d.risks_for_bilal && d.risks_for_bilal.length ? '\\nCheck: ' + d.risks_for_bilal.join('; ') : '') + '\\n\\nEMAIL TO CLIENT\\nSubject: ' + d.email_to_client.subject + '\\n' + d.email_to_client.body + '\\n\\nFull proposal is in Airtable > Audit Intakes > Proposal draft.';
  return { writes: W, done: 1, notices: [{ kind: 'info', text: 'Proposal for ' + ctx.business + ' ready for your approval.\\n\\n' + text, approval: { type: 'proposal_send', ref: ctx.business, summary: 'Send proposal to ' + ctx.business + ' (£' + d.setup_fee_gbp + ' setup + £' + d.monthly_fee_gbp + '/month)', action: { webhook: '${BASE}/ks-agent-sales-prep', body: { stage: 'send_proposal', intakeId: ctx.id } } } }],
    log: [{ kind: 'Awaiting approval', summary: 'Proposal for ' + ctx.business + ' (£' + d.setup_fee_gbp + ' + £' + d.monthly_fee_gbp + '/mo)', ref: ctx.id }] };
}
// ---- send proposal ----
const rec = ctx.rec;
if (!rec) return { error: 'Audit intake not found' };
const pj = (() => { try { return JSON.parse(rec.f['Proposal JSON'] || '{}'); } catch (e) { return {}; } })();
if (!pj.email || !rec.f['Contact email']) return { error: (rec.f['Business name'] || '') + ': proposal or contact email missing' };
if (!ctx.verified) return { writes: [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [{ id: rec.id, fields: { 'Status': 'Proposal approved - waiting for email domain' } }]))], result: { message: 'Approved. The proposal will be emailed as soon as your email domain is verified.' } };
const isTest = /\\[TEST\\]|^KS TEST/i.test(rec.f['Business name'] || '');
const to = isTest ? [Rg.TEST_INBOX] : [rec.f['Contact email']];
const html = '<div style="font-family:Arial,sans-serif;max-width:680px"><p style="white-space:pre-wrap">' + Lg.escapeHtml(pj.email.body) + '</p><hr><div style="white-space:pre-wrap">' + Lg.escapeHtml(rec.f['Proposal draft'] || '') + '</div></div>';
return { writes: [
  R.write.email(R.email({ from: ctx.from, to, subject: pj.email.subject, html, text: pj.email.body + '\\n\\n' + (rec.f['Proposal draft'] || ''), replyTo: (String(ctx.from).match(/<([^>]+)>/) || [])[1] })),
  R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [{ id: rec.id, fields: { 'Status': 'Proposal sent', 'Proposal sent at': new Date().toISOString() } }])),
], log: [{ kind: 'Completed', summary: 'Proposal sent to ' + rec.f['Business name'], items: 0, ref: rec.id }], result: { message: 'Proposal sent to ' + rec.f['Business name'] + '.' } };`,
});
