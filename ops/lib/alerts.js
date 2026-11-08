'use strict';
// Urgent failure alerts: turns an n8n Error Trigger payload (+ the failed execution's data)
// into a plain-English SMS and email: which workflow, which client, what went wrong, and
// whether a customer or call was affected.

const { escapeHtml } = require('./log');

// Workflow name -> who is affected. First match wins.
const IMPACT = [
  { re: /inbound ivr|1\. inbound/i, level: 'URGENT', customer: 'YES. A caller was on the line. Calls fall back to reception where possible; check that the caller got through.' },
  { re: /vapi tools|2\. vapi/i, level: 'URGENT', customer: 'YES. A caller was talking to the AI agent and the booking, availability or quote step failed mid-call.' },
  { re: /post-call|3\. post/i, level: 'HIGH', customer: 'POSSIBLY. A booking confirmation to the customer or the notification to the business may not have been sent.' },
  { re: /quote/i, level: 'HIGH', customer: 'POSSIBLY. A customer may be waiting for a quote.' },
  { re: /sheet poller/i, level: 'HIGH', customer: 'NO customer contact. Invoices for completed jobs are paused until this is fixed; the jobs stay in the sheet.' },
  { re: /invoice/i, level: 'HIGH', customer: 'POSSIBLY. A draft invoice may be delayed. Nothing is sent to the customer by mistake; the job stays queued.' },
  { re: /report/i, level: 'NORMAL', customer: 'NO. A client report may be late.' },
  { re: /audit|monitor|health|registry/i, level: 'NORMAL', customer: 'NO. Internal Keystone workflow.' },
];

// Error text -> plain English. First match wins.
const CAUSES = [
  { re: /invalid_grant|refresh token|reconnect|consent/i, text: 'A login connection has expired and must be reconnected.', fix: 'Open n8n > Credentials, open the credential for this service, and click Reconnect.' },
  { re: /\b401\b|unauthori[sz]ed|authentication|invalid api key|forbidden|\b403\b/i, text: 'A service rejected our login (expired or wrong key/token).', fix: 'Check the credential for this service in n8n. It may need reconnecting or a new key.' },
  { re: /\b429\b|rate limit|too many requests/i, text: 'A service is limiting how fast we can send requests.', fix: 'Usually clears by itself within minutes. If it repeats, reduce how often the workflow runs.' },
  { re: /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up|timeout|timed out|\b50[0234]\b|bad gateway|service unavailable|overloaded/i, text: 'A service we depend on was down or too slow to answer.', fix: 'Usually temporary. Check the service status page; re-run the execution once it is back.' },
  { re: /\b400\b|validation|invalid|bad request|required/i, text: 'A service rejected the data we sent (a field was missing or in the wrong format).', fix: 'Open the failed execution, look at the input of the failed node, and correct the source data or Client Config.' },
  { re: /cannot read propert|undefined|is not a function|is not defined|unexpected token|JSON/i, text: 'The workflow received data in a shape it did not expect (missing field or a bug).', fix: 'Open the failed execution and check the node before the failed one. A setting in Client Config may be empty.' },
  { re: /KEYSTONE GUARDRAIL/i, text: 'A Keystone safety check blocked an action (for example, an invoice that was not a draft).', fix: 'Nothing was sent. Review the execution; the guardrail did its job.' },
];

function serviceFromNode(node) {
  const n = String(node || '').toLowerCase();
  for (const [k, v] of [['xero', 'Xero'], ['resend', 'Resend (email)'], ['email', 'Resend (email)'], ['calendar', 'Google Calendar'], ['sheet', 'Google Sheets'], ['drive', 'Google Drive'], ['vapi', 'Vapi'], ['twilio', 'Twilio'], ['airtable', 'Airtable'], ['claude', 'Claude AI'], ['agent', 'Claude AI']]) if (n.includes(k)) return v;
  return null;
}

// Finds the client this execution was running for, from the failed execution's data.
function findClientId(executionData) {
  const text = typeof executionData === 'string' ? executionData : JSON.stringify(executionData || {});
  const ids = [];
  for (const re of [/"clientId"\s*:\s*"([^"]{2,60})"/g, /"Client ID"\s*:\s*"([^"]{2,60})"/g, /X-Keystone-Client=([A-Z0-9-]{3,40})/g]) {
    let m; while ((m = re.exec(text))) if (!/^REPLACE_WITH/.test(m[1])) ids.push(m[1]);
  }
  const uniq = [...new Set(ids)];
  return { clientId: uniq.length === 1 ? uniq[0] : uniq.length ? uniq[0] : null, all: uniq };
}

// payload = Error Trigger output; extra = { executionData, clientName }
function buildAlert(payload, extra = {}) {
  const ex = payload.execution || {};
  const trig = payload.trigger || {};
  const wfName = (payload.workflow && payload.workflow.name) || 'Unknown workflow';
  const err = ex.error || trig.error || {};
  const message = String(err.message || err.description || 'No error message').slice(0, 600);
  const node = ex.lastNodeExecuted || (err.node && err.node.name) || '';
  const impact = IMPACT.find((i) => i.re.test(wfName)) || { level: 'HIGH', customer: 'UNKNOWN. Check the execution.' };
  const cause = CAUSES.find((c) => c.re.test(message + ' ' + (err.description || ''))) || { text: 'Something unexpected went wrong.', fix: 'Open the failed execution in n8n to see the details.' };
  const svc = serviceFromNode(node);
  const found = extra.clientId ? { clientId: extra.clientId, all: [extra.clientId] } : findClientId(extra.executionData);
  const clientLabel = found.clientId ? `${extra.clientName ? extra.clientName + ' ' : ''}(${found.clientId})` : (found.all.length > 1 ? `several: ${found.all.join(', ')}` : 'not identified (Keystone-wide or before client lookup)');
  const plain = `${cause.text}${svc ? ` Service: ${svc}.` : ''}${node ? ` Step: "${node}".` : ''}`;
  const url = ex.url || '';
  const sms = `KEYSTONE ${impact.level}: "${wfName}" failed. Client: ${clientLabel}. Customer/call affected: ${impact.customer.split('.')[0]}. ${cause.text} Details emailed.`.slice(0, 320);
  const subject = `[Keystone ${impact.level}] ${wfName} failed (${found.clientId || 'client unknown'})`;
  const rows = [
    ['Workflow', wfName], ['Client', clientLabel], ['Customer or call affected?', impact.customer],
    ['What went wrong', plain], ['Suggested fix', cause.fix], ['Raw error', message], ['Execution', url || ex.id || 'n/a'],
    ['Time', new Date().toISOString()],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px"><h2 style="color:${impact.level === 'URGENT' ? '#b91c1c' : '#b45309'}">${escapeHtml(subject)}</h2><table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:bold;vertical-align:top;width:180px">${escapeHtml(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${k === 'Execution' && url ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : escapeHtml(v)}</td></tr>`).join('')}</table></div>`;
  return { level: impact.level, workflow: wfName, clientId: found.clientId, customerAffected: impact.customer, plain, fix: cause.fix, message, node, executionId: ex.id || null, url, sms, subject, text, html };
}

// Throttle so a poller failing every 5 minutes doesn't send 12 texts an hour.
// state: workflow static data object. Returns {sendSms, sendEmail, repeats}.
function throttle(state, key, now, { smsEveryMins = 30, emailEveryMins = 10 } = {}) {
  state.alerts = state.alerts || {};
  const s = state.alerts[key] || { lastSms: 0, lastEmail: 0, suppressed: 0 };
  const t = now.getTime();
  const sendSms = t - s.lastSms >= smsEveryMins * 60000;
  const sendEmail = t - s.lastEmail >= emailEveryMins * 60000;
  const repeats = s.suppressed;
  if (sendSms) s.lastSms = t;
  if (sendEmail) { s.lastEmail = t; s.suppressed = 0; } else s.suppressed++;
  state.alerts[key] = s;
  // keep the map small
  const keys = Object.keys(state.alerts);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete state.alerts[k];
  return { sendSms, sendEmail, repeats };
}

module.exports = { IMPACT, CAUSES, serviceFromNode, findClientId, buildAlert, throttle };
