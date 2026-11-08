'use strict';
// CHANGE_LIST #7: [Stock] Phone Booking - 3. Post-Call Actions
//  - every call logged to Airtable Call Log + Agent Log (Google Sheet log carries on)
//  - safety net: urgent words in the transcript but nobody escalated -> escalate now (SMS once Twilio has a number + email)
//  - complaints flagged in the analysis -> escalate
//  - customer/business emails can no longer fail the run; demo clients' customer email goes to the test inbox
const n = require('../scripts/n8n');
const { H } = require('../scripts/stock');
const L = ['phone', 'registry', 'requests', 'log', 'time'];

module.exports = async function modify(w) {
  const g = H.node(w, 'Get Client Config').position;
  H.add(w, n.code('Check call outcome', `
const { phone: P, requests: R, log: Lg } = KS;
const cfg = $input.item.json;
const msg = ($('Vapi End Of Call').item.json.body || {}).message || {};
const art = msg.artifact || {};
const tools = [];
for (const m of art.messages || msg.messages || []) for (const tc of (m.toolCalls || m.tool_calls || [])) {
  const fn = tc.function || {}; let args = fn.arguments; if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
  tools.push({ name: fn.name || tc.name, args: args || {} });
}
const client = { clientId: cfg.clientId, phone: { urgentKeywords: cfg.urgentKeywords || [] } };
const report = { callId: (msg.call && msg.call.id) || '', transcript: art.transcript || msg.transcript || '', summary: (msg.analysis && msg.analysis.summary) || msg.summary || '', call: msg.call || { customer: msg.customer }, endedReason: msg.endedReason };
const o = P.callOutcome(client, report, tools);
const sd = (msg.analysis && msg.analysis.structuredData) || {};
const complaintMissed = (sd.complaint === true || /\\bcomplain/i.test(report.summary)) && !tools.some((t) => t.name === 'log_complaint');
const W = [R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.callLog, [o.row]))];
for (const ev of o.events) W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.agentLog, [Lg.logRecord({ clientId: cfg.clientId, service: 'phone', event: ev, outcome: ev === 'urgent_escalated' ? 'Escalated' : 'Success', decision: o.row.Category + ': ' + (o.row.Outcome || ''), reasoning: String(o.row.Summary || '').slice(0, 500), reference: o.row['Call ID'], workflow: '[Stock] Phone Booking - 3. Post-Call Actions', executionId: $execution.id })])));
let notice = null;
if (o.safetyNetEscalation || complaintMissed) {
  const who = (o.row['Caller number'] || 'unknown number');
  const text = (o.safetyNetEscalation ? 'URGENT (safety net): the call from ' + who + ' mentioned ' + o.safetyNetEscalation.join(', ') + ' but was not escalated during the call. ' : 'Complaint from ' + who + ' was not escalated during the call. ') + 'Summary: ' + (report.summary || '(none)') + ' Please call them back now.';
  notice = { kind: o.safetyNetEscalation ? 'urgent_call' : 'complaint', clientId: cfg.clientId, clientName: cfg.businessName, text, audience: 'both', business: { email: cfg.businessNotificationEmail, sms: cfg.escalationSmsNumber || cfg.managerPhoneNumber, isDemo: !!cfg.isDemo } };
}
return { json: { writes: W, notice } };`, { libs: L, mode: 'runOnceForEachItem' }), [g[0] + 240, g[1] + 360]);
  H.add(w, n.code('Needs escalation?', `return $input.all().filter((i) => i.json.notice).map((i) => ({ json: i.json.notice }));`), [g[0] + 480, g[1] + 480]);
  H.add(w, n.notify('Escalate now'), [g[0] + 720, g[1] + 480]);
  const tail = n.writesTail();
  tail.nodes.forEach((x, i) => H.add(w, x, [g[0] + 480 + i * 220, g[1] + 620]));
  for (const [f, t, o] of tail.edges) H.setOut(w, f, o || 0, [...H.targets(w, f, o || 0).filter((x) => x !== t), t]);
  const cur = H.targets(w, 'Get Client Config', 0);
  H.setOut(w, 'Get Client Config', 0, [...cur.filter((x) => x !== 'Check call outcome'), 'Check call outcome']);
  H.setOut(w, 'Check call outcome', 0, ['Fan out writes', 'Needs escalation?']);
  H.setOut(w, 'Needs escalation?', 0, ['Escalate now']);
  // emails must not fail the run; demo customer emails go to the test inbox
  for (const nm of ['Email Customer Confirmation', 'Email Business Notification', 'Email Business - Manager Transfer Alert', 'Log Call To CallLog']) H.node(w, nm).onError = 'continueRegularOutput';
  const ec = H.node(w, 'Email Customer Confirmation').parameters;
  ec.jsonBody = ec.jsonBody.replace("to: [$('Extract Call Summary').item.json.customerEmail]", "to: [$json.isDemo ? 'khan.bilalbk408@gmail.com' : $('Extract Call Summary').item.json.customerEmail]");
  if (!ec.jsonBody.includes('$json.isDemo')) throw new Error('customer email recipient not rewritten');
};
