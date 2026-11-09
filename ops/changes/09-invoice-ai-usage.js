'use strict';
// Change 9: log the cost of every invoice exception-agent call (Claude Opus) to Airtable "AI Usage".
// Adds two side nodes after "Exception agent (Claude)"; the invoice path itself is unchanged.
const { H } = require('../scripts/stock');
const n = require('../scripts/n8n');
module.exports = async function modify(w) {
  const claude = 'Exception agent (Claude)';
  H.node(w, claude);
  const logger = n.aiUsageLogger('Log AI usage', 'invoice_exception', '[Stock] Invoice Automation',
    "(($('AI check job data').item.json.client || {}).clientId) || $('AI check job data').item.json.clientId");
  H.add(w, logger, H.pos(w, claude, 0, 220));
  H.add(w, n.code('AI usage request', `return { json: $json.writes[0] };`, { mode: 'runOnceForEachItem' }), H.pos(w, claude, 220, 220));
  H.add(w, Object.assign(n.airtableWrite('Write AI usage'), { onError: 'continueRegularOutput' }), H.pos(w, claude, 440, 220));
  const next = H.targets(w, claude, 0).filter((t) => t !== 'Log AI usage');
  H.setOut(w, claude, 0, next.concat(['Log AI usage']));
  H.setOut(w, 'Log AI usage', 0, ['AI usage request']);
  H.setOut(w, 'AI usage request', 0, ['Write AI usage']);
};
