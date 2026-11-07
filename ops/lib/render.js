'use strict';
// Branded HTML for emails and the client dashboard. Inline CSS only (email-safe).

const { escapeHtml: e } = require('./log');

const gbp = (n) => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function shell(client, title, body) {
  const colour = /^#[0-9a-f]{3,8}$/i.test(client.invoice.brandColour) ? client.invoice.brandColour : '#1F3A5F';
  const logo = client.invoice.brandLogoUrl ? `<img src="${e(client.invoice.brandLogoUrl)}" alt="${e(client.clientName)}" style="max-height:48px;max-width:200px">` : `<strong style="font-size:20px;color:#fff">${e(client.clientName)}</strong>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2433">
<div style="max-width:680px;margin:0 auto;padding:16px">
<div style="background:${colour};padding:18px 20px;border-radius:10px 10px 0 0">${logo}</div>
<div style="background:#fff;padding:22px 20px;border-radius:0 0 10px 10px;line-height:1.5">${body}</div>
<p style="font-size:12px;color:#6b7280;text-align:center">Run by Keystone, your outsourced operations team.</p>
</div></body></html>`;
}

function table(rows, head) {
  const th = head ? `<tr>${head.map((h, i) => `<th style="text-align:${i ? 'right' : 'left'};padding:8px;border-bottom:2px solid #e5e7eb;font-size:13px;color:#6b7280">${e(h)}</th>`).join('')}</tr>` : '';
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${th}${rows.map((r) => `<tr>${r.map((c, i) => `<td style="padding:8px;border-bottom:1px solid #f0f1f3;text-align:${i ? 'right' : 'left'}">${c}</td>`).join('')}</tr>`).join('')}</table>`;
}

// Sent to the BUSINESS (not their customer): a draft invoice is waiting in Xero for approval.
function invoiceDraftEmail(client, { job, invoiceNumber, total, note, xeroUrl }) {
  const body = `<h2 style="margin-top:0">Draft invoice ready to approve</h2>
<p>We've created a <strong>draft</strong> invoice in Xero for <strong>${e(job.customerName)}</strong>. Nothing has been sent to your customer. Approve it in Xero when you're happy.</p>
${table([['Job', e(job.jobId)], ['Customer', e(job.customerName)], ['Invoice', e(invoiceNumber || 'Draft')], ['Total', gbp(total)]])}
${note ? `<p style="background:#fff7e6;border-left:4px solid #f59e0b;padding:10px"><strong>Keystone AI note:</strong> ${e(note)}</p>` : ''}
${xeroUrl ? `<p><a href="${e(xeroUrl)}" style="background:#1d2433;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Review in Xero</a></p>` : ''}
<p style="font-size:13px;color:#6b7280">Payment options shown to customers: ${e(client.invoice.paymentOptions || 'as set in Xero')}</p>`;
  return shell(client, 'Draft invoice ready', body);
}

function quoteDraftEmail(client, q, approveUrl) {
  const rows = q.lines.map((l) => [e(l.description), gbp(l.amount)]);
  rows.push(['<strong>Subtotal (ex VAT)</strong>', gbp(q.subtotal)], ['VAT', gbp(q.vat)], ['<strong>Total</strong>', `<strong>${gbp(q.total)}</strong>`]);
  const warn = q.belowMarginFloor ? `<p style="background:#fee2e2;border-left:4px solid #dc2626;padding:10px"><strong>Below your margin floor:</strong> estimated margin ${q.marginPct}% against a minimum of ${q.minMarginPct}%. Check the price before approving.</p>` : `<p style="font-size:13px;color:#059669">Estimated margin ${q.marginPct}% (minimum ${q.minMarginPct}%).</p>`;
  const body = `<h2 style="margin-top:0">Quote draft for your approval: ${e(q.ref)}</h2>
<p>For <strong>${e(q.customerName || 'customer')}</strong>: ${e(q.description)}</p>
${table(rows, ['Item', 'Price'])}
${warn}
${q.agentNotes ? `<p style="font-size:13px"><strong>How this was priced:</strong> ${e(q.agentNotes)}</p>` : ''}
${q.questions && q.questions.length ? `<p><strong>Still need from the customer:</strong></p><ul>${q.questions.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : ''}
<p>This is an <strong>estimate</strong>. Nothing has been sent to the customer.</p>
${approveUrl && !(q.questions && q.questions.length) ? `<p><a href="${e(approveUrl)}" style="background:#059669;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Approve and send to customer</a></p>` : ''}`;
  return shell(client, `Quote ${q.ref}`, body);
}

function customerQuoteEmail(client, q) {
  const rows = q.lines.map((l) => [e(l.description), gbp(l.amount)]);
  rows.push(['Subtotal (ex VAT)', gbp(q.subtotal)], ['VAT', gbp(q.vat)], ['<strong>Total</strong>', `<strong>${gbp(q.total)}</strong>`]);
  return shell(client, `Your quote from ${client.clientName}`, `<h2 style="margin-top:0">Your quote ${e(q.ref)}</h2><p>Thanks for getting in touch. Here's our quote for: ${e(q.description)}</p>${table(rows, ['Item', 'Price'])}<p>Just reply to this email to go ahead or ask a question.</p>`);
}

function bars(series, colour) {
  const max = Math.max(1, ...series.map((s) => s.value));
  const w = 560, h = 140, bw = Math.floor(w / Math.max(1, series.length)) - 8;
  const rects = series.map((s, i) => {
    const bh = Math.round((s.value / max) * (h - 30));
    const x = i * (bw + 8) + 4;
    return `<rect x="${x}" y="${h - 18 - bh}" width="${bw}" height="${bh}" rx="3" fill="${colour}"><title>${e(s.label)}: ${gbp(s.value)}</title></rect><text x="${x + bw / 2}" y="${h - 4}" font-size="11" text-anchor="middle" fill="#6b7280">${e(s.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Weekly sales">${rects}</svg>`;
}

// Client-facing dashboard. metrics must ALREADY be filtered to this one client.
function dashboardHtml(client, metrics, valueLines) {
  const m = [...metrics].sort((a, b) => String(a['Week starting']).localeCompare(String(b['Week starting'])));
  const cur = m[m.length - 1] || {};
  const tiles = [['Money in the bank', cur['Cash balance']], ['Owed to you', cur['Receivables']], ['Overdue', cur['Overdue value']], ['Sales this week', cur['Revenue']]];
  const colour = /^#[0-9a-f]{3,8}$/i.test(client.invoice.brandColour) ? client.invoice.brandColour : '#1F3A5F';
  const tileHtml = tiles.map(([k, v]) => `<div style="flex:1 1 140px;background:#f8fafc;border-radius:8px;padding:12px"><div style="font-size:12px;color:#6b7280">${e(k)}</div><div style="font-size:22px;font-weight:600">${gbp(v)}</div></div>`).join('');
  const activity = [['Invoices drafted', cur['Invoices drafted']], ['Calls handled', cur['Calls handled']], ['Bookings made', cur['Bookings made']], ['Quotes issued', cur['Quotes issued']]];
  const body = `<h2 style="margin-top:0">${e(client.clientName)}: dashboard</h2>
<p style="color:#6b7280;font-size:13px">Week starting ${e(cur['Week starting'] || '-')} · ${cur['Data source'] === 'demo' || (cur['Data source'] && cur['Data source'].name === 'demo') ? 'demo data' : 'live from Xero'}</p>
<div style="display:flex;flex-wrap:wrap;gap:10px;margin:12px 0">${tileHtml}</div>
<h3>Sales by week</h3>${bars(m.slice(-8).map((r) => ({ label: String(r['Week starting'] || '').slice(5), value: Number(r['Revenue']) || 0 })), colour)}
<h3>What Keystone did this week</h3>${table(activity.map(([k, v]) => [e(k), String(v || 0)]))}
${valueLines ? `<h3>This month so far</h3>${table(valueLines.map(([k, v]) => [e(k), String(v)]))}` : ''}
${cur['Explainer email'] ? `<h3>This week in plain English</h3><div style="white-space:pre-wrap;font-size:14px">${e(cur['Explainer email'])}</div>` : ''}`;
  return shell(client, `${client.clientName} dashboard`, body);
}

function explainerEmail(client, x, dashboardUrl) {
  const li = (arr) => `<ul>${arr.map((s) => `<li>${e(s)}</li>`).join('')}</ul>`;
  const body = `<h2 style="margin-top:0">${e(x.headline)}</h2>
<h3>What changed</h3>${li(x.whatChanged)}
<h3>Why</h3>${li(x.why)}
<h3>Your top ${x.actions.length} this week</h3><ol>${x.actions.map((a) => `<li><strong>${e(a.action)}</strong>: ${e(a.reason)}</li>`).join('')}</ol>
${dashboardUrl ? `<p><a href="${e(dashboardUrl)}">Open your dashboard</a></p>` : ''}`;
  return shell(client, x.subject, body);
}

function explainerText(x) {
  return `${x.headline}\n\nWhat changed:\n${x.whatChanged.map((s) => '- ' + s).join('\n')}\n\nWhy:\n${x.why.map((s) => '- ' + s).join('\n')}\n\nTop actions:\n${x.actions.map((a, i) => `${i + 1}. ${a.action}: ${a.reason}`).join('\n')}`;
}

function valueReportEmail(client, r) {
  const body = `<h2 style="margin-top:0">Your Keystone value report: ${e(r.month)}</h2>
<p>Here's what your operations team handled for ${e(client.clientName)} this month.</p>
${table(r.lines.map(([k, v]) => [e(k), String(v)]))}
<p style="font-size:18px;margin-top:18px"><strong>${r.hoursSaved} hours</strong> of admin time saved. That's about <strong>${gbp(r.valueOfTime)}</strong> at £${r.rate}/hour.</p>
<p style="font-size:13px;color:#6b7280">Hours are estimated from standard times per task. Every action behind these numbers is logged and available on request.</p>`;
  return shell(client, `Value report ${r.month}`, body);
}

module.exports = { gbp, shell, table, invoiceDraftEmail, quoteDraftEmail, customerQuoteEmail, dashboardHtml, explainerEmail, explainerText, valueReportEmail };
