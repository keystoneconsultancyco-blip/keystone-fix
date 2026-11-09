'use strict';
// KS Agent - Client Success (OFF until 5 active clients). Monday 10:10: per active client, reviews last week's
// numbers and drafts a short check-in email for Bilal to approve (YES sends it once the email domain is verified).
const { makeAgent, BASE } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Client Success',
  slug: 'client-success',
  inactive: true,
  crons: [{ label: 'Monday 10:10', cron: '10 10 * * 1' }],
  libs: ['agentprompts'],
  nothingToDo: 'No active clients to check in with.',
  reads: `
if (input.stage === 'send') return [];
return [
  ['clients', list('clients', { formula: input.clientId ? '{Client ID} = ' + Lg.formulaString(input.clientId) : "AND({Status} = 'Active', NOT({Is demo/test}))", maxRecords: 30 })],
  ['metrics', list('clientMetrics', { fields: ['Client ID', 'Week starting', 'Revenue', 'Net profit', 'Cash balance', 'Overdue count', 'Overdue value', 'Invoices drafted', 'Calls handled', 'Bookings made', 'Quotes issued'], maxRecords: 100, sort: [{ field: 'Week starting', direction: 'desc' }] })],
  ['activity', list('agentLog', { formula: "IS_AFTER({Timestamp}, DATEADD(NOW(), -7, 'days'))", fields: ['Client ID', 'Event', 'Outcome', 'Minutes saved'], maxRecords: 100 })],
];`,
  plan: `
const P = KS.agentprompts;
const verified = S.domain_status === 'Verified' && S.email_from && !/@resend\\.dev/i.test(S.email_from);
if (input.stage === 'send') return [{ ctx: { stage: 'send', x: input, verified, from: S.email_from } }];
return D.clients.map((r) => {
  const c = Rg.normalizeClient(r);
  const m = D.metrics.filter((x) => x.fields['Client ID'] === c.clientId).slice(0, 2).map((x) => x.fields);
  const a = D.activity.filter((x) => x.fields['Client ID'] === c.clientId).map((x) => x.fields);
  const numbers = { client: c.clientName, last_two_weeks: m, keystone_actions_7d: a.length, minutes_saved_7d: a.reduce((s, x) => s + (Number(x['Minutes saved']) || 0), 0), problems_7d: a.filter((x) => /fail|escalat|review/i.test(String((x.Outcome && x.Outcome.name) || x.Outcome || ''))).length };
  return { task: 'client_success', clientId: c.clientId, req: A.buildClaudeRequest({ task: 'client_success', system: P.CHECKIN_SYSTEM, prompt: 'NUMBERS\\n' + JSON.stringify(numbers, null, 1) + '\\nContact first name: ' + String(c.contactName || '').split(' ')[0], schema: P.CHECKIN_SCHEMA, effort: 'low', maxTokens: 3000 }),
    ctx: { stage: 'draft', clientId: c.clientId, clientName: c.clientName, email: c.contactEmail, isDemo: c.isDemo } };
});`,
  handle: `
if (ctx.stage === 'send') {
  const x = ctx.x;
  if (!ctx.verified) return { result: { message: 'Approved, but the email domain is not verified yet, so it could not go to the client.' }, log: [{ kind: 'Run', summary: 'Check-in for ' + x.clientName + ' approved but held (domain not verified)' }] };
  const to = Rg.safeRecipients({ isDemo: !!x.isDemo }, [x.email]);
  return { writes: to.length ? [R.write.email(R.email({ from: ctx.from, to, subject: x.subject, text: x.body, html: '<div style="font-family:Arial,sans-serif;white-space:pre-wrap">' + Lg.escapeHtml(x.body) + '</div>' }))] : [], log: [{ kind: 'Completed', summary: 'Check-in sent to ' + x.clientName, items: 0 }] };
}
if (!parsed.ok) return { error: ctx.clientName + ': check-in failed (' + parsed.error + ')' };
const d = parsed.data;
return { done: 1, notices: [{ kind: 'info', clientId: ctx.clientId, clientName: ctx.clientName, text: 'Health: ' + d.health + ' (' + d.reason + ')\\n\\nCheck-in to ' + ctx.email + '\\nSubject: ' + d.subject + '\\n\\n' + d.body,
  approval: { type: 'client_checkin', ref: ctx.clientId, summary: 'Send weekly check-in to ' + ctx.clientName, action: { webhook: '${BASE}/ks-agent-client-success', body: { stage: 'send', clientName: ctx.clientName, email: ctx.email, isDemo: ctx.isDemo, subject: d.subject, body: d.body } } } }],
  log: [{ kind: 'Awaiting approval', summary: ctx.clientName + ': ' + d.health + ' - check-in ready', ref: ctx.clientId }] };`,
});
