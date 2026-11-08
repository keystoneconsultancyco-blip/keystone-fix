'use strict';
// Keystone Ops Manager: morning/evening summaries, instant notices for key moments,
// and YES/NO approvals (SMS reply once Twilio has a number; email links until then).

const { escapeHtml: e } = require('./log');

function settingsMap(records) {
  const S = {};
  for (const r of records || []) { const f = r.fields || r; if (f.Setting) S[f.Setting] = String(f.Value || '').trim(); }
  return S;
}

// Which channel(s) to use for Bilal. Business escalations use the same SMS switch.
function channels(S) {
  const smsReady = !!(S.twilio_from && S.alert_sms_to);
  const mode = (S.ops_channel || 'auto').toLowerCase();
  if (mode === 'email' || !smsReady) return { sms: false, email: true, smsReady };
  if (mode === 'both') return { sms: true, email: true, smsReady };
  return { sms: true, email: false, smsReady };
}

function approvalCode() { return String(Math.floor(1000 + Math.random() * 9000)); }

// "YES 4821", "y 4821", "no4821", "4821 yes" -> {decision, code}
function parseReply(text) {
  const t = String(text || '').trim().toLowerCase();
  const code = (t.match(/\b(\d{4})\b/) || [])[1] || null;
  let decision = null;
  if (/\b(yes|y|approve|ok|okay|go)\b/.test(t)) decision = 'yes';
  if (/\b(no|n|reject|stop|cancel)\b/.test(t)) decision = decision ? null : 'no';
  return { decision, code };
}

const KIND_LABEL = {
  urgent_call: 'URGENT CALL', complaint: 'COMPLAINT', message: 'Message', quote_approval: 'Quote to approve',
  invoice_review: 'Invoice to review', failure: 'Workflow failure', info: 'Update', booking: 'New booking',
};

function smsText(n, code) {
  const head = `${KIND_LABEL[n.kind] || 'Keystone'}${n.clientName ? ' - ' + n.clientName : ''}: `;
  const tail = code ? ` Reply YES ${code} or NO ${code}.` : '';
  return (head + (n.text || n.title || '')).slice(0, 320 - tail.length) + tail;
}

function emailHtml(n, links) {
  const btn = (href, label, colour) => `<a href="${e(href)}" style="display:inline-block;background:${colour};color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;margin-right:8px">${label}</a>`;
  return `<div style="font-family:Arial,sans-serif;max-width:620px">
<h2 style="margin:0 0 8px;color:${n.kind === 'urgent_call' || n.kind === 'complaint' ? '#b91c1c' : '#1F3A5F'}">${e(KIND_LABEL[n.kind] || 'Keystone')}${n.clientName ? ' - ' + e(n.clientName) : ''}</h2>
<p style="font-size:15px;white-space:pre-wrap">${e(n.text || '')}</p>
${links ? `<p>${btn(links.yes, 'YES', '#059669')}${btn(links.no, 'NO', '#6b7280')}</p><p style="font-size:12px;color:#6b7280">Approval code ${e(links.code)}. Once SMS is set up you can also reply to the text with YES ${e(links.code)} or NO ${e(links.code)}.</p>` : ''}
<p style="font-size:12px;color:#6b7280">Keystone Ops Manager</p></div>`;
}

// ---------- summaries ----------
function inWindow(ts, from, to) { const t = Date.parse(ts); return t >= from.getTime() && t < to.getTime(); }
const f = (r) => (r && r.fields ? r.fields : r || {});
const sel = (v) => (v && v.name) || v || '';

function summarise({ logs = [], calls = [], quotes = [], reviews = [], approvals = [], clients = [] }, from, to) {
  const L = logs.map(f).filter((r) => inWindow(r['Timestamp'], from, to));
  const C = calls.map(f).filter((r) => inWindow(r['Timestamp'], from, to));
  const Q = quotes.map(f).filter((r) => inWindow(r['Created'], from, to));
  const count = (arr, pred) => arr.filter(pred).length;
  const nameOf = (id) => (clients.map(f).find((c) => c['Client ID'] === id) || {})['Client name'] || id || 'Keystone';
  const failures = L.filter((r) => sel(r['Outcome']) === 'Escalated' && sel(r['Service']) === 'monitor');
  return {
    invoicesDrafted: count(L, (r) => String(r['Event']).startsWith('invoice_') && sel(r['Outcome']) === 'Draft created'),
    invoicesToReview: count(L, (r) => String(r['Event']).startsWith('invoice_') && sel(r['Outcome']) === 'Sent to review'),
    calls: C.length,
    bookings: count(C, (r) => ['Booking', 'Reschedule'].includes(sel(r['Category']))),
    urgent: C.filter((r) => sel(r['Category']) === 'Urgent').map((r) => `${nameOf(r['Client ID'])}: ${String(r['Summary'] || '').slice(0, 80)}`),
    complaints: C.filter((r) => sel(r['Category']) === 'Complaint').map((r) => `${nameOf(r['Client ID'])}: ${String(r['Summary'] || '').slice(0, 80)}`),
    quotes: Q.length,
    quotesValue: Math.round(Q.reduce((s, r) => s + (Number(r['Total']) || 0), 0)),
    failures: failures.map((r) => `${r['Reference'] || 'workflow'} (${nameOf(r['Client ID'])})`),
    openReviews: reviews.map(f).filter((r) => sel(r['Status']) === 'Open').length,
    pendingApprovals: approvals.map(f).filter((r) => sel(r['Status']) === 'Pending').map((r) => ({ code: r['Code'], summary: r['Summary'] })),
    activeClients: clients.map(f).filter((c) => sel(c['Status']) === 'Active').length,
  };
}

function summaryText(kind, s, dateLabel) {
  const lines = [];
  lines.push(kind === 'morning' ? `Good morning. Overnight and yesterday evening (${dateLabel}):` : `End of day (${dateLabel}):`);
  lines.push(`- ${s.activeClients} active clients`);
  lines.push(`- Invoices drafted: ${s.invoicesDrafted}${s.invoicesToReview ? ` (${s.invoicesToReview} need review)` : ''}`);
  lines.push(`- Calls: ${s.calls}, bookings: ${s.bookings}`);
  lines.push(`- Quotes: ${s.quotes}${s.quotesValue ? ` (£${s.quotesValue.toLocaleString('en-GB')})` : ''}`);
  if (s.urgent.length) lines.push(`- URGENT calls: ${s.urgent.join('; ')}`);
  if (s.complaints.length) lines.push(`- Complaints: ${s.complaints.join('; ')}`);
  if (s.failures.length) lines.push(`- Failures: ${s.failures.join('; ')}`);
  lines.push(`- Open review items: ${s.openReviews}`);
  if (s.pendingApprovals.length) lines.push(`- Waiting for your YES/NO: ${s.pendingApprovals.map((a) => `#${a.code} ${String(a.summary).slice(0, 60)}`).join('; ')}`);
  if (!s.urgent.length && !s.complaints.length && !s.failures.length && !s.openReviews && !s.pendingApprovals.length) lines.push('Nothing needs you right now.');
  return lines.join('\n');
}

function summarySms(kind, s) {
  const needs = s.urgent.length + s.complaints.length + s.failures.length + s.openReviews + s.pendingApprovals.length;
  return `Keystone ${kind === 'morning' ? 'AM' : 'PM'}: ${s.invoicesDrafted} invoices, ${s.calls} calls/${s.bookings} bookings, ${s.quotes} quotes. ${needs ? needs + ' need you' + (s.pendingApprovals.length ? ' (approvals: ' + s.pendingApprovals.map((a) => a.code).join(', ') + ')' : '') : 'All clear.'}`.slice(0, 320);
}

module.exports = { settingsMap, channels, approvalCode, parseReply, smsText, emailHtml, summarise, summaryText, summarySms, KIND_LABEL };
