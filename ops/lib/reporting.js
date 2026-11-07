'use strict';
// Reporting: Xero numbers + Keystone activity -> one weekly metrics row per client,
// plus the plain-English explainer agent.

const { obj } = require('./agent');

function amount(cell) {
  const v = cell && cell.Value !== undefined ? cell.Value : cell;
  const n = Number(String(v || '').replace(/[,£]/g, ''));
  return isFinite(n) ? n : 0;
}

// Walks a Xero Reports API response and returns {label -> first numeric cell}.
function flattenXeroReport(report) {
  const rep = report && report.Reports ? report.Reports[0] : report;
  const out = {};
  const walk = (rows) => {
    for (const r of rows || []) {
      if (r.Rows) walk(r.Rows);
      if ((r.RowType === 'Row' || r.RowType === 'SummaryRow') && r.Cells && r.Cells.length > 1) {
        const label = String(r.Cells[0].Value || '').trim().toLowerCase();
        if (label && out[label] === undefined) out[label] = amount(r.Cells[1]);
      }
    }
  };
  walk(rep && rep.Rows);
  return out;
}

function parseProfitAndLoss(report) {
  const f = flattenXeroReport(report);
  const pick = (...labels) => { for (const l of labels) if (f[l] !== undefined) return f[l]; return 0; };
  const revenue = pick('total income', 'total trading income', 'total revenue', 'total sales');
  const cos = pick('total cost of sales', 'total direct costs');
  const opex = pick('total operating expenses', 'total expenses');
  const net = f['net profit'] !== undefined ? f['net profit'] : revenue - cos - opex;
  return { revenue, costs: cos + opex, netProfit: net };
}

function parseBankSummary(report) {
  const f = flattenXeroReport(report);
  // Bank Summary rows: account | opening | received | spent | closing. Use the closing-balance total.
  const rep = report && report.Reports ? report.Reports[0] : report;
  let closing = null;
  const walk = (rows) => {
    for (const r of rows || []) {
      if (r.Rows) walk(r.Rows);
      if (r.RowType === 'SummaryRow' && r.Cells && r.Cells.length >= 5) closing = amount(r.Cells[r.Cells.length - 1]);
    }
  };
  walk(rep && rep.Rows);
  return { cash: closing !== null ? closing : f['total'] || 0 };
}

// invoices: Xero ACCREC invoices with Status AUTHORISED (approved and awaiting payment).
function parseReceivables(invoices, today) {
  const t = (today || new Date()).toISOString().slice(0, 10);
  let receivables = 0, overdueCount = 0, overdueValue = 0;
  const overdue = [];
  for (const inv of invoices || []) {
    if (inv.Type && inv.Type !== 'ACCREC') continue;
    if (inv.Status !== 'AUTHORISED') continue;
    const due = amount(inv.AmountDue);
    if (due <= 0) continue;
    receivables += due;
    const dueDate = xeroDate(inv.DueDateString || inv.DueDate);
    if (dueDate && dueDate < t) {
      overdueCount++; overdueValue += due;
      overdue.push({ number: inv.InvoiceNumber, contact: inv.Contact && inv.Contact.Name, due, dueDate, daysLate: Math.round((Date.parse(t) - Date.parse(dueDate)) / 86400000) });
    }
  }
  overdue.sort((a, b) => b.due - a.due);
  return { receivables: round(receivables), overdueCount, overdueValue: round(overdueValue), topOverdue: overdue.slice(0, 5) };
}

function xeroDate(v) {
  if (!v) return null;
  const m = String(v).match(/\/Date\((\d+)/);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function round(n) { return Math.round(n * 100) / 100; }

// Keystone activity for one client in [from, to). All inputs must already be filtered to that client.
function activityCounts({ agentLog = [], callLog = [], quotes = [] }, from, to, clientId) {
  const inRange = (ts) => { const d = Date.parse(ts); return d >= Date.parse(from) && d < Date.parse(to); };
  const f = (r) => (r.fields ? r.fields : r);
  const mine = (r) => f(r)['Client ID'] === clientId;
  const logs = agentLog.filter(mine).map(f).filter((r) => inRange(r['Timestamp']));
  const calls = callLog.filter(mine).map(f).filter((r) => inRange(r['Timestamp']));
  const qs = quotes.filter(mine).map(f).filter((r) => inRange(r['Created']));
  const cat = (r) => (r['Category'] && r['Category'].name) || r['Category'];
  const outcome = (r) => (r['Outcome'] && r['Outcome'].name) || r['Outcome'];
  return {
    invoicesDrafted: logs.filter((r) => String(r['Event']).startsWith('invoice_') && outcome(r) === 'Draft created').length,
    invoicesToReview: logs.filter((r) => String(r['Event']).startsWith('invoice_') && outcome(r) === 'Sent to review').length,
    callsHandled: calls.length,
    bookingsMade: calls.filter((r) => ['Booking', 'Reschedule'].includes(cat(r))).length,
    urgentCalls: calls.filter((r) => cat(r) === 'Urgent').length,
    complaints: calls.filter((r) => cat(r) === 'Complaint').length,
    quotesIssued: qs.length,
    issuesAutoFixed: logs.filter((r) => outcome(r) === 'Auto-fixed').length,
    escalations: logs.filter((r) => outcome(r) === 'Escalated').length,
    minutesSaved: logs.reduce((s, r) => s + (Number(r['Minutes saved']) || 0), 0),
  };
}

// Deterministic, realistic demo figures (no Xero needed). Seeded by client + week so reruns match.
function demoFinancials(clientId, weekStart) {
  let seed = 0;
  for (const ch of clientId + weekStart) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const revenue = Math.round(68000 + rnd() * 24000);
  const costs = Math.round(revenue * (0.74 + rnd() * 0.12));
  const receivables = Math.round(revenue * (1.4 + rnd() * 0.6));
  const overdueCount = 3 + Math.floor(rnd() * 7);
  return {
    revenue, costs, netProfit: revenue - costs,
    cash: Math.round(90000 + rnd() * 60000),
    receivables, overdueCount, overdueValue: Math.round(receivables * (0.18 + rnd() * 0.15)),
    topOverdue: [
      { number: 'INV-2041', contact: 'Harbour Lettings Ltd', due: 4820, daysLate: 38 },
      { number: 'INV-2077', contact: 'St Anne\'s School', due: 2150, daysLate: 21 },
      { number: 'INV-2093', contact: 'R. Patel', due: 640, daysLate: 9 },
    ],
  };
}

const EXPLAINER_SCHEMA = obj({
  subject: { type: 'string' },
  headline: { type: 'string' },
  whatChanged: { type: 'array', items: { type: 'string' } },
  why: { type: 'array', items: { type: 'string' } },
  actions: { type: 'array', items: obj({ action: { type: 'string' }, reason: { type: 'string' } }) },
});

const EXPLAINER_SYSTEM = `You write a short weekly money update for the owner of a UK small business who is not an accountant.
Rules:
- Plain English, no jargon. Say "money owed to you", not "receivables", and "money in the bank", not "cash position".
- Use only the numbers provided. Don't invent figures. Round to the nearest £100 in prose.
- whatChanged: 2-4 bullets comparing this week with last week.
- why: 1-3 bullets with the most likely reasons, based on the data. If the data can't explain a change, say so.
- actions: 1-3 concrete things to do this week, most valuable first. Never tell them to take out loans, finance or credit; suggest operational actions instead.
- Warm and direct. The subject line is at most 70 characters.`;

function explainerPrompt(client, current, previous, activity) {
  return `Business: ${client.clientName} (${client.industry})
This week: ${JSON.stringify(current)}
Last week: ${JSON.stringify(previous || 'no data yet')}
What Keystone did this week: ${JSON.stringify(activity)}`;
}

// Used when the AI call fails, so the client still gets a useful email.
function fallbackExplainer(client, cur, prev) {
  const gbp = (n) => '£' + Math.round(n / 100) * 100;
  const diff = (a, b) => (b === undefined || b === null ? '' : a >= b ? ` (up ${gbp(a - b)} on last week)` : ` (down ${gbp(b - a)} on last week)`);
  const p = prev || {};
  return {
    subject: `${client.clientName}: your week in numbers`,
    headline: `Money in the bank is ${gbp(cur.cash)}${diff(cur.cash, p.cash)}.`,
    whatChanged: [
      `Sales this week: ${gbp(cur.revenue)}${diff(cur.revenue, p.revenue)}.`,
      `Money owed to you: ${gbp(cur.receivables)}, of which ${gbp(cur.overdueValue)} is overdue across ${cur.overdueCount} invoices.`,
    ],
    why: ['This summary was generated without the AI explainer, so the reasons are not analysed this week.'],
    actions: cur.overdueCount ? [{ action: `Chase the ${Math.min(3, cur.overdueCount)} largest overdue invoices`, reason: `${gbp(cur.overdueValue)} is waiting to be paid.` }] : [{ action: 'No overdue invoices. Keep invoicing on the day the job finishes.', reason: 'Fast invoicing keeps cash coming in.' }],
  };
}

module.exports = { flattenXeroReport, parseProfitAndLoss, parseBankSummary, parseReceivables, xeroDate, activityCounts, demoFinancials, EXPLAINER_SCHEMA, EXPLAINER_SYSTEM, explainerPrompt, fallbackExplainer };
