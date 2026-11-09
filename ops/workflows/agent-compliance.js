'use strict';
// KS Agent - Compliance (OFF until 20 active clients). Monthly, no AI: halal screen still valid for every active
// client, AI phone disclosure rules per jurisdiction, and personal data kept longer than 12 months (UK GDPR).
const { makeAgent } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Compliance',
  slug: 'compliance',
  inactive: true,
  crons: [{ label: '2nd of month 09:10', cron: '10 9 2 * *' }],
  libs: ['audit'],
  reads: `return [
  ['clients', list('clients', { formula: "OR({Status} = 'Active', {Status} = 'Onboarding')", maxRecords: 100 })],
  ['oldCalls', list('callLog', { formula: "IS_BEFORE({Timestamp}, DATEADD(NOW(), -365, 'days'))", fields: ['Client ID'], maxRecords: 100 })],
  ['oldQuotes', list('quotes', { formula: "IS_BEFORE({Created}, DATEADD(NOW(), -730, 'days'))", fields: ['Client ID'], maxRecords: 100 })],
];`,
  plan: `
const issues = [];
for (const r of D.clients) {
  const c = Rg.normalizeClient(r);
  const s = KS.audit.halalScreen(c.industry, c.clientName);
  if (!c.halalPassed) issues.push(c.clientName + ': halal screen not ticked');
  if (!s.pass) issues.push(c.clientName + ': industry text mentions ' + s.hits.join(', '));
  if (c.toggles.phone && (!c.aiDisclosurePassed || Rg.BLOCKED_PHONE_JURISDICTIONS.includes(c.jurisdiction))) issues.push(c.clientName + ': AI phone is on but the disclosure check is not passed for ' + (c.jurisdiction || 'unknown jurisdiction'));
}
if (D.oldCalls.length) issues.push(D.oldCalls.length + (D.oldCalls.length === 100 ? '+' : '') + ' call log rows are over 12 months old: review and delete if no longer needed (UK GDPR).');
if (D.oldQuotes.length) issues.push(D.oldQuotes.length + ' quotes are over 2 years old: review and delete if no longer needed.');
return [{ ctx: { issues, checked: D.clients.length } }];`,
  handle: `
const text = 'Monthly compliance check (' + ctx.checked + ' clients): ' + (ctx.issues.length ? ctx.issues.length + ' issue(s):\\n- ' + ctx.issues.join('\\n- ') : 'no issues found.');
return { done: 1, notices: [{ kind: 'info', text }], summary: 'Compliance: ' + ctx.issues.length + ' issue(s)', log: ctx.issues.length ? [{ kind: 'Run', summary: ctx.issues.length + ' compliance issue(s)', details: ctx.issues.join('\\n') }] : [] };`,
});
