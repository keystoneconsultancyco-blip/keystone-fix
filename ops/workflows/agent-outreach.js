'use strict';
// KS Agent - Outreach. Drafts only: Bilal approves every send.
//  draft (daily 08:20, and when Lead Researcher finds high-potential leads): Haiku writes a personal email for each
//    High potential prospect with a published email -> Prospects (Pending approval) + YES/NO approval to Bilal.
//  send (Bilal says YES, or sets "Approved - send" in Airtable): emails it via Resend once the domain is verified;
//    until then it is held as "Approved - send" and released automatically when the domain verifies.
const { makeAgent, BASE } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Outreach',
  slug: 'outreach',
  crons: [{ label: 'Daily 08:20', cron: '20 8 * * *' }],
  libs: ['agentprompts', 'audit'],
  nothingToDo: 'No prospects need an email draft or a send.',
  reads: `
if (input.stage === 'send') return [['prospect', list('prospects', { formula: 'RECORD_ID() = ' + Lg.formulaString(input.prospectId || 'none'), maxRecords: 1 })]];
return [
  ['toDraft', list('prospects', { formula: "AND({Potential} = 'High potential', {Email} != '', {Sent on} = '', OR({Email approval} = '', {Email approval} = 'Edit requested'), OR({Status} = 'New - review', {Status} = ''))", maxRecords: Number(input.max) || 8, sort: [{ field: 'Fit score', direction: 'desc' }] })],
  ['toSend', list('prospects', { formula: "AND({Email approval} = 'Approved - send', {Sent on} = '', {Email} != '')", maxRecords: 20 })],
  ['agentSettings', list('agentSettings', { maxRecords: 50 })],
];`,
  plan: `
const P = KS.agentprompts;
const verified = S.domain_status === 'Verified' && S.email_from && !/@resend\\.dev/i.test(S.email_from);
const from = S.email_from;
const sendJob = (rec) => ({ ctx: { stage: 'send', id: rec.id, company: rec.fields.Company, email: rec.fields.Email, subject: rec.fields['Email subject'], body: rec.fields['Email draft'], verified, from, isTest: /\\[TEST\\]/.test(rec.fields['Your notes'] || '') } });
if (input.stage === 'send') {
  const rec = D.prospect[0];
  if (!rec) return [{ ctx: { stage: 'missing', id: input.prospectId } }];
  return [sendJob(rec)];
}
// Released or Airtable-approved emails go first (no AI); drafts are the next run's job.
if (D.toSend.length && (verified || input.release)) return D.toSend.map(sendJob);
const rules = (D.agentSettings.find((r) => /outreach rules/i.test(r.fields.Setting || '')) || { fields: {} }).fields.Value || '';
return D.toDraft.filter((r) => KS.audit.halalScreen(r.fields.Industry, r.fields['What they do'], r.fields.Company).pass).map((r) => ({
  task: 'outreach_draft',
  req: A.buildClaudeRequest({ task: 'outreach_draft', system: P.OUTREACH_SYSTEM, prompt: P.outreachPrompt(r.fields, rules), schema: P.OUTREACH_SCHEMA, effort: 'low', maxTokens: 4000 }),
  ctx: { stage: 'draft', id: r.id, company: r.fields.Company, email: r.fields.Email, decisionMaker: r.fields['Decision-maker'] || '' },
}));`,
  handle: `
if (ctx.stage === 'missing') return { error: 'Prospect ' + ctx.id + ' not found' };
if (ctx.stage === 'draft') {
  if (!parsed.ok) return { error: ctx.company + ': draft failed (' + parsed.error + ')' };
  const d = parsed.data;
  const flags = (d.risk_flags || []).filter(Boolean);
  const W = [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: ctx.id, fields: { 'Email subject': d.subject, 'Email draft': d.body, 'Email approval': 'Pending approval', 'Edit notes': '', 'Next step': 'Bilal: approve email (YES/NO link or set Email approval)', ...(flags.length ? { 'Your notes': 'Outreach agent flags: ' + flags.join('; ') } : {}) } }]))];
  const notice = { kind: 'info', text: 'Outreach draft for ' + ctx.company + ' (' + ctx.email + ')' + (flags.length ? '\\nFlags: ' + flags.join('; ') : '') + '\\n\\nSubject: ' + d.subject + '\\n\\n' + d.body + '\\n\\nYES sends it (once your email domain is verified). NO leaves it unsent. To change it, set Email approval to "Edit requested" in Airtable with your notes.',
    approval: { type: 'outreach_send', ref: ctx.company, summary: 'Send outreach email to ' + ctx.company, action: { webhook: '${BASE}/ks-agent-outreach', body: { stage: 'send', prospectId: ctx.id } } } };
  return { writes: W, notices: [notice], done: 1, log: [{ kind: 'Awaiting approval', summary: 'Email to ' + ctx.company + ' ready for approval', ref: ctx.id }] };
}
// ---- send ----
if (!ctx.email || !ctx.body) return { error: ctx.company + ': no email address or draft' };
if (!ctx.verified) {
  return { writes: [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: ctx.id, fields: { 'Email approval': 'Approved - send', 'Next step': 'Approved: sends automatically once your email domain is verified' } }]))],
    result: { message: 'Approved. It will be sent automatically as soon as your email domain is verified.' }, log: [{ kind: 'Run', summary: 'Approved email to ' + ctx.company + ' held until the domain is verified', ref: ctx.id }] };
}
// Test prospects only ever go to Bilal's own inbox.
const to = ctx.isTest ? [Rg.TEST_INBOX] : [ctx.email];
const dueDate = Tm.addDaysStr(new Date().toISOString().slice(0, 10), 7);
return { writes: [
  R.write.email(R.email({ from: ctx.from, to, subject: ctx.subject, text: ctx.body, html: '<div style="font-family:Arial,sans-serif;white-space:pre-wrap">' + Lg.escapeHtml(ctx.body) + '</div>', replyTo: (ctx.from.match(/<([^>]+)>/) || [])[1] })),
  R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: ctx.id, fields: { 'Email approval': 'Sent', 'Sent on': new Date().toISOString().slice(0, 10), 'Status': 'Contacted', 'Next step': 'Follow up if no reply', 'Next step date': dueDate } }])),
], done: 0, log: [{ kind: 'Completed', summary: 'Sent approved email to ' + ctx.company, items: 0, ref: ctx.id }], result: { message: 'Sent to ' + ctx.company + '.' } };`,
});
