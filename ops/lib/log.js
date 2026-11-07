'use strict';
// One shape for every Agent Log row. Every agent or workflow decision goes through this.

const OPS_EMAIL = 'keystoneconsultancy.co@gmail.com'; // Bilal's ops inbox

// Conservative admin-time estimates (minutes a person would have spent). Used for value reports.
const MINUTES_SAVED = {
  invoice_draft_created: 12,
  invoice_agent_fixed: 20,
  invoice_queued: 2,
  call_handled: 5,
  booking_made: 8,
  reschedule: 6,
  urgent_escalated: 5,
  complaint_logged: 8,
  message_taken: 4,
  quote_drafted: 25,
  issue_auto_fixed: 20,
  weekly_report: 45,
  monthly_report: 90,
};

function logRecord({ clientId, service, event, decision, reasoning, outcome, confidence, reference, workflow, executionId, details, now }) {
  const minutes = MINUTES_SAVED[event] || 0;
  const summary = `[${clientId || 'keystone'}] ${service}: ${event}${outcome ? ' -> ' + outcome : ''}`.slice(0, 250);
  return {
    'Summary': summary,
    'Client ID': clientId || '',
    'Service': service,
    'Event': event,
    'Decision': decision || '',
    'Reasoning': reasoning || '',
    'Outcome': outcome || 'Success',
    'Confidence': typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : null,
    'Reference': reference || '',
    'Minutes saved': ['Success', 'Draft created', 'Auto-fixed', 'Escalated'].includes(outcome || 'Success') ? minutes : 0,
    'Timestamp': (now || new Date()).toISOString(),
    'Workflow': workflow || '',
    'Execution ID': executionId ? String(executionId) : '',
    'Details JSON': details ? JSON.stringify(details).slice(0, 90000) : '',
  };
}

function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Airtable filterByFormula string literal escaping.
function formulaString(s) {
  return "'" + String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

module.exports = { OPS_EMAIL, MINUTES_SAVED, logRecord, escapeHtml, formulaString };
