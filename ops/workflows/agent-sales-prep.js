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
  libs: ['agentprompts', 'pricing', 'audit', 'leadscore'],
  nothingToDo: 'No calls to prepare, no qualifying answers to check and no approved audits waiting for a proposal.',
  reads: `
if (input.stage === 'send_proposal') return [['intake', list('auditIntakes', { formula: 'RECORD_ID() = ' + Lg.formulaString(input.intakeId || 'none'), maxRecords: 1 })]];
return [
  ['calls', list('prospects', { formula: "AND({Status} = 'Discovery call booked', {Call brief} = '')", maxRecords: 5 })],
  ['approvedAudits', list('auditIntakes', { formula: "AND({Status} = 'Approved', {Proposal draft} = '')", maxRecords: 3 })],
  ['answers', list('prospects', { formula: "AND({Qualifying answers} != '', NOT({Qualification checked}))", maxRecords: 5 })],
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
for (const r of D.answers) jobs.push({ task: 'call_brief', req: A.buildClaudeRequest({ task: 'call_brief', system: P.QUALIFY_SYSTEM, prompt: 'LEAD VALUE NOW: ' + ((r.fields['Lead value'] && r.fields['Lead value'].name) || r.fields['Lead value'] || 'Standard') + '\\nBILAL\\'S NOTES FROM THE QUALIFYING CALL:\\n' + r.fields['Qualifying answers'], schema: P.QUALIFY_SCHEMA, effort: 'low', maxTokens: 3000 }),
  ctx: { stage: 'qualify', id: r.id, company: r.fields.Company, leadValue: (r.fields['Lead value'] && r.fields['Lead value'].name) || r.fields['Lead value'] || 'Standard', why: r.fields.Why || '' } });
for (const r of D.approvedAudits) {
  if (!KS.audit.halalScreen(r.fields.Industry, r.fields['What the business sells'], r.fields['Business name']).pass) continue;
  let dx = {}; try { dx = JSON.parse(r.fields['Findings JSON'] || '{}'); } catch (e) { dx = {}; }
  const services = (dx.recommendedServices || []).filter((s) => KS.pricing.SERVICES.includes(s));
  const pilot = String(S.pilot_offer_available || '').toLowerCase() === 'yes';
  const bandField = (r.fields['Revenue band'] && r.fields['Revenue band'].name) || r.fields['Revenue band'] || '';
  const priced = KS.pricing.priceProposal(services.length ? services : ['invoicing'], { revenue: KS.leadscore.FIELD_TO_BAND[bandField] || bandField, monthlyLoss: (Number(dx.totalAnnualCost) || 0) / 12, pilot });
  if (pilot) priced.pilotTerms = KS.pricing.PRICING.pilot.note + ' Minimum term 3 months.';
  jobs.push({ task: 'proposal', req: A.buildClaudeRequest({ task: 'proposal', system: P.PROPOSAL_SYSTEM, prompt: P.proposalPrompt(r.fields, priced), schema: P.PROPOSAL_SCHEMA, effort: 'high', maxTokens: 16000 }), ctx: { stage: 'proposal', id: r.id, business: r.fields['Business name'], email: r.fields['Contact email'], priced } });
}
return jobs;`,
  handle: `
if (ctx.stage === 'brief') {
  if (!parsed.ok) return { error: ctx.company + ': call brief failed (' + parsed.error + ')' };
  const d = parsed.data;
  const text = d.brief + '\\n\\nDISCOVERY QUESTIONS\\n' + (d.questions || []).map((q, i) => (i + 1) + '. ' + q).join('\\n') + '\\n\\nOBJECTIONS\\n' + (d.likely_objections || []).map((o) => '- ' + o.objection + ' -> ' + o.answer).join('\\n') + '\\n\\nNEXT STEP\\n' + d.next_step;
  return { writes: [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: ctx.id, fields: { 'Call brief': text, 'Qualifying script': d.qualifying_script, 'Next step': 'Bilal: run the 10-minute qualifying call, then type the answers into Qualifying answers' } }]))],
    notices: [{ kind: 'info', text: 'Call brief and 10-minute qualifying script ready for ' + ctx.company + '.\\n\\nQUALIFYING SCRIPT\\n' + String(d.qualifying_script || '').slice(0, 2500) + '\\n\\nAfter the call, type the answers into Airtable > Prospects > Qualifying answers.' }], done: 1, log: [{ kind: 'Completed', summary: 'Call brief: ' + ctx.company, items: 0, ref: ctx.id }] };
}
if (ctx.stage === 'qualify') {
  if (!parsed.ok) return { error: ctx.company + ': qualifying check failed (' + parsed.error + ')' };
  const d = parsed.data;
  const downgrade = ctx.leadValue === 'High' && !d.still_high_value;
  const fields = { 'Qualification checked': true, 'Why': (ctx.why ? ctx.why + '\\n' : '') + 'Qualifying call: ' + d.summary + (d.contradictions.length ? ' Contradictions: ' + d.contradictions.join('; ') : ''),
    ...(downgrade ? { 'Lead value': 'Standard', 'Audit offer': '£100' } : {}), ...(KS.leadscore.BAND_TO_FIELD[d.revenue_band] ? { 'Revenue band': KS.leadscore.BAND_TO_FIELD[d.revenue_band] } : {}) };
  return { writes: [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: ctx.id, fields }]))], done: 1,
    notices: downgrade ? [{ kind: 'info', text: ctx.company + ' downgraded from High value to the £100 audit offer after the qualifying call: ' + d.contradictions.join('; ') + '. Change it back in Airtable if you disagree.' }] : [],
    summary: ctx.company + ': qualifying answers checked' + (downgrade ? ' (downgraded to £100 audit)' : ''), log: [{ kind: 'Completed', summary: 'Qualifying answers checked: ' + ctx.company + (downgrade ? ' – downgraded to £100 audit' : ''), items: 0, ref: ctx.id }] };
}
if (ctx.stage === 'proposal') {
  if (!parsed.ok) return { error: ctx.business + ': proposal failed (' + parsed.error + ')' };
  const d = parsed.data, p = ctx.priced;
  const sc = p.senseCheck;
  const check = sc.ok === false ? 'SENSE CHECK FAILED: the monthly fee £' + sc.monthlyFee + ' is above one-third of the monthly loss found (£' + sc.limit + ' of £' + sc.monthlyLoss + '). Review before sending.' : sc.ok === null ? 'Sense check: no monthly loss figure in the audit.' : 'Sense check OK: £' + sc.monthlyFee + '/month is within one-third of the £' + sc.monthlyLoss + ' monthly loss found.';
  const W = [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [{ id: ctx.id, fields: { 'Proposal draft': d.proposal_markdown, 'Proposal JSON': JSON.stringify({ title: d.title, services: p.services, package: p.package.name, monthlyFeeGbp: p.package.price, setupFeeGbp: p.setup.total, setupDiscountPct: p.setup.discountPct, pilot: p.setup.pilot, band: p.band.label, senseCheck: sc, email: d.email_to_client }), 'Status': 'Proposal for approval' } }]))];
  const text = d.title + '\\n' + p.package.name + ' £' + p.package.price + '/month (' + p.band.label + ' band) + setup £' + p.setup.total + (p.setup.discountPct ? ' (' + p.setup.discountPct + '% multi-service discount)' : '') + (p.setup.pilot ? ' incl. 50% pilot discount' : '') + '\\n' + check + (d.risks_for_bilal && d.risks_for_bilal.length ? '\\nCheck: ' + d.risks_for_bilal.join('; ') : '') + '\\n\\nEMAIL TO CLIENT\\nSubject: ' + d.email_to_client.subject + '\\n' + d.email_to_client.body + '\\n\\nFull proposal is in Airtable > Audit Intakes > Proposal draft.';
  return { writes: W, done: 1, notices: [{ kind: sc.ok === false ? 'failure' : 'info', text: 'Proposal for ' + ctx.business + ' ready for your approval.\\n\\n' + text, approval: { type: 'proposal_send', ref: ctx.business, summary: 'Send proposal to ' + ctx.business + ' (' + p.package.name + ' £' + p.package.price + '/month + £' + p.setup.total + ' setup)', action: { webhook: '${BASE}/ks-agent-sales-prep', body: { stage: 'send_proposal', intakeId: ctx.id } } } }],
    log: [{ kind: 'Awaiting approval', summary: 'Proposal for ' + ctx.business + ' (' + p.package.name + ' £' + p.package.price + '/mo + £' + p.setup.total + ' setup)' + (sc.ok === false ? ' – sense check failed' : ''), ref: ctx.id }] };
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
