'use strict';
// KS Test - Forced Failure: only used to prove the alert system works. Deleted after the test.
const n = require('../scripts/n8n');
const nodes = [
  n.webhook('Force failure', 'ks-test-force-failure', { respond: 'onReceived' }),
  n.code('Pretend client step', `return [{ json: { clientId: 'KS-DEMO-01', step: 'calendar booking' } }];`),
  n.code('Fail on purpose', `const run = ($('Force failure').first().json.body || {}).run || 'x';
throw new Error('Request failed with status code 401 Unauthorized (forced test failure ' + run + ' for Google Calendar booking)');`),
];
module.exports = n.workflow('KS Test - Forced Failure (2. Vapi Tools simulation)', nodes, [['Force failure', 'Pretend client step'], ['Pretend client step', 'Fail on purpose']], { tags: ['keystone', 'test'] });
