'use strict';
// The £100 Finance Ops Audit, end to end (docs/AUDIT_PLAYBOOK.md). Pure logic used by the "KS Audit Flow" workflow.
//
//  1 Stripe hold (manual capture)            -> Audit Intakes row, Status "Held", Bilal alerted
//  2 Bilal fills "Available slots"           -> client emailed from Bilal: reserved not charged, pick a time (+ recording note)
//  3 client picks a time (link)              -> "Confirmed time" logged, Bilal alerted
//  4 Bilal ticks "Confirm"                   -> £100 captured, Google Meet created, invite (.ics) emailed, intake form emailed
//    day 3 / day 5 without a confirmed call  -> chase (client if they have not picked, Bilal if he has not confirmed)
//    day 6                                   -> hold cancelled, client told nothing was charged
//  5 24h before Call 1                       -> reminder
//  6 Bilal types "Call 1 notes"            -> Opus report (notes + intake form) -> PDF -> Status "Report ready", Bilal alerted
//  7 Bilal ticks "Approve report" + fills "Call 2 slots" (3-7 days after Call 1) -> client picks -> "Confirm call 2"
//    -> Meet + invite; the report PDF is emailed 24h before Call 2
//  8 Outcome Won  -> agreement PDF + setup invoice (setup total minus the £100) ; Lost -> nurture (only with consent)
//
// Clients only ever see Keystone addresses (client_contact_email); the Google Meet lives on Keystone's Google calendar
// but the client is never added as a Google attendee (that would show the gmail); they get our own invite + .ics.
const R = require('./requests');
const P = require('./pricing');
const Tm = require('./time');
const Lg = require('./log');
const e = Lg.escapeHtml;

const BASE = 'https://keystoneconsultancy.app.n8n.cloud/webhook';
const TZ = 'Europe/London';
const DAY = 864e5;
const CALL1_MIN = 60;
const CALL2_MIN = 45;
const ACTIVE_STATUSES = ['Held', 'Slots sent', 'Time chosen', 'Call 1 booked', 'Report ready', 'Call 2 offered', 'Call 2 time chosen', 'Call 2 booked'];

const sel = (v) => (v && v.name) || v || '';
const fv = (rec, k) => ((rec && rec.fields) || {})[k];
const has = (rec, k) => { const v = fv(rec, k); return v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && !v.length); };
const contact = (S) => S.client_contact_email || 'bilal.khan@keystoneconsultancyuk.co.uk';
const firstName = (rec) => String(fv(rec, 'Contact name') || '').trim().split(/\s+/)[0] || 'there';
const randomToken = (n = 24) => { const c = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)]; return s; };

// ---------- time slots ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function fmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '').replace(/ (\d\d:\d\d)$/, ', $1');
}
const pad = (n) => String(n).padStart(2, '0');
// One line -> UTC start, or null. Accepts "2026-11-18 10:00", "18/11/2026 10:00", "Tue 18 Nov 10:00", "18 Nov 2pm", "18th November 2026 at 14:30".
function parseSlot(line, now = Date.now()) {
  const s = String(line || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let y, mo, d, hh, mm;
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ t](\d{1,2})[:.](\d{2})/);
  if (m) { [y, mo, d, hh, mm] = [m[1], m[2], m[3], m[4], m[5]].map(Number); }
  else if ((m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/))) {
    d = +m[1]; mo = +m[2]; y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null; hh = +m[4]; mm = m[5] ? +m[5] : 0;
    if (m[6] === 'pm' && hh < 12) hh += 12; if (m[6] === 'am' && hh === 12) hh = 0;
  } else if ((m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?,?\s+(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/))) {
    d = +m[1]; mo = MONTHS.indexOf(m[2]) + 1; y = m[3] ? +m[3] : null; hh = +m[4]; mm = m[5] ? +m[5] : 0;
    if (!mo) return null;
    if (m[6] === 'pm' && hh < 12) hh += 12; if (m[6] === 'am' && hh === 12) hh = 0;
  } else return null;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;
  if (!y) {
    y = new Date(now).getUTCFullYear();
    if (Tm.zonedToUtc(`${y}-${pad(mo)}-${pad(d)}`, `${pad(hh)}:${pad(mm)}`, TZ).getTime() < now - DAY) y += 1;
  }
  const start = Tm.zonedToUtc(`${y}-${pad(mo)}-${pad(d)}`, `${pad(hh)}:${pad(mm)}`, TZ);
  return isNaN(start) ? null : start.toISOString();
}
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function weekdayClash(raw, iso) {
  const m = String(raw).toLowerCase().match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (!m) return false;
  const actual = new Date(iso).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short' }).toLowerCase().slice(0, 3);
  return actual !== m[1];
}
function parseSlots(text, now = Date.now()) {
  const lines = String(text || '').split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  const slots = [], errors = [];
  for (const raw of lines) {
    const iso = parseSlot(raw, now);
    if (!iso) errors.push(`"${raw}" is not a date and time I can read`);
    else if (Date.parse(iso) < now + 2 * 3600e3) errors.push(`"${raw}" is in the past or less than 2 hours away`);
    else if (weekdayClash(raw, iso)) errors.push(`"${raw}": that date is a ${new Date(iso).toLocaleString('en-GB', { timeZone: TZ, weekday: 'long' })}`);
    else slots.push({ raw, start: iso, label: fmtWhen(iso) });
  }
  if (!lines.length) errors.push('no times found');
  return { slots: slots.slice(0, 8), errors };
}

// ---------- emails ----------
function wrap(inner) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1a1a1a;font-size:15px;line-height:1.6">${inner}
<p style="margin-top:24px">Bilal Khan<br>Keystone · Finance operations for UK businesses<br><span style="color:#777;font-size:13px">Slough, United Kingdom</span></p></div>`;
}
const para = (t) => `<p style="margin:0 0 14px">${e(t)}</p>`;
const button = (href, label) => `<a href="${e(href)}" style="display:inline-block;background:#C9A961;color:#0B0D0F;padding:11px 18px;margin:0 8px 10px 0;text-decoration:none;font-weight:bold;border-radius:4px">${e(label)}</a>`;
const pickUrl = (rec, call, i) => `${BASE}/ks-audit-pick?r=${encodeURIComponent(rec.id)}&t=${encodeURIComponent(fv(rec, 'Client token') || '')}&c=${call}&s=${i}`;
const otherUrl = (rec, call) => `${BASE}/ks-audit-pick?r=${encodeURIComponent(rec.id)}&t=${encodeURIComponent(fv(rec, 'Client token') || '')}&c=${call}&s=other`;
const prepUrl = (rec) => `${BASE}/ks-audit-prep?r=${encodeURIComponent(rec.id)}&t=${encodeURIComponent(fv(rec, 'Client token') || '')}`;

function slotsEmail(rec, slots, call, S) {
  const n = firstName(rec), biz = fv(rec, 'Business name') || 'your business';
  const intro = call === 1
    ? [`Hi ${n},`, `Thank you for booking your Finance Ops Audit for ${biz}.`, 'Your £100 is reserved, not charged. We only take it once your call time is confirmed, and if we cannot find a time it is released in full.', 'Please pick a time for our first call (about 60 minutes, on Google Meet):']
    : [`Hi ${n},`, `Your audit report for ${biz} is ready. Let's go through it together on a second call (about 45 minutes, on Google Meet).`, 'Please pick a time:'];
  const text = intro.join('\n\n') + '\n\n' + slots.map((s, i) => `- ${s.label}: ${pickUrl(rec, call, i)}`).join('\n') + `\n\nNone of these work? ${otherUrl(rec, call)}\n\nBilal Khan\nKeystone\n${contact(S)}`;
  const html = wrap(intro.map(para).join('') + `<p>${slots.map((s, i) => button(pickUrl(rec, call, i), s.label)).join('')}</p>`
    + `<p style="margin:0 0 14px"><a href="${e(otherUrl(rec, call))}">None of these work? Suggest another time</a></p>`);
  return { subject: call === 1 ? `Your Finance Ops Audit: pick a time, ${n}` : `Your audit report is ready: pick a time for call 2`, html, text };
}

function chaseEmail(rec, slots, which) {
  const n = firstName(rec);
  const lines = which === 2
    ? [`Hi ${n},`, 'A last reminder about your Finance Ops Audit. Your £100 is still only reserved, not charged.', 'If none of the times suit, tell us a better one. If we do not hear back, the hold is released tomorrow and nothing is taken.']
    : [`Hi ${n},`, 'Just checking you saw the times for your Finance Ops Audit call. Your £100 is reserved, not charged, until a time is confirmed.'];
  const text = lines.join('\n\n') + '\n\n' + slots.map((s, i) => `- ${s.label}: ${pickUrl(rec, 1, i)}`).join('\n') + `\n\nNone of these work? ${otherUrl(rec, 1)}`;
  const html = wrap(lines.map(para).join('') + (slots.length ? `<p>${slots.map((s, i) => button(pickUrl(rec, 1, i), s.label)).join('')}</p>` : '')
    + `<p><a href="${e(otherUrl(rec, 1))}">Suggest another time</a></p>`);
  return { subject: which === 2 ? 'Last reminder: your Finance Ops Audit call' : 'Your Finance Ops Audit: pick a time', html, text };
}

function releaseEmail(rec, S) {
  const lines = [`Hi ${firstName(rec)},`, 'As we could not agree a time for your Finance Ops Audit, I have cancelled the £100 hold on your card. Nothing was charged. Depending on your bank, the hold disappears from your statement within a few days.', `If you would still like the audit later, just reply to this email.`];
  return { subject: 'Your Finance Ops Audit hold has been released (nothing charged)', html: wrap(lines.map(para).join('')), text: lines.join('\n\n') + `\n\nBilal Khan\nKeystone\n${contact(S)}` };
}

function icsFor({ uid, start, minutes, title, link, attendee, organizer }) {
  const z = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(Date.parse(start) + minutes * 60000).toISOString();
  const esc = (s) => String(s).replace(/[\\,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Keystone//Finance Ops Audit//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(start)}`, `DTEND:${z(end)}`, `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc('Join on Google Meet: ' + link)}`, `LOCATION:${esc(link)}`, `URL:${link}`,
    `ORGANIZER;CN=Bilal Khan (Keystone):mailto:${organizer}`, ...(attendee ? [`ATTENDEE;CN=${esc(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT:mailto:${attendee.email}`] : []),
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Keystone call in 30 minutes', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
const b64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s))));

function inviteEmail(rec, { call, start, link, eventId }, S) {
  const n = firstName(rec), when = fmtWhen(start), minutes = call === 1 ? CALL1_MIN : CALL2_MIN;
  const title = call === 1 ? 'Keystone Finance Ops Audit: call 1 (discovery)' : 'Keystone Finance Ops Audit: call 2 (your report)';
  const lines = call === 1
    ? [`Hi ${n},`, `You're booked: ${when} (UK time), about 60 minutes on Google Meet. The calendar invite is attached.`, 'Your £100 audit fee has now been taken. It is credited against setup if you go ahead within 30 days.', 'To make the call count, please fill in the short intake form before we speak (5 minutes):']
    : [`Hi ${n},`, `You're booked: ${when} (UK time), about 45 minutes on Google Meet. The calendar invite is attached.`, 'I will email your audit report the day before, so you have time to read it.'];
  const ics = icsFor({ uid: `${eventId || randomToken(12)}@keystone`, start, minutes, title, link, attendee: { email: fv(rec, 'Contact email'), name: fv(rec, 'Contact name') }, organizer: contact(S) });
  const text = lines.join('\n\n') + (call === 1 ? `\n\n${prepUrl(rec)}` : '') + `\n\nJoin: ${link}`;
  const html = wrap(lines.map(para).join('') + (call === 1 ? `<p>${button(prepUrl(rec), 'Fill in the intake form')}</p>` : '') + `<p>${button(link, 'Join on Google Meet')}</p>`);
  return { subject: `Confirmed: ${title.replace('Keystone ', '')} on ${when}`, html, text, attachments: [{ filename: 'keystone-call.ics', content: b64(ics), content_type: 'text/calendar' }] };
}

function reminderEmail(rec, { call, start, link }) {
  const lines = [`Hi ${firstName(rec)},`, `A reminder: our ${call === 1 ? 'Finance Ops Audit call' : 'call to go through your report'} is tomorrow, ${fmtWhen(start)} (UK time), on Google Meet.`];
  if (call === 1 && !has(rec, 'Intake form done at')) lines.push('If you have not had a chance yet, the 5-minute intake form helps a lot: ' + prepUrl(rec));
  return { subject: `Tomorrow: your Keystone call at ${fmtWhen(start).split(', ')[1]}`, html: wrap(lines.map(para).join('') + `<p>${button(link, 'Join on Google Meet')}</p>`), text: lines.join('\n\n') + `\n\nJoin: ${link}` };
}

function reportEmail(rec, pdfUrl) {
  const lines = [`Hi ${firstName(rec)},`, `Attached is your Finance Ops Audit report for ${fv(rec, 'Business name') || 'your business'}, ahead of our call tomorrow (${fmtWhen(fv(rec, 'Call 2 at'))}).`, 'It shows what we found, what it is costing you each year, and exactly what we would recommend and what it costs. Bring any questions to the call.'];
  return { subject: 'Your Finance Ops Audit report', html: wrap(lines.map(para).join('') + (fv(rec, 'Call 2 Meet link') ? `<p>${button(fv(rec, 'Call 2 Meet link'), 'Join call 2 on Google Meet')}</p>` : '')), text: lines.join('\n\n'),
    attachments: [{ filename: `Keystone audit report - ${String(fv(rec, 'Business name') || 'report').replace(/[^\w\s-]/g, '')}.pdf`, path: pdfUrl }] };
}

// ---------- the report (Opus) ----------
const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'findings', 'hours_lost_per_year', 'money_lost_per_year_gbp', 'recommended_services', 'why_these', 'quick_wins'],
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['area', 'problem', 'evidence', 'hours_per_year', 'gbp_per_year'], properties: {
      area: { type: 'string', enum: ['invoicing', 'calls', 'quotes', 'reporting', 'other'] }, problem: { type: 'string' }, evidence: { type: 'string' },
      hours_per_year: { type: 'number' }, gbp_per_year: { type: 'number' } } } },
    hours_lost_per_year: { type: 'number' }, money_lost_per_year_gbp: { type: 'number' },
    recommended_services: { type: 'array', items: { type: 'string', enum: ['invoicing', 'phone', 'quotes', 'reporting'] } },
    why_these: { type: 'string' }, quick_wins: { type: 'array', items: { type: 'string' } },
  },
};
const REPORT_SYSTEM = `You are Keystone's senior finance-operations auditor (UK, small and mid-sized service businesses). Write the findings for a Finance Ops Audit report from Bilal's notes from Call 1 (the discovery call) and the client's intake form.
Rules:
- Only use facts in Bilal's notes or the intake form. Paraphrase the evidence for each finding and say where it came from (call notes or intake form). The notes may be brief or in shorthand: read them sensibly, but never fill gaps with guesses. Never invent numbers: where you estimate, show the working in "evidence" (e.g. "about 6 hours a week x 52 = 312 hours").
- Money lost = hours x their stated hourly cost, or £19.67/hour (ONS UK median full-time pay, April 2025) if they gave none, plus cash effects they described (missed jobs, late payments, errors).
- Recommend only from Keystone's four services: invoicing (Invoice Automation), phone (AI Phone Booking), quotes (Quote Calculator), reporting (Reporting Dashboard). Recommend a service only if a finding supports it.
- Do not quote prices: Keystone's code adds the exact price from the approved price list.
- Plain British English, short sentences, no jargon. The client is a busy business owner.`;
function reportPrompt(rec) {
  return `Business: ${fv(rec, 'Business name') || ''}\nIndustry: ${fv(rec, 'Industry') || ''}\nRevenue band: ${sel(fv(rec, 'Revenue band')) || 'unknown'}\nTeam size: ${fv(rec, 'Team size') || 'unknown'}\nTools: ${fv(rec, 'Tools used') || 'unknown'}\nTop 3 manual tasks: ${fv(rec, 'Top 3 manual tasks') || 'unknown'}\nAdmin hours per week: ${fv(rec, 'Admin hours per week') || 'unknown'}\n\nBilal's notes from Call 1:\n${String(fv(rec, 'Call 1 notes') || '').slice(0, 60000)}`;
}
const BAND_FIELD = { 'Under £500k': 'under500k', '£500k–£1M': '500k-1m', '£1M–£3M': '1m-3m', '£3M–£10M': '3m-10m', 'Over £10M': 'over10m' };
function quoteFor(services, revenueBand, lossPerYear) {
  const p = P.priceProposal(services, { revenue: BAND_FIELD[revenueBand] || revenueBand, monthlyLoss: (Number(lossPerYear) || 0) / 12 });
  const credit = P.PRICING.audit.paid;
  return { ...p, auditCredit: credit, setupAfterCredit: Math.max(0, Math.round((p.setup.total - credit) * 100) / 100) };
}
const gbp = (n) => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB');
function reportHtml(rec, r, q) {
  const rows = (r.findings || []).map((f) => `<tr><td style="padding:6px;border-bottom:1px solid #ddd">${e(f.problem)}<br><span style="color:#666;font-size:12px">${e(f.evidence)}</span></td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right">${Math.round(f.hours_per_year)}</td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right">${gbp(f.gbp_per_year)}</td></tr>`).join('');
  const lines = q.setup.lines.map((l) => `<tr><td style="padding:6px">${e(l.name)} setup</td><td style="padding:6px;text-align:right">${gbp(l.fee)}</td></tr>`).join('');
  return `<html><body style="font-family:Arial,sans-serif;color:#1a1a1a;font-size:12pt;line-height:1.5">
<h1 style="color:#1F3A5F">Finance Ops Audit</h1><p><b>${e(fv(rec, 'Business name') || '')}</b> · prepared by Keystone · ${e(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>
<h2>Summary</h2><p>${e(r.summary)}</p>
<p><b>What this is costing you: about ${Math.round(r.hours_lost_per_year)} hours and ${gbp(r.money_lost_per_year_gbp)} a year.</b></p>
<h2>What we found</h2><table style="border-collapse:collapse;width:100%"><tr><th style="text-align:left;padding:6px">Problem</th><th style="padding:6px">Hours/year</th><th style="padding:6px">£/year</th></tr>${rows}</table>
<h2>What we recommend</h2><p>${e(r.why_these)}</p>
<h2>Your price</h2><table style="border-collapse:collapse;width:100%">${lines}
${q.setup.discountPct ? `<tr><td style="padding:6px">Multi-service discount (${q.setup.discountPct}%)</td><td style="padding:6px;text-align:right">-${gbp(q.setup.gross - q.setup.total)}</td></tr>` : ''}
<tr><td style="padding:6px">Audit fee credited</td><td style="padding:6px;text-align:right">-${gbp(q.auditCredit)}</td></tr>
<tr><td style="padding:6px"><b>One-off setup</b></td><td style="padding:6px;text-align:right"><b>${gbp(q.setupAfterCredit)}</b></td></tr>
<tr><td style="padding:6px"><b>${e(q.package.name)} package, monthly</b> (${e(q.package.includes)})</td><td style="padding:6px;text-align:right"><b>${gbp(q.package.price)}/month</b></td></tr></table>
<p style="font-size:10pt;color:#555">${e(q.terms)} The £100 credit applies if you go ahead within 30 days. Prices from Keystone's published price list; no VAT is charged.</p>
${(r.quick_wins || []).length ? `<h2>Quick wins you can do this week</h2><ul>${r.quick_wins.map((w) => `<li>${e(w)}</li>`).join('')}</ul>` : ''}
<p style="font-size:10pt;color:#555">Figures are estimates based on what you told us on the call and in the intake form.</p></body></html>`;
}

// ---------- agreement ----------
function mdToHtml(md) {
  const out = []; let list = false;
  const inline = (t) => e(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  for (const raw of String(md).split('\n')) {
    const l = raw.trimEnd();
    if (/^\s*[-*] /.test(l)) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inline(l.replace(/^\s*[-*] /, '')) + '</li>'); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (/^#{1,6} /.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n}>${inline(l.replace(/^#+ /, ''))}</h${n}>`); }
    else if (/^---+$/.test(l)) out.push('<hr>');
    else if (/^\|/.test(l)) out.push('<p style="font-family:monospace;font-size:10pt">' + inline(l) + '</p>');
    else if (l.trim()) out.push('<p>' + inline(l.replace(/^> ?/, '')) + '</p>');
  }
  if (list) out.push('</ul>');
  return out.join('\n');
}
function agreementHtml(rec, q, md) {
  const body = String(md)
    .replace(/^# DRAFT[^\n]*\n(?:>[^\n]*\n|\s*\n)*/m, '')
    .split('[Client legal name]').join(fv(rec, 'Business name') || '[Client legal name]')
    .split('[date]').join(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
  const sched = `\n\n## Your services and fees (from your audit)\n\n- Services: ${q.setup.lines.map((l) => l.name).join(', ')}\n- One-off setup: ${gbp(q.setup.total)} (after ${q.setup.discountPct}% multi-service discount), less the £100 audit fee = **${gbp(q.setupAfterCredit)}**\n- Monthly: **${q.package.name} package, ${gbp(q.package.price)}/month**\n- ${q.terms}\n`;
  return `<html><body style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.5">${mdToHtml(body + sched)}</body></html>`;
}

// ---------- the decision: what to do next for one record ----------
// trigger: 'event' (Airtable automation / Bilal's tick) or 'schedule' (every 2 hours, 09:05-19:05).
function decide(rec, S = {}, now = Date.now(), trigger = 'schedule') {
  const pay = sel(fv(rec, 'Payment status'));
  const st = sel(fv(rec, 'Status'));
  const age = has(rec, 'Hold placed at') ? (now - Date.parse(fv(rec, 'Hold placed at'))) / DAY : 0;
  const ctx = { id: rec.id };
  const local = (step, extra) => ({ route: 'local', step, ctx: { ...ctx, ...extra } });

  if (pay === 'Held') {
    // Bilal ticked Confirm: capture + Meet + invite.
    if (fv(rec, 'Confirm') === true) {
      const iso = fv(rec, 'Confirmed time at') || parseSlot(fv(rec, 'Confirmed time'), now);
      if (!iso) return trigger === 'event' ? local('note', { text: `Confirm ticked for ${fv(rec, 'Business name')}, but there is no confirmed time I can read yet ("${fv(rec, 'Confirmed time') || 'blank'}"). Put the time in "Confirmed time at", then tick Confirm again.` }) : null;
      return { route: 'confirm1', step: 'confirm1', ctx: { ...ctx, start: iso, pi: fv(rec, 'Payment intent ID') } };
    }
    if (age >= 6) return { route: 'stripe', step: 'release', ctx: { ...ctx, pi: fv(rec, 'Payment intent ID'), req: stripeReq('POST', `/v1/payment_intents/${fv(rec, 'Payment intent ID')}/cancel`) } };
    if (has(rec, 'Available slots') && !has(rec, 'Slots emailed at')) {
      const p = parseSlots(fv(rec, 'Available slots'), now);
      if (p.errors.length || !p.slots.length) return trigger === 'event' ? local('note', { text: `Slots for ${fv(rec, 'Business name')} not sent: ${p.errors.join('; ')}. Write one time per line, e.g. "Tue 18 Nov 10:00".` }) : null;
      return local('slots1', { slots: p.slots });
    }
    if (trigger === 'schedule') {
      const slots = parseSlots(fv(rec, 'Available slots'), now).slots;
      if (age >= 5 && !has(rec, 'Chase 2 sent at')) return local('chase', { which: 2, slots });
      if (age >= 3 && !has(rec, 'Chase 1 sent at')) return local('chase', { which: 1, slots });
    }
    return null;
  }
  if (pay !== 'Captured' || ['Won', 'Lost'].includes(st) && has(rec, 'Outcome done at')) return null;

  const outcome = sel(fv(rec, 'Outcome'));
  if (outcome && !has(rec, 'Outcome done at')) {
    if (outcome === 'Lost') return local('lost');
    if (S.agreement_approved !== 'yes') return trigger === 'event' ? local('note', { text: `Outcome Won for ${fv(rec, 'Business name')}: nothing sent yet, because the client agreement has not been solicitor-checked. Set Keystone Settings > agreement_approved = yes, then set Outcome again.` }) : null;
    if (!S.keystone_xero_tenant_id) return trigger === 'event' ? local('note', { text: `Outcome Won for ${fv(rec, 'Business name')}: add Keystone's Xero organisation ID in Keystone Settings > keystone_xero_tenant_id so I can raise the setup invoice, then set Outcome again.` }) : null;
    return { route: 'won', step: 'won', ctx: { ...ctx, tenantId: S.keystone_xero_tenant_id } };
  }
  const call1 = fv(rec, 'Call 1 at');
  if (call1 && !fv(rec, 'Call 1 reminder sent') && Date.parse(call1) > now && Date.parse(call1) - now <= 28 * 3600e3) return local('remind', { call: 1, start: call1, link: fv(rec, 'Call 1 Meet link') });
  if (has(rec, 'Call 1 notes') && !has(rec, 'Report JSON')) return { route: 'report', step: 'report', ctx };
  if (fv(rec, 'Approve report') === true && has(rec, 'Report PDF')) {
    if (has(rec, 'Call 2 slots') && !has(rec, 'Call 2 slots emailed at')) {
      const p = parseSlots(fv(rec, 'Call 2 slots'), now);
      const c1 = Date.parse(call1 || 0);
      const outside = p.slots.filter((s) => { const d = (Date.parse(s.start) - c1) / DAY; return d < 3 || d > 7.99; });
      if (p.errors.length || !p.slots.length || outside.length) return trigger === 'event' ? local('note', { text: `Call 2 slots for ${fv(rec, 'Business name')} not sent: ${p.errors.concat(outside.map((s) => s.label + ' is not 3-7 days after Call 1')).join('; ')}.` }) : null;
      return local('slots2', { slots: p.slots });
    }
    if (fv(rec, 'Confirm call 2') === true && !has(rec, 'Call 2 event ID')) {
      const iso = fv(rec, 'Call 2 confirmed at') || parseSlot(fv(rec, 'Call 2 confirmed time'), now);
      if (!iso) return trigger === 'event' ? local('note', { text: `Confirm call 2 ticked for ${fv(rec, 'Business name')}, but there is no Call 2 time I can read yet.` }) : null;
      return { route: 'gcal', step: 'confirm2', ctx: { ...ctx, start: iso, req: meetReq(rec, iso, 2) } };
    }
    const call2 = fv(rec, 'Call 2 at');
    if (call2 && !has(rec, 'Report sent at') && Date.parse(call2) > now && Date.parse(call2) - now <= 28 * 3600e3) return local('sendReport');
    if (call2 && Date.parse(call2) > now && Date.parse(call2) - now <= 28 * 3600e3 && has(rec, 'Report sent at') && !String(fv(rec, 'Flow log') || '').includes('Call 2 reminder')) return local('remind', { call: 2, start: call2, link: fv(rec, 'Call 2 Meet link') });
  }
  return null;
}

// ---------- outside calls ----------
function stripeReq(method, path) { return { method, url: 'https://api.stripe.com' + path }; }
function meetReq(rec, start, call) {
  const minutes = call === 1 ? CALL1_MIN : CALL2_MIN;
  return R.gcal('primary', 'POST', 'events?conferenceDataVersion=1&sendUpdates=none', {
    summary: `${call === 1 ? 'Audit call 1' : 'Audit call 2 (report)'}: ${fv(rec, 'Business name') || ''}`,
    description: `Keystone Finance Ops Audit with ${fv(rec, 'Contact name') || ''} (${fv(rec, 'Contact email') || ''}). The client got their own invite from Keystone; they are not a Google attendee on purpose. Airtable record ${rec.id}.`,
    start: { dateTime: start, timeZone: TZ }, end: { dateTime: new Date(Date.parse(start) + minutes * 60000).toISOString(), timeZone: TZ },
    conferenceData: { createRequest: { requestId: `ks-${rec.id}-${call}-${Date.parse(start)}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
  });
}

// ---------- apply: turn a step (+ outside-call results) into writes, emails and notices ----------
function logLine(rec, text) { return (new Date().toISOString().slice(0, 16).replace('T', ' ') + ' ' + text + '\n' + String(fv(rec, 'Flow log') || '')).slice(0, 20000); }
function apply(step, rec, ctx, S = {}, res = {}) {
  const biz = fv(rec, 'Business name') || 'a client';
  const to = [fv(rec, 'Contact email')].filter(Boolean);
  const fields = {}; const emails = []; const notices = []; const extra = []; let log = '';
  const mail = (m, sender = 'personal') => { if (to.length) emails.push(R.email({ sender, from: R.EMAIL_FROM, to, subject: m.subject, html: m.html, text: m.text, ...(m.attachments ? {} : {}) })); if (m.attachments) emails[emails.length - 1].body.attachments = m.attachments; };
  const tell = (text, kind = 'info') => notices.push({ kind, audience: 'bilal', clientName: biz, text });
  const now = new Date().toISOString();

  switch (step) {
    case 'note': tell(ctx.text, 'failure'); log = 'Note: ' + ctx.text.slice(0, 200); break;
    case 'slots1': mail(slotsEmail(rec, ctx.slots, 1, S)); Object.assign(fields, { 'Slots emailed at': now, 'Status': 'Slots sent' }); log = 'Call 1 times emailed: ' + ctx.slots.map((s) => s.label).join(' | '); break;
    case 'slots2': mail(slotsEmail(rec, ctx.slots, 2, S)); Object.assign(fields, { 'Call 2 slots emailed at': now, 'Status': 'Call 2 offered' }); log = 'Call 2 times emailed: ' + ctx.slots.map((s) => s.label).join(' | '); break;
    case 'chase': {
      const field = ctx.which === 2 ? 'Chase 2 sent at' : 'Chase 1 sent at';
      fields[field] = now;
      if (!has(rec, 'Slots emailed at')) { tell(`Day ${ctx.which === 2 ? 5 : 3} for ${biz}'s £100 hold and no call times have been sent yet. Fill "Available slots" in Audit Intakes. The hold is released on day 6.`, 'failure'); log = `Chase ${ctx.which}: reminded Bilal to send times`; }
      else if (has(rec, 'Confirmed time')) { tell(`${biz} picked "${fv(rec, 'Confirmed time')}" but it is not confirmed yet (day ${ctx.which === 2 ? 5 : 3}). Tick Confirm in Audit Intakes, or the hold is released on day 6.`, 'failure'); log = `Chase ${ctx.which}: reminded Bilal to confirm`; }
      else { mail(chaseEmail(rec, ctx.slots, ctx.which)); log = `Chase ${ctx.which} emailed to the client`; }
      break;
    }
    case 'release': {
      const ok = res.statusCode < 300 || /already been canceled|status of canceled/.test(JSON.stringify(res.body || {}));
      if (!ok) { tell(`Could not release the £100 hold for ${biz} (Stripe ${res.statusCode}: ${((res.body || {}).error || {}).message || ''}). Check Stripe > Payments.`, 'failure'); log = 'Release failed'; break; }
      mail(releaseEmail(rec, S)); Object.assign(fields, { 'Payment status': 'Released', 'Status': 'Hold released', 'Hold released at': now });
      tell(`Day 6: released the £100 hold for ${biz} (no time was confirmed). They were told nothing was charged.`); log = 'Hold released (day 6)'; break;
    }
    case 'confirm1_failed': {
      const msg = ((res.body || {}).error || {}).message || ('Stripe ' + res.statusCode);
      Object.assign(fields, { 'Payment status': 'Capture failed', 'Confirm': false });
      tell(`Could not take the £100 for ${biz}: ${msg}. Nothing was booked. Check Stripe; the hold may have expired.`, 'failure'); log = 'Capture failed: ' + msg; break;
    }
    case 'confirm1':
    case 'confirm2': {
      const call = step === 'confirm1' ? 1 : 2;
      const ev = res.body || {};
      const link = ev.hangoutLink || ((((ev.conferenceData || {}).entryPoints) || []).find((x) => x.entryPointType === 'video') || {}).uri;
      if (call === 1) Object.assign(fields, { 'Payment status': 'Captured' });
      if (!(res.statusCode < 300) || !link) {
        tell(`${call === 1 ? '£100 taken for ' + biz + ', but the' : 'The'} Google Meet for call ${call} could not be created (${res.statusCode}). Create it by hand and send the link from bilal.khan@.`, 'failure');
        log = `Call ${call}: Meet not created (${res.statusCode})`; break;
      }
      mail(inviteEmail(rec, { call, start: ctx.start, link, eventId: ev.id }, S));
      if (call === 1) Object.assign(fields, { 'Status': 'Call 1 booked', 'Call 1 at': ctx.start, 'Call 1 Meet link': link, 'Call 1 event ID': ev.id, 'Intake form sent at': now });
      else Object.assign(fields, { 'Status': 'Call 2 booked', 'Call 2 at': ctx.start, 'Call 2 Meet link': link, 'Call 2 event ID': ev.id });
      tell(`Call ${call} booked for ${biz}: ${fmtWhen(ctx.start)}.${call === 1 ? ' £100 taken; invite and intake form emailed.' : ' Invite emailed; the report goes out 24h before.'} Meet: ${link}`);
      log = `Call ${call} booked ${fmtWhen(ctx.start)}`; break;
    }
    case 'remind': {
      mail(reminderEmail(rec, ctx), 'operations');
      if (ctx.call === 1) fields['Call 1 reminder sent'] = true;
      log = `Call ${ctx.call} reminder sent`; break;
    }
    case 'sendReport': {
      const pdf = (fv(rec, 'Report PDF') || [])[0];
      if (!pdf || !pdf.url) { tell(`Report for ${biz} could not be emailed: no PDF in Audit Intakes > Report PDF.`, 'failure'); log = 'Report not sent: no PDF'; break; }
      mail(reportEmail(rec, pdf.url)); fields['Report sent at'] = now; log = 'Report emailed (24h before call 2)'; break;
    }
    case 'report': {
      Object.assign(fields, { 'Report JSON': JSON.stringify(ctx.report), 'Report ready at': now, 'Status': 'Report ready' });
      tell(`Audit report ready for ${biz}: about ${Math.round(ctx.report.findings.hours_lost_per_year)} hours and ${gbp(ctx.report.findings.money_lost_per_year_gbp)} a year lost; recommended ${ctx.report.quote.setup.lines.map((l) => l.name).join(', ')}: setup ${gbp(ctx.report.quote.setupAfterCredit)} after the £100 credit + ${ctx.report.quote.package.name} ${gbp(ctx.report.quote.package.price)}/month.${ctx.report.quote.senseCheck.ok === false ? ' WARNING: the monthly fee is more than a third of the monthly loss found (sense check).' : ''} Read the PDF in Audit Intakes, then tick "Approve report" and fill "Call 2 slots".`);
      log = 'Report ready'; break;
    }
    case 'report_failed': tell(`The Opus audit report for ${biz} failed (${ctx.error}). Check "Call 1 notes", then run it again by clearing "Report JSON" (or editing the notes).`, 'failure'); fields['Report JSON'] = ''; log = 'Report failed: ' + ctx.error; break;
    case 'won': {
      const r = ctx.report, inv = ctx.invoice || {};
      const agreement = (fv(rec, 'Agreement PDF') || [])[0] || ctx.agreementAttachment;
      const welcome = [`Hi ${firstName(rec)},`, 'Thank you for choosing Keystone. Attached is our client agreement with your services and prices filled in. Please read it, sign and send it back by replying to this email.', `Your setup invoice (${gbp(r.quote.setupAfterCredit)}, with your £100 audit fee already taken off) comes separately from Keystone Accounts.`];
      if (to.length) {
        emails.push(R.email({ sender: 'personal', from: R.EMAIL_FROM, to, subject: 'Welcome to Keystone: your agreement', html: wrap(welcome.map(para).join('')), text: welcome.join('\n\n') }));
        if (agreement && agreement.url) emails[emails.length - 1].body.attachments = [{ filename: 'Keystone client agreement.pdf', path: agreement.url }];
        const il = [`Hello,`, `Please find your Keystone setup invoice ${inv.number || ''} for ${gbp(r.quote.setupAfterCredit)} (setup ${gbp(r.quote.setup.total)} less your £100 audit fee).`, inv.url ? 'View and pay online: ' + inv.url : 'The invoice is attached.', 'Thank you,\nKeystone Accounts'];
        emails.push(R.email({ sender: 'accounts', from: R.EMAIL_FROM, to, subject: `Keystone setup invoice ${inv.number || ''}`.trim(), html: wrap(il.map(para).join('') + (inv.url ? `<p>${button(inv.url, 'View and pay your invoice')}</p>` : '')), text: il.join('\n\n') }));
      }
      Object.assign(fields, { 'Status': 'Won', 'Outcome done at': now, 'Setup invoice': inv.number || '' });
      tell(`Won: ${biz}. Agreement emailed and setup invoice ${inv.number || '(check Xero)'} for ${gbp(r.quote.setupAfterCredit)} sent.`);
      log = 'Won: agreement + invoice sent'; break;
    }
    case 'won_failed': tell(`Won for ${biz}, but ${ctx.error}. Nothing was sent to the client.`, 'failure'); log = 'Won failed: ' + ctx.error; break;
    case 'lost': {
      Object.assign(fields, { 'Status': 'Lost', 'Outcome done at': now });
      if (fv(rec, 'Marketing consent') === true) {
        extra.push(R.write.airtable({ method: 'PATCH', url: 'https://api.airtable.com/v0/' + AIRTABLE_BASE() + '/' + PROSPECTS(), body: { performUpsert: { fieldsToMergeOn: ['Email'] }, typecast: true, records: [{ fields: {
          'Email': String(fv(rec, 'Contact email') || '').toLowerCase(), 'Company': biz, 'Contact name': fv(rec, 'Contact name') || '', 'Source': 'Audit', 'Status': 'Audit - lost',
          'Marketing consent': true, 'Nurture status': 'Active', 'Nurture step': 0, 'Signed up at': now, 'Unsubscribe token': randomToken(32), 'Audit offer': '£100', 'Revenue band': sel(fv(rec, 'Revenue band')) || undefined } }] } }));
        tell(`Lost: ${biz}. They agreed to emails on the intake form, so they now get the nurture emails.`); log = 'Lost: added to nurture'; }
      else { tell(`Lost: ${biz}. Not added to nurture emails: they did not tick the consent box on the intake form.`); log = 'Lost: no consent, no nurture'; }
      break;
    }
    default: break;
  }
  if (log) fields['Flow log'] = logLine(rec, log);
  const writes = [];
  if (Object.keys(fields).length) writes.push(R.write.airtable(R.airtableUpdate(AIRTABLE_BASE(), AUDIT_TABLE(), [{ id: rec.id, fields }])));
  for (const m of emails) writes.push(R.write.email(m));
  writes.push(...extra);
  return { writes, notices, log };
}
// Table ids come from config at runtime (n8n code nodes have AIRTABLE in scope; tests pass them in).
let _AT = null;
function setAirtable(at) { _AT = at; }
const AIRTABLE_BASE = () => (_AT || (typeof AIRTABLE !== 'undefined' ? AIRTABLE : {})).baseId;
const PROSPECTS = () => ((_AT || (typeof AIRTABLE !== 'undefined' ? AIRTABLE : {})).tables || {}).prospects;
const AUDIT_TABLE = () => ((_AT || (typeof AIRTABLE !== 'undefined' ? AIRTABLE : {})).tables || {}).auditIntakes;

// ---------- Stripe: a paid (held) checkout -> Audit Intakes ----------
// session: Checkout Session object; existing: Audit Intakes rows with the same email.
function fromCheckout(session, S, existing = []) {
  if (!session || session.object !== 'checkout.session') return { ignore: 'not a checkout session' };
  if (S.audit_payment_link_id && session.payment_link !== S.audit_payment_link_id) return { ignore: 'another payment link' };
  const ci = session.collected_information || {};
  const cd = session.customer_details || {};
  const email = String(cd.email || '').toLowerCase();
  const name = ci.individual_name || cd.name || '';
  const business = ci.business_name || cd.business_name || name;
  const piObj = session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent : null;
  const pi = piObj ? piObj.id : session.payment_intent;
  if (!pi) return { ignore: 'no payment intent' };
  if (piObj && piObj.status !== 'requires_capture') return { ignore: 'payment intent is ' + piObj.status + ', not a hold' };
  if (session.status !== 'complete') return { ignore: 'session not complete' };
  const now = new Date().toISOString();
  const fields = { 'Payment status': 'Held', 'Status': 'Held', 'Payment intent ID': pi, 'Checkout session ID': session.id, 'Hold placed at': now, 'Client token': randomToken(24),
    'Contact email': email, 'Contact name': name, 'Business name': business };
  const open = existing.find((r) => !has(r, 'Payment intent ID'));
  const dup = existing.find((r) => fv(r, 'Payment intent ID') === pi);
  if (dup) return { ignore: 'already recorded' };
  return { fields, recordId: open ? open.id : null,
    notice: { kind: 'info', audience: 'bilal', clientName: business, text: `£100 audit hold placed by ${name} (${business}, ${email}). Nothing is charged yet. Next: fill "Available slots" in Audit Intakes (one time per line) and they are emailed straight away. If no time is confirmed by day 6, the hold is released.` } };
}

// ---------- client pages ----------
function page(title, inner) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title>
<div style="font-family:Arial,sans-serif;max-width:560px;margin:48px auto;padding:20px;color:#1a1a1a;line-height:1.55"><h2 style="color:#1F3A5F">Keystone</h2>${inner}</div>`;
}
function pickPage(rec, call, s, slots, S) {
  const field = call === 2 ? 'Call 2 confirmed time' : 'Confirmed time';
  if (has(rec, field) && s !== 'other') return page('Time chosen', `<p>Thank you. We have your time: <b>${e(fv(rec, field))}</b>. Bilal will confirm by email shortly.</p><p>Need to change it? Email ${e(contact(S))}.</p>`);
  const t = e(fv(rec, 'Client token') || '');
  const hidden = `<input type="hidden" name="r" value="${e(rec.id)}"><input type="hidden" name="t" value="${t}"><input type="hidden" name="c" value="${call}">`;
  const action = `${BASE}/ks-audit-pick-submit`;
  if (s === 'other') return page('Suggest a time', `<form method="post" action="${action}">${hidden}<input type="hidden" name="s" value="other"><p>Which days and times suit you? (UK time)</p><textarea name="text" rows="3" style="width:100%"></textarea><p><button style="background:#C9A961;border:0;padding:11px 18px;font-weight:bold;border-radius:4px">Send</button></p></form>`);
  const slot = slots[Number(s)];
  if (!slot) return page('Not found', '<p>That time is no longer available. Please use the latest email from Bilal, or reply to it.</p>');
  return page('Confirm your time', `<form method="post" action="${action}">${hidden}<input type="hidden" name="s" value="${Number(s)}"><p>Book <b>${e(slot.label)}</b> (UK time) for your ${call === 1 ? 'Finance Ops Audit call' : 'report call'}?</p><p><button style="background:#C9A961;border:0;padding:11px 18px;font-weight:bold;border-radius:4px">Yes, book this time</button></p></form>`);
}
// POST from the pick page -> fields + notice.
function pickSubmit(rec, body, now = Date.now()) {
  const call = String(body.c) === '2' ? 2 : 1;
  const f = call === 2 ? { time: 'Call 2 confirmed time', at: 'Call 2 confirmed at', status: 'Call 2 time chosen' } : { time: 'Confirmed time', at: 'Confirmed time at', status: 'Time chosen' };
  const fields = {}; const biz = fv(rec, 'Business name') || 'A client';
  if (body.s === 'other') {
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return { error: 'Please tell us which days and times suit you.' };
    fields[f.time] = 'Suggested: ' + text;
    return { fields, notice: { kind: 'info', audience: 'bilal', clientName: biz, text: `${biz} cannot do the call ${call} times offered and suggested: "${text}". Put the agreed time in "${f.at}" and tick ${call === 1 ? 'Confirm' : 'Confirm call 2'}.` }, message: 'Thank you. Bilal will come back to you shortly with a time.' };
  }
  const slots = parseSlots(fv(rec, call === 2 ? 'Call 2 slots' : 'Available slots'), now).slots;
  const slot = slots[Number(body.s)];
  if (!slot) return { error: 'That time is no longer available.' };
  Object.assign(fields, { [f.time]: slot.label, [f.at]: slot.start, Status: f.status });
  return { fields, notice: { kind: 'info', audience: 'bilal', clientName: biz, text: `${biz} picked ${slot.label} for call ${call}. Tick "${call === 1 ? 'Confirm' : 'Confirm call 2'}" in Audit Intakes to ${call === 1 ? 'take the £100 and send the Meet invite' : 'send the Meet invite'}.` }, message: `Thank you, ${slot.label} is requested. Bilal will confirm by email shortly.` };
}

const BANDS = ['Under £500k', '£500k–£1M', '£1M–£3M', '£3M–£10M', 'Over £10M'];
function prepPage(rec) {
  if (has(rec, 'Intake form done at')) return page('Thank you', '<p>Thank you, we already have your answers. See you on the call.</p>');
  const v = (k) => e(fv(rec, k) || '');
  const band = sel(fv(rec, 'Revenue band'));
  const input = 'style="width:100%;padding:8px;margin:4px 0 14px;box-sizing:border-box"';
  return page('Audit intake form', `<p>5 minutes, so our call is about your business, not form-filling.</p><form method="post" action="${BASE}/ks-audit-prep-submit">
<input type="hidden" name="r" value="${e(rec.id)}"><input type="hidden" name="t" value="${v('Client token')}">
<label>Which tools do you use? (accounts, job software, phone, quotes, spreadsheets)<textarea name="tools" rows="3" ${input}>${v('Tools used')}</textarea></label>
<label>How many people work in the business?<input name="team" ${input} value="${v('Team size')}"></label>
<label>Annual revenue<select name="band" ${input}>${BANDS.map((b) => `<option${b === band ? ' selected' : ''}>${e(b)}</option>`).join('')}</select></label>
<label>Your top 3 manual tasks (the ones that eat the most time)<textarea name="tasks" rows="4" ${input}>${v('Top 3 manual tasks')}</textarea></label>
<label>Roughly how many hours a week go on admin? (everyone together)<input name="hours" type="number" min="0" step="0.5" ${input} value="${v('Admin hours per week')}"></label>
<label><input type="checkbox" name="consent" value="1"> Keystone may email me useful tips and offers. I can unsubscribe at any time.</label>
<p><button style="background:#C9A961;border:0;padding:11px 18px;font-weight:bold;border-radius:4px">Send my answers</button></p></form>`);
}
function prepSubmit(rec, b) {
  const hours = Number(b.hours);
  const fields = { 'Tools used': String(b.tools || '').slice(0, 3000), 'Team size': String(b.team || '').slice(0, 100), 'Top 3 manual tasks': String(b.tasks || '').slice(0, 3000),
    ...(BANDS.includes(b.band) ? { 'Revenue band': b.band } : {}), ...(hours >= 0 && hours < 1000 ? { 'Admin hours per week': hours } : {}),
    'Marketing consent': String(b.consent) === '1', 'Intake form done at': new Date().toISOString() };
  return { fields, notice: { kind: 'info', audience: 'bilal', clientName: fv(rec, 'Business name'), text: `${fv(rec, 'Business name')} filled in the audit intake form: ${fields['Admin hours per week'] ?? '?'} admin hours a week; top tasks: ${String(b.tasks || '').replace(/\s+/g, ' ').slice(0, 200)}` } };
}

module.exports = { BASE, TZ, CALL1_MIN, CALL2_MIN, ACTIVE_STATUSES, REPORT_SCHEMA, REPORT_SYSTEM, BANDS,
  parseSlot, parseSlots, fmtWhen, decide, apply, setAirtable, fromCheckout, quoteFor, reportPrompt, reportHtml, agreementHtml, mdToHtml,
  stripeReq, meetReq, icsFor, slotsEmail, chaseEmail, releaseEmail, inviteEmail, reminderEmail, reportEmail,
  pickPage, pickSubmit, prepPage, prepSubmit, page, randomToken, has, fv, sel };
