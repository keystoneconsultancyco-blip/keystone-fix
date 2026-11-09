'use strict';
// Nurture emails: honest persuasion only (docs/PRICING.md section 7).
//  - Anchoring: the audit is normally £750; their price is £100 (87% off), or free if they qualify.
//  - Loss framing: only sourced figures, plus plain arithmetic on the visitor's own revenue band (labelled as such).
//  - Reciprocity: each template carries one genuinely useful tip (written in the template).
//  - Urgency: the audit-slots line appears only when Keystone Settings > audit_slots_per_month is set (a real cap),
//    and says how many are left this month from the real count of audits booked.
//  - Social proof: a block that stays hidden until Bilal adds a real testimonial in Keystone Settings. Never invented.
//  - One CTA: "Book my audit" (tracked click), plus an open pixel. Unsubscribe link in every email.
const { escapeHtml: e } = require('./log');

// Sourced figures (checked 9 Nov 2026). Keep the sources with the numbers.
const FACTS = {
  adminHoursPerWeek: 11, // American Express & Small Business Saturday UK, SME Business Barometer, 1,000 UK SME owners (reported July 2026)
  medianHourlyPay: 19.67, // ONS, Annual Survey of Hours and Earnings, median full-time hourly pay excl. overtime, April 2025 (provisional)
  latePaidShare: 0.28, // Department for Business and Trade / Office of the Small Business Commissioner, London Economics, July 2025
  avgOwed: 17000, // same report: average owed at any time per business affected by late payment
  chasingHoursPerYear: 86, // same report: staff time chasing late payments per affected business per year
};
const SOURCES_TEXT = 'Sources: American Express & Small Business Saturday UK SME Barometer (2026); ONS Annual Survey of Hours and Earnings (April 2025); Department for Business and Trade / Small Business Commissioner late payments research by London Economics (July 2025).';
const BAND_MID = { '500k-1m': 750000, '1m-3m': 2000000, '3m-10m': 6500000 };
const BAND_LABEL = { under500k: 'under £500k', '500k-1m': '£500k–£1M', '1m-3m': '£1M–£3M', '3m-10m': '£3M–£10M', over10m: 'over £10M' };
const BAND_FROM_FIELD = { 'Under £500k': 'under500k', '£500k–£1M': '500k-1m', '£1M–£3M': '1m-3m', '£3M–£10M': '3m-10m', 'Over £10M': 'over10m' };

const gbp = (n) => '£' + Math.round(n).toLocaleString('en-GB');
const round = (n, to) => Math.round(n / to) * to;

function adminCostPerMonth() { return round(FACTS.adminHoursPerWeek * 52 / 12 * FACTS.medianHourlyPay, 10); }

// Two short, sourced lines: admin time in money, and cash sitting with late payers for their revenue band.
function lossLine(bandKey) {
  const admin = `UK small-business owners spend about ${FACTS.adminHoursPerWeek} hours a week on admin (American Express SME Barometer). At the UK median full-time wage (£${FACTS.medianHourlyPay}/hour, ONS) that is about ${gbp(adminCostPerMonth())} of time every month.`;
  const mid = BAND_MID[bandKey];
  const late = mid
    ? `And 28% of UK businesses are paid late; those affected are owed £17,000 on average at any time (government research, 2025). For a business turning over ${BAND_LABEL[bandKey]}, every two weeks your customers pay late leaves roughly ${gbp(round(mid * 14 / 365, 500))} of your money sitting in their accounts (simple arithmetic on your revenue band).`
    : `And 28% of UK businesses are paid late; those affected are owed £17,000 on average at any time and spend around ${FACTS.chasingHoursPerYear} staff hours a year chasing it (government research, 2025).`;
  return admin + '\n\n' + late;
}

function auditLine(offer) {
  return offer === 'Free'
    ? 'The Finance Ops Audit normally costs £750. Because your business is a strong fit for what we do, yours is free.'
    : 'The Finance Ops Audit normally costs £750. Yours is £100 (87% off), and that £100 is credited against setup if you go ahead within 30 days. Qualifying businesses may get it free.';
}

// Only when Bilal has set a real monthly cap. auditsThisMonth = audits booked so far this month.
function slotsLine(slotsPerMonth, auditsThisMonth, now) {
  const cap = Number(slotsPerMonth);
  if (!(cap > 0)) return '';
  const d = now ? new Date(now) : new Date();
  const month = d.toLocaleString('en-GB', { month: 'long', timeZone: 'Europe/London' });
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleString('en-GB', { month: 'long' });
  const left = Math.max(0, cap - (Number(auditsThisMonth) || 0));
  return left > 0
    ? `We only run ${cap} audits a month so each one gets proper attention, and ${left} ${left === 1 ? 'is' : 'are'} left for ${month}.`
    : `We only run ${cap} audits a month and ${month} is full, so booking now reserves you a place in ${next}.`;
}

// Hidden unless a real testimonial / case study is in Keystone Settings.
function proofBlock(quote, by) {
  const q = String(quote || '').trim();
  if (!q) return { text: '', html: '' };
  const who = String(by || '').trim();
  return { text: `"${q}"${who ? ' – ' + who : ''}`, html: `<blockquote style="margin:18px 0;padding:12px 16px;border-left:3px solid #C9A961;background:#f7f5ef;font-style:italic">${e(q)}${who ? `<br><span style="font-style:normal;font-size:13px;color:#555">– ${e(who)}</span>` : ''}</blockquote>` };
}

function fill(s, v) {
  return String(s || '').replace(/\{(first_name|company|revenue_band|loss_line|audit_line|slots_line|proof_block)\}/g, (m, k) => (v[k] === undefined ? '' : v[k]));
}

// Which template (if any) a lead should get now. templates: approved ones, each {Kind, Step, 'Send on day', ...}.
// lead: {step (emails sent so far), signedUp (ms), lastSent (ms or 0)}.
const MONTH_MS = 30 * 864e5;
function nextTemplate(templates, lead, now) {
  const t = now || Date.now();
  if (t - lead.signedUp > 365 * 864e5) return { finished: true };
  const seq = templates.filter((x) => (x.Kind || 'Sequence') === 'Sequence').sort((a, b) => a.Step - b.Step);
  const monthly = templates.filter((x) => x.Kind === 'Monthly').sort((a, b) => a.Step - b.Step);
  const step = lead.step || 0;
  if (step < 4) {
    const next = seq.find((x) => Number(x.Step) === step + 1);
    if (!next) return null;
    const due = t - lead.signedUp >= (Number(next['Send on day']) || 0) * 864e5 && t - (lead.lastSent || 0) >= 3 * 864e5;
    return due ? { template: next, step: step + 1 } : null;
  }
  if (!monthly.length) return null;
  if (t - (lead.lastSent || 0) < MONTH_MS) return null;
  return { template: monthly[(step - 4) % monthly.length], step: step + 1 };
}

// Why a lead must get no more emails (checked before every send).
function stopReason(f) {
  const status = (f.Status && f.Status.name) || f.Status || '';
  const ns = (f['Nurture status'] && f['Nurture status'].name) || f['Nurture status'] || '';
  if (ns && ns !== 'Active') return null; // already stopped
  if (!f['Marketing consent']) return 'Stopped - unsubscribed';
  if (f['Make my client'] || status === 'Won') return 'Stopped - client';
  if (status === 'Replied') return 'Stopped - replied';
  if (['Discovery call booked', 'Proposal sent'].includes(status)) return 'Stopped - booked';
  if (['Lost', 'Not pursuing'].includes(status)) return 'Stopped - replied';
  return null;
}

function emailParts({ subject, body, vars, ctaUrl, pixelUrl, unsubUrl, proof }) {
  const text = fill(body, { ...vars, proof_block: proof.text }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const subj = fill(subject, vars);
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1a1a1a;font-size:15px;line-height:1.6">
${paras.map((p) => (p === proof.text && proof.html ? proof.html : `<p style="margin:0 0 14px">${e(p).replace(/\n/g, '<br>')}</p>`)).join('\n')}
<p style="margin:22px 0"><a href="${e(ctaUrl)}" style="display:inline-block;background:#C9A961;color:#0B0D0F;padding:13px 22px;text-decoration:none;font-weight:bold;border-radius:4px">Book my audit</a></p>
<p style="font-size:11px;color:#777;margin-top:28px">${e(SOURCES_TEXT)}</p>
<p style="font-size:11px;color:#777">You are getting this because you asked for an estimate on the Keystone website and ticked to hear from us. We can see when an email is opened or a link is clicked, to improve what we send. <a href="${e(unsubUrl)}" style="color:#777">Unsubscribe</a> at any time. Keystone, Slough, United Kingdom.</p>
<img src="${e(pixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">
</div>`;
  const plain = text + '\n\nBook my audit: ' + ctaUrl + '\n\n' + SOURCES_TEXT + '\n\nUnsubscribe: ' + unsubUrl + '\nKeystone, Slough, United Kingdom';
  return { subject: subj, html, text: plain };
}

module.exports = { FACTS, SOURCES_TEXT, BAND_LABEL, BAND_FROM_FIELD, adminCostPerMonth, lossLine, auditLine, slotsLine, proofBlock, fill, nextTemplate, stopReason, emailParts };
