'use strict';
// Ops Monitor: classifies workflow failures against the Approved Fixes table and builds
// the daily health line and the monthly value report.
// Hard rule: the monitor only takes actions listed in Approved Fixes. Everything else is escalated.

const { obj } = require('./agent');
const { MINUTES_SAVED } = require('./log');

const ALLOWED_ACTIONS = ['retry_once', 'requeue_invoice', 'refresh_token'];

const DEFAULT_FIXES = [
  { 'Fix key': 'transient-api-error', 'Enabled': true, 'Action': 'retry_once', 'Max attempts': 1, 'Error pattern': '(ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|timeout|\\b429\\b|rate limit|\\b50[234]\\b|service unavailable|bad gateway|overloaded)', 'Description': 'Network blip or temporary API outage: retry the execution once.' },
  { 'Fix key': 'out-of-window-invoice', 'Enabled': true, 'Action': 'requeue_invoice', 'Max attempts': 1, 'Error pattern': '(outside send window|OUT_OF_WINDOW)', 'Description': 'Invoice reached Xero step outside the client send window: set the job back to Queued.' },
  { 'Fix key': 'expired-oauth-token', 'Enabled': true, 'Action': 'refresh_token', 'Max attempts': 1, 'Error pattern': '(token (has )?expired|\\b401\\b.*(xero|google)|invalid_token|AuthenticationUnsuccessful)', 'Description': 'Expired access token: retry once so n8n refreshes the OAuth token. If refresh fails (invalid_grant) it is escalated.' },
];

const NEVER_AUTOFIX = /(invalid_grant|refresh token.*(revoked|expired)|KEYSTONE GUARDRAIL|validation|duplicate|payment|refund)/i;

function fixesFromRows(rows) {
  return (rows || []).map((r) => (r.fields ? r.fields : r)).filter((f) => f['Enabled'] && ALLOWED_ACTIONS.includes((f['Action'] && f['Action'].name) || f['Action']))
    .map((f) => ({ key: f['Fix key'], action: (f['Action'] && f['Action'].name) || f['Action'], pattern: f['Error pattern'], maxAttempts: Number(f['Max attempts']) || 1 }));
}

// error: {message, workflowName, node, executionId, retryOf}. attempts: prior auto-fix attempts for this execution chain.
function classifyError(error, fixes, attempts = 0) {
  const msg = `${error.message || ''} ${error.description || ''} ${error.node || ''} ${error.workflowName || ''}`;
  if (NEVER_AUTOFIX.test(msg)) return { action: 'escalate', reason: 'Matches a never-auto-fix rule (auth revoked, guardrail, data or money issue).' };
  for (const f of fixes) {
    let re;
    try { re = new RegExp(f.pattern, 'i'); } catch (e) { continue; }
    if (re.test(msg)) {
      if (attempts >= f.maxAttempts) return { action: 'escalate', reason: `Approved fix "${f.key}" already tried ${attempts}x and the error repeated.`, fix: f };
      return { action: f.action, fix: f, reason: `Matches approved fix "${f.key}".` };
    }
  }
  return { action: 'escalate', reason: 'No approved fix matches this error.' };
}

function clientIdFromText(text) {
  const m = String(text || '').match(/\bKS-[A-Z0-9-]{2,20}\b/);
  return m ? m[0].replace(/-+$/, '') : null;
}

const ESCALATION_SCHEMA = obj({
  summary: { type: 'string' },
  likelyCause: { type: 'string' },
  customerImpact: { type: 'string' },
  suggestedFix: { type: 'string' },
  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
});

const ESCALATION_SYSTEM = `You are Keystone's ops monitor. An n8n workflow serving a client failed and no approved automatic fix applies.
Write a clear, short escalation for Bilal, the operator. Say what broke, the likely cause, whether the client's customers are affected right now, and the exact fix you suggest (which n8n node, which setting).
Do not suggest any action that moves money, sends invoices or contacts customers. Severity is high if customers are affected right now (calls failing, bookings lost).`;

function escalationPrompt(error, client) {
  return `Client: ${client ? `${client.clientName} (${client.clientId})` : 'unknown'}
Workflow: ${error.workflowName}
Failed node: ${error.node}
Execution: ${error.executionUrl || error.executionId}
Error message: ${error.message}
Stack (trimmed): ${String(error.stack || '').slice(0, 1500)}`;
}

// Daily one-line health summary across all clients. logs are the last 24 hours of Agent Log rows.
function dailyHealthLine(clients, logs, now) {
  const f = (r) => (r.fields ? r.fields : r);
  const active = clients.filter((c) => c.status === 'Active');
  const rows = logs.map(f);
  const outcome = (r) => (r['Outcome'] && r['Outcome'].name) || r['Outcome'];
  const esc = rows.filter((r) => outcome(r) === 'Escalated' || outcome(r) === 'Failed');
  const fixed = rows.filter((r) => outcome(r) === 'Auto-fixed').length;
  const review = rows.filter((r) => outcome(r) === 'Sent to review').length;
  const byClient = {};
  for (const r of esc) byClient[r['Client ID'] || 'keystone'] = (byClient[r['Client ID'] || 'keystone'] || 0) + 1;
  const d = (now || new Date()).toISOString().slice(0, 10);
  const status = esc.length ? 'ATTENTION' : 'OK';
  const escText = esc.length ? ` · ${esc.length} need you (${Object.entries(byClient).map(([k, v]) => `${k}: ${v}`).join(', ')})` : '';
  return `${status} ${d}: ${active.length} active client${active.length === 1 ? '' : 's'} · ${rows.length} actions logged · ${fixed} auto-fixed · ${review} in Needs Review${escText}`;
}

// Monthly value report numbers for one client. counts come from reporting.activityCounts.
function valueReport(client, counts, monthLabel) {
  const hours = Math.round((counts.minutesSaved / 60) * 10) / 10;
  const rate = 28; // £/hour, loaded cost of UK admin staff. Conservative.
  return {
    clientId: client.clientId,
    clientName: client.clientName,
    month: monthLabel,
    lines: [
      ['Invoices drafted in Xero', counts.invoicesDrafted],
      ['Invoices caught for review before reaching a customer', counts.invoicesToReview],
      ['Calls answered', counts.callsHandled],
      ['Bookings made or moved', counts.bookingsMade],
      ['Urgent calls escalated to you', counts.urgentCalls],
      ['Quotes drafted', counts.quotesIssued],
      ['Issues fixed automatically', counts.issuesAutoFixed],
    ],
    hoursSaved: hours,
    valueOfTime: Math.round(hours * rate),
    rate,
  };
}

module.exports = { ALLOWED_ACTIONS, DEFAULT_FIXES, NEVER_AUTOFIX, fixesFromRows, classifyError, clientIdFromText, ESCALATION_SCHEMA, ESCALATION_SYSTEM, escalationPrompt, dailyHealthLine, valueReport, MINUTES_SAVED };
