'use strict';
// KS Test - Calendar helper: TEST ONLY. Lists events, and deletes ONLY events whose title contains "KS TEST".
const n = require('../scripts/n8n');
const TOKEN = process.env.KS_CAL_HELPER_TOKEN || 'set-at-deploy';
const nodes = [
  n.webhook('Calendar helper', 'ks-test-calendar-helper'),
  n.code('Check request', `
const b = $json.body || {};
if (b.token !== ${JSON.stringify(TOKEN)}) return [{ json: { allowed: false, response: { ok: false, error: 'bad token' } } }];
const cal = encodeURIComponent(b.calendarId || 'primary');
if (b.op === 'list') return [{ json: { allowed: true, req: { method: 'GET', url: 'https://www.googleapis.com/calendar/v3/calendars/' + cal + '/events?singleEvents=true&orderBy=startTime&q=' + encodeURIComponent(b.q || 'KS TEST') + '&timeMin=' + encodeURIComponent(b.timeMin || new Date(Date.now() - 86400000).toISOString()) } } }];
if (b.op === 'delete' && b.eventId && /KS TEST/i.test(b.summary || '')) return [{ json: { allowed: true, req: { method: 'DELETE', url: 'https://www.googleapis.com/calendar/v3/calendars/' + cal + '/events/' + encodeURIComponent(b.eventId) } } }];
return [{ json: { allowed: false, response: { ok: false, error: 'not allowed' } } }];`),
  n.iff('Allowed?', 'allowed'),
  n.http('Call Calendar', 'gcal', { method: '={{ $json.req.method }}', sendBody: false }),
  n.code('Wrap', `return [{ json: { response: { ok: $json.statusCode < 300, statusCode: $json.statusCode, body: $json.body } } }];`),
  n.respond('Respond'),
  n.respond('Respond refused'),
];
module.exports = n.workflow('KS Test - Calendar helper', nodes, [['Calendar helper', 'Check request'], ['Check request', 'Allowed?'], ['Allowed?', 'Call Calendar', 0], ['Allowed?', 'Respond refused', 1], ['Call Calendar', 'Wrap'], ['Wrap', 'Respond']], { tags: ['keystone', 'test'] });
