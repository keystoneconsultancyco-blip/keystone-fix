'use strict';
// KS Agent - Onboarding (OFF until 5 active clients). Daily: checks every client in "Onboarding" against the
// setup checklist (ops/lib/onboarding.js) and tells Bilal exactly what is missing. No AI needed.
const { makeAgent } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Onboarding',
  slug: 'onboarding',
  inactive: true,
  crons: [{ label: 'Daily 09:10', cron: '10 9 * * *' }],
  libs: ['onboarding'],
  nothingToDo: 'No clients in Onboarding.',
  reads: `return [['clients', list('clients', { formula: input.clientId ? '{Client ID} = ' + Lg.formulaString(input.clientId) : "{Status} = 'Onboarding'", maxRecords: 50 })]];`,
  plan: `return D.clients.map((r) => ({ ctx: { client: Rg.normalizeClient(r) } }));`,
  handle: `
const c = ctx.client;
const ck = KS.onboarding.checklist(c);
const missing = ck.missing.map((m) => m.label + (m.detail ? ' (' + m.detail + ')' : ''));
const text = c.clientName + ' (' + c.clientId + '): ' + (ck.ready ? 'everything on the checklist is done. Next: the test runs in docs/ONBOARDING.md, then set Status = Active.' : missing.length + ' thing(s) still missing:\\n- ' + missing.join('\\n- '));
return { done: 1, notices: [{ kind: 'info', clientId: c.clientId, clientName: c.clientName, text: 'Onboarding check: ' + text }], summary: c.clientName + ': ' + (ck.ready ? 'ready' : missing.length + ' missing'), log: [{ kind: 'Completed', summary: 'Checklist for ' + c.clientName + ': ' + (ck.ready ? 'ready' : missing.length + ' missing'), items: 0, ref: c.clientId }] };`,
});
