'use strict';
// Change 10: Sheet Poller every 30 minutes, 07:00-20:30 (was every 5 minutes, all day) to stay inside the n8n plan.
// "Poll now" (webhook invoice/poll-now) still runs it on demand.
const { H } = require('../scripts/stock');
const OLD = 'Schedule Trigger (every 5 min)';
const NEW = 'Schedule Trigger (every 30 min, 07:00-20:30)';

module.exports = async function modify(w) {
  const name = H.has(w, OLD) ? OLD : NEW;
  const t = H.node(w, name);
  t.typeVersion = 1.2;
  t.parameters = { rule: { interval: [{ field: 'cronExpression', expression: '*/30 7-20 * * *' }] } };
  if (name === OLD) {
    t.name = NEW;
    w.connections[NEW] = w.connections[OLD];
    delete w.connections[OLD];
  }
};
