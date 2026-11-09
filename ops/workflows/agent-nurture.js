'use strict';
// KS Agent - Nurture (daily 10:20, no AI). Consented website leads get 4 emails over 3 weeks from the templates in
// Airtable > Nurture Templates (value, case-style example, audit offer, last check-in). Rules:
//  - only templates Bilal has ticked Approved; only once the email domain is verified; only Source = Website with
//    Marketing consent ticked; stops as soon as the lead books a call, wins, is lost or unsubscribes;
//  - one email per lead per run, at least 3 days apart; every email has an unsubscribe link (PECR).
const { makeAgent, BASE } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Nurture',
  slug: 'nurture',
  crons: [{ label: 'Daily 10:20', cron: '20 10 * * *' }],
  nothingToDo: 'No nurture emails due (or waiting for approved templates / a verified email domain).',
  reads: `return [
  ['leads', list('prospects', { formula: "AND({Source} = 'Website', {Marketing consent}, OR({Nurture step} = BLANK(), {Nurture step} < 4), OR({Status} = 'New - review', {Status} = 'Contacted', {Status} = ''))", maxRecords: 50 })],
  ['templates', list('nurtureTemplates', { maxRecords: 20 })],
];`,
  plan: `
const verified = S.domain_status === 'Verified' && S.email_from && !/@resend\\.dev/i.test(S.email_from);
const tpl = D.templates.map((r) => r.fields).filter((f) => f.Approved).sort((a, b) => a.Step - b.Step);
if (!verified && !input.testInbox) return [];
const now = Date.now();
const jobs = [];
for (const r of D.leads) {
  const f = r.fields;
  const step = Number(f['Nurture step']) || 0;
  const next = tpl.find((t) => Number(t.Step) === step + 1);
  if (!next) continue;
  const start = Date.parse(f['Signed up at'] || r.createdTime);
  const last = f['Nurture last sent'] ? Date.parse(f['Nurture last sent']) : 0;
  const due = now - start >= (Number(next['Send on day']) || 0) * 864e5 && now - last >= 3 * 864e5;
  if (!due) continue;
  jobs.push({ ctx: { id: r.id, email: f.Email, first: String(f['Contact name'] || '').trim().split(' ')[0] || 'there', company: f.Company || 'your business', offer: (f['Audit offer'] && f['Audit offer'].name) || f['Audit offer'] || '£100',
    token: f['Unsubscribe token'] || '', test: /\\[TEST\\]/.test(f['Your notes'] || ''), step: step + 1, tpl: { subject: next.Subject, body: next.Body }, from: S.email_from || R.EMAIL_FROM, replyTo: (S.alert_email || Lg.OPS_EMAIL).split(',')[0].trim(), testInbox: !!input.testInbox } });
}
return jobs;`,
  handle: `
const auditLine = ctx.offer === 'Free'
  ? 'As a business that fits what we do best, your audit is free (normally £750).'
  : 'The audit is £100 (87% off the usual £750), credited against setup if you go ahead within 30 days.';
const fill = (s) => String(s || '').split('{first_name}').join(ctx.first).split('{company}').join(ctx.company).split('{audit_line}').join(auditLine);
const unsub = '${BASE}/ks-unsubscribe?p=' + encodeURIComponent(ctx.id) + '&t=' + encodeURIComponent(ctx.token);
const body = fill(ctx.tpl.body) + '\\n\\n--\\nYou are getting this because you asked for an estimate on the Keystone website and ticked to hear from us. Unsubscribe: ' + unsub + '\\nKeystone, Slough, United Kingdom';
const to = ctx.test || ctx.testInbox ? [Rg.TEST_INBOX] : [ctx.email];
if (!ctx.token) return { error: 'Lead ' + ctx.id + ' has no unsubscribe token; not emailed' };
return { done: 1, writes: [
  R.write.email(R.email({ from: ctx.from, to, subject: fill(ctx.tpl.subject), text: body, replyTo: ctx.replyTo, html: '<div style="font-family:Arial,sans-serif;max-width:600px;white-space:pre-wrap">' + Lg.escapeHtml(fill(ctx.tpl.body)) + '</div><p style="font-family:Arial,sans-serif;font-size:12px;color:#6b7280">You are getting this because you asked for an estimate on the Keystone website and ticked to hear from us. <a href="' + unsub + '">Unsubscribe</a>. Keystone, Slough, United Kingdom.</p>' })),
  R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.prospects, [{ id: ctx.id, fields: { 'Nurture step': ctx.step, 'Nurture last sent': new Date().toISOString() } }])),
], summary: 'Nurture email ' + ctx.step + ' sent to ' + ctx.company };`,
});
