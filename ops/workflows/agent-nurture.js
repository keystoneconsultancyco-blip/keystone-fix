'use strict';
// KS Agent - Nurture (daily 10:20, no AI). Consented website leads get emails written in Airtable > Nurture Templates:
//  - 4 "Sequence" emails over about 3 weeks, then 1 "Monthly" email every 30 days (rotating tips + the audit offer)
//    until they book, reply, unsubscribe, become a client, or 12 months pass (lib/nurture.js has the rules);
//  - only templates Bilal has ticked Approved, only once the email domain is verified, only leads with Marketing consent;
//  - every email: personalised (name, company, revenue band), sourced loss figures, one tracked "Book my audit" button,
//    an open pixel and an unsubscribe link. Each email is a row in Nurture Sends (opens, clicks, booked), and each
//    template keeps totals (Sent / Opened / Clicked / Bookings) that the Jarvis Nurture page shows.
//  - stops are checked first on every run; a booking is credited to the last email the lead got.
// Preview: run now with { preview: true, prospectId } sends every template (approved or not) to Bilal's inbox only,
// marked Test, without changing the lead or the template totals.
const { makeAgent, BASE } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Nurture',
  slug: 'nurture',
  libs: ['nurture', 'calc'],
  crons: [{ label: 'Daily 10:20', cron: '20 10 * * *' }],
  nothingToDo: 'No nurture emails due (or waiting for approved templates / a verified email domain).',
  reads: `return [
  ['leads', list('prospects', { formula: "AND({Source} = 'Website', OR({Nurture status} = BLANK(), {Nurture status} = 'Active'))", maxRecords: 100 })],
  ['templates', list('nurtureTemplates', { maxRecords: 50 })],
  ['audits', list('auditIntakes', { formula: "IS_SAME({Created}, NOW(), 'month')", fields: ['Created'], maxRecords: 100 })],
];`,
  plan: `
const Nu = KS.nurture;
const verified = S.domain_status === 'Verified' && S.email_from && !/@resend\\.dev/i.test(S.email_from);
const all = D.templates.map((r) => ({ id: r.id, ...r.fields, Kind: (r.fields.Kind && r.fields.Kind.name) || r.fields.Kind || 'Sequence' }));
const approved = all.filter((t) => t.Approved);
const t = Date.now();
const shared = { from: S.email_from || R.EMAIL_FROM, replyTo: (S.alert_email || Lg.OPS_EMAIL).split(',')[0].trim(), slots: Nu.slotsLine(S.audit_slots_per_month, D.audits.length, t),
  proof: Nu.proofBlock(S.nurture_social_proof, S.nurture_social_proof_by) };
const leadCtx = (r) => { const f = r.fields; const band = Nu.BAND_FROM_FIELD[(f['Revenue band'] && f['Revenue band'].name) || f['Revenue band']] || '';
  return { id: r.id, email: f.Email, first: String(f['Contact name'] || '').trim().split(' ')[0] || 'there', company: f.Company || 'your business', band,
    offer: (f['Audit offer'] && f['Audit offer'].name) || f['Audit offer'] || '£100', token: f['Unsubscribe token'] || '', test: /\\[TEST\\]/.test(f['Your notes'] || '') }; };
const tplCtx = (x) => ({ id: x.id, name: x.Name, subject: x.Subject, body: x.Body });
const jobs = [];
if (input.preview) {
  const r = D.leads.find((x) => x.id === input.prospectId);
  if (!r) return [{ ctx: { kind: 'error', error: 'Preview: lead ' + input.prospectId + ' not found (must be a Website lead still on nurture).' } }];
  const order = all.slice().sort((a, b) => (a.Kind === b.Kind ? a.Step - b.Step : a.Kind === 'Sequence' ? -1 : 1));
  for (const x of order) jobs.push({ ctx: { kind: 'send', preview: true, lead: { ...leadCtx(r), test: true }, tpl: tplCtx(x), step: Number(x.Step), ...shared } });
  return jobs;
}
for (const r of D.leads) {
  const f = r.fields;
  const stop = Nu.stopReason(f);
  if (stop) { jobs.push({ ctx: { kind: 'stop', id: r.id, company: f.Company || r.id, reason: stop, lastSend: f['Nurture last send'] || '', lastTpl: f['Nurture last template'] || '', test: /\\[TEST\\]/.test(f['Your notes'] || '') } }); continue; }
  if (!verified && !input.testInbox) continue;
  const lead = { step: Number(f['Nurture step']) || 0, signedUp: Date.parse(f['Signed up at'] || r.createdTime), lastSent: f['Nurture last sent'] ? Date.parse(f['Nurture last sent']) : 0 };
  const nx = Nu.nextTemplate(approved, lead, t);
  if (!nx) continue;
  if (nx.finished) { jobs.push({ ctx: { kind: 'stop', id: r.id, company: f.Company || r.id, reason: 'Finished (12 months)' } }); continue; }
  jobs.push({ ctx: { kind: 'send', lead: leadCtx(r), tpl: tplCtx(nx.template), step: nx.step, testInbox: !!input.testInbox, ...shared } });
}
return jobs;`,
  handle: `
const Nu = KS.nurture, C = KS.calc;
if (ctx.kind === 'error') return { error: ctx.error };
const P = AIRTABLE.tables.prospects;
if (ctx.kind === 'stop') {
  const writes = [R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, P, [{ id: ctx.id, fields: { 'Nurture status': ctx.reason } }]))];
  let booked = 0;
  if (ctx.reason === 'Stopped - booked' && ctx.lastSend) {
    // Credit the booking to the last email this lead got (upsert on Send ID).
    writes.push(R.write.airtable({ method: 'PATCH', url: 'https://api.airtable.com/v0/' + AIRTABLE.baseId + '/' + AIRTABLE.tables.nurtureSends, body: { performUpsert: { fieldsToMergeOn: ['Send ID'] }, records: [{ fields: { 'Send ID': ctx.lastSend, 'Booked': true } }] } }));
    booked = ctx.test ? 0 : 1;
  }
  return { writes, result: { tplId: booked ? ctx.lastTpl : '', bookings: booked }, summary: 'Nurture stopped for ' + ctx.company + ' (' + ctx.reason + ')' };
}
const L = ctx.lead;
if (!L.token) return { error: 'Lead ' + L.id + ' has no unsubscribe token; not emailed' };
const test = !!(ctx.preview || L.test || ctx.testInbox);
const sendId = C.randomId(24);
const track = 's=' + sendId + '&t=' + encodeURIComponent(ctx.tpl.id);
const vars = { first_name: L.first, company: L.company, revenue_band: Nu.BAND_LABEL[L.band] || 'your size', loss_line: Nu.lossLine(L.band), audit_line: Nu.auditLine(L.offer), slots_line: ctx.slots };
const mail = Nu.emailParts({ subject: ctx.tpl.subject, body: ctx.tpl.body, vars, proof: ctx.proof,
  ctaUrl: '${BASE}/ks-nurture-click?' + track, pixelUrl: '${BASE}/ks-nurture-open?' + track,
  unsubUrl: '${BASE}/ks-unsubscribe?p=' + encodeURIComponent(L.id) + '&t=' + encodeURIComponent(L.token) });
const nowIso = new Date().toISOString();
const writes = [
  R.write.email(R.email({ from: ctx.from, to: [test ? Rg.TEST_INBOX : L.email], subject: (ctx.preview ? '[PREVIEW ' + ctx.tpl.name + '] ' : '') + mail.subject, text: mail.text, html: mail.html, replyTo: ctx.replyTo })),
  R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.nurtureSends, [{ 'Send ID': sendId, 'Lead ID': L.id, 'Company': L.company, 'Email': L.email, 'Template': ctx.tpl.name, 'Step': ctx.step, 'Sent at': nowIso, 'Opens': 0, 'Clicks': 0, 'Test': test, 'Template ID': ctx.tpl.id }])),
];
if (!ctx.preview) writes.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, P, [{ id: L.id, fields: { 'Nurture step': ctx.step, 'Nurture last sent': nowIso, 'Nurture status': 'Active', 'Nurture last send': sendId, 'Nurture last template': ctx.tpl.id } }])));
return { done: 1, writes, result: { tplId: test ? '' : ctx.tpl.id, sent: test ? 0 : 1 }, summary: (ctx.preview ? 'Preview "' + ctx.tpl.name + '" sent to Bilal' : 'Nurture email ' + ctx.step + ' (' + ctx.tpl.name + ') sent to ' + L.company) };`,
  // Template totals: add this run's sends and bookings to Nurture Templates (Sent / Bookings).
  finish: `
const plan = $('Plan reads').all();
const idx = plan.findIndex((p) => p.json.key === 'templates');
const tpls = idx >= 0 ? ((($('Read Airtable').all()[idx].json.body) || {}).records || []) : [];
const add = {};
for (const r of results) { const x = r.result; if (!x || !x.tplId) continue; const a = add[x.tplId] = add[x.tplId] || { Sent: 0, Bookings: 0 }; a.Sent += x.sent || 0; a.Bookings += x.bookings || 0; }
const upd = Object.entries(add).map(([id, a]) => { const f = (tpls.find((t) => t.id === id) || { fields: {} }).fields; const out = {};
  if (a.Sent) out.Sent = (Number(f.Sent) || 0) + a.Sent; if (a.Bookings) out.Bookings = (Number(f.Bookings) || 0) + a.Bookings; return { id, fields: out }; }).filter((u) => Object.keys(u.fields).length);
const writes = [];
for (let i = 0; i < upd.length; i += 10) writes.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.nurtureTemplates, upd.slice(i, i + 10))));
return { writes };`,
});
