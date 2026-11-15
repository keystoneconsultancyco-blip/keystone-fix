'use strict';
// Cold outreach (B2B, UK): who may be emailed, how many a day, the legal footer, and what to do with replies.
//  - Only active limited companies, LLPs and other corporate bodies on Companies House (PECR "corporate subscribers").
//    Sole traders and partnerships are never cold-emailed; nor are free-mail addresses (gmail etc.).
//  - Bilal approves the first 20 emails (Outreach agent, YES/NO). After that the High-potential ones go out
//    automatically, weekdays only: 10 a day in week 1, 20 in week 2, 30 in week 3, 40 from week 4.
//  - From "The Keystone Team <team@domain>"; replies go to team@reply.<domain> (Resend receiving).
//  - Every email: unsubscribe link (+ List-Unsubscribe header) and Keystone's business address.
//  - Replies: interested / question -> draft answer for Bilal's YES/NO; not interested or "stop" -> never emailed again.
const C = require('./calc');
const e = require('./log').escapeHtml;

const BASE = 'https://keystoneconsultancy.app.n8n.cloud/webhook';
const APPROVED_FIRST = 20;
const RAMP = [10, 20, 30, 40];
const PER_RUN_SHARE = { 9: 0.5, 13: 1 }; // two weekday runs (09:40, 13:40): the morning sends half the day's quota
// Companies House company types that are corporate subscribers (PECR allows B2B cold email to these).
const CORPORATE_TYPES = ['ltd', 'plc', 'llp', 'private-unlimited', 'private-unlimited-nsc', 'private-limited-guarant-nsc', 'private-limited-guarant-nsc-limited-exemption',
  'private-limited-shares-section-30-exemption', 'old-public-company', 'royal-charter', 'scottish-partnership', 'charitable-incorporated-organisation', 'scottish-charitable-incorporated-organisation', 'registered-society-non-jurisdictional', 'uk-establishment', 'registered-overseas-entity'];

const fv = (r, k) => ((r && r.fields) || {})[k];
const sel = (v) => (v && v.name) || v || '';
const normName = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(limited|ltd|llp|plc|the|uk|co|company)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- Companies House ----------
function chRequest(rec) {
  const num = String(fv(rec, 'Company number') || '').trim().toUpperCase();
  if (/^[A-Z0-9]{8}$/.test(num)) return { method: 'GET', url: 'https://api.company-information.service.gov.uk/company/' + num, kind: 'company' };
  return { method: 'GET', url: 'https://api.company-information.service.gov.uk/search/companies?items_per_page=5&q=' + encodeURIComponent(String(fv(rec, 'Company') || '').slice(0, 100)), kind: 'search' };
}
// -> { ok, fields } where fields go on the Prospect.
function chResult(rec, res, kind) {
  const now = new Date().toISOString();
  const no = (why, extra = {}) => ({ ok: false, fields: { 'Cold email OK': 'No', 'Cold email check': why.slice(0, 250), 'Companies House checked at': now, ...extra } });
  const email = String(fv(rec, 'Email') || '').toLowerCase();
  if (C.isFreeMail(email)) return no('Free-mail address (likely a sole trader): not cold-emailed');
  if (!(res && res.statusCode < 300)) return res && res.statusCode === 404 ? no('Not found on Companies House') : { ok: false, retry: true, fields: {} };
  let co = null;
  if (kind === 'company') co = { number: res.body.company_number, title: res.body.company_name, type: res.body.type, status: res.body.company_status };
  else {
    const want = normName(fv(rec, 'Company'));
    const items = ((res.body || {}).items || []).filter((i) => normName(i.title) === want);
    const live = items.filter((i) => i.company_status === 'active');
    if (!items.length) return no('No exact Companies House match for "' + fv(rec, 'Company') + '": sole trader or partnership? (Type the company number into Company number to retry.)');
    if (live.length > 1) return no('Several active companies share this name: type the right number into Company number to retry');
    const i = live[0] || items[0];
    co = { number: i.company_number, title: i.title, type: i.company_type, status: i.company_status };
  }
  const base = { 'Company number': co.number || '', 'Company type': co.type || '', 'Company status': co.status || '' };
  if (co.status !== 'active') return no(`Companies House status is "${co.status}"`, base);
  if (!CORPORATE_TYPES.includes(co.type)) return no(`Company type "${co.type}" is not a limited company / LLP`, base);
  return { ok: true, fields: { ...base, 'Cold email OK': 'Yes', 'Cold email check': `${co.title} (${co.number}), ${co.type}, active`, 'Companies House checked at': now } };
}

// ---------- how many today ----------
function londonParts(now) {
  const d = new Date(now);
  const day = d.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
  const hour = Number(d.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }));
  const date = d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  return { day, hour, date, weekday: !['Sat', 'Sun'].includes(day) };
}
function dailyLimit(startDate, now = Date.now()) {
  if (!startDate) return RAMP[0];
  const week = Math.floor((Date.parse(londonParts(now).date) - Date.parse(startDate)) / (7 * 864e5));
  return RAMP[Math.max(0, Math.min(RAMP.length - 1, week))];
}
// How many automatic emails this run may send. approvedSent = emails Bilal approved that went out.
function quota({ S = {}, approvedSent = 0, sentToday = 0, now = Date.now() }) {
  if (S.cold_outreach === 'off') return { phase: 'off', n: 0, why: 'cold_outreach is off' };
  if (approvedSent < APPROVED_FIRST) return { phase: 'approval', n: 0, why: `${approvedSent}/${APPROVED_FIRST} approved emails sent: Bilal still approves each one` };
  const p = londonParts(now);
  if (!p.weekday) return { phase: 'auto', n: 0, why: 'weekend' };
  const limit = dailyLimit(S.cold_outreach_start || p.date, now);
  const share = p.hour < 12 ? PER_RUN_SHARE[9] : PER_RUN_SHARE[13];
  return { phase: 'auto', limit, n: Math.max(0, Math.ceil(limit * share) - sentToday), startToday: !S.cold_outreach_start, date: p.date };
}

// ---------- the email ----------
function unsubUrl(rec, token) { return `${BASE}/ks-unsubscribe?p=${encodeURIComponent(rec.id)}&t=${encodeURIComponent(token)}`; }
function footer(rec, S, token) {
  const addr = S.business_address || '';
  const url = unsubUrl(rec, token);
  return {
    text: `\n\n--\nThe Keystone Team · Keystone, ${addr}\nWe found your business email on your website and thought this could help ${fv(rec, 'Company') || 'you'}. Not interested? Unsubscribe here and we will never email you again: ${url}`,
    html: `<p style="font-size:12px;color:#6b7280;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px">The Keystone Team · Keystone, ${e(addr)}<br>We found your business email on your website and thought this could help ${e(fv(rec, 'Company') || 'you')}. Not interested? <a href="${e(url)}" style="color:#6b7280">Unsubscribe</a> and we will never email you again.</p>`,
    headers: { 'List-Unsubscribe': `<${url}>` },
  };
}
// Same hard rules as the Outreach agent: no prices in a first email; only Free leads may hear "free".
function ruleBreaks(subject, body, offer) {
  const t = subject + ' ' + body;
  return [/£|\bGBP\b|\d+\s?(pounds|per month)/i.test(t) && 'mentions a price', offer !== 'Free' && /\bfree\b/i.test(t) && 'calls the audit free but this lead gets the £100 offer',
    /unsubscribe/i.test(body) && 'writes its own unsubscribe text (the footer adds it)'].filter(Boolean);
}
function buildEmail(rec, draft, S, token) {
  const f = footer(rec, S, token);
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;white-space:pre-wrap">${e(draft.body)}</div>${f.html}`;
  return { subject: draft.subject, text: draft.body + f.text, html, headers: f.headers };
}

// ---------- replies ----------
const REPLY_SCHEMA = { type: 'object', additionalProperties: false, required: ['type', 'summary', 'draft_subject', 'draft_body'], properties: {
  type: { type: 'string', enum: ['Interested', 'Question', 'Not interested', 'Unsubscribe', 'Auto-reply'] }, summary: { type: 'string' }, draft_subject: { type: 'string' }, draft_body: { type: 'string' } } };
const REPLY_SYSTEM = `You read replies to Keystone's cold emails and draft Bilal's answer. Keystone is a UK finance-operations consultancy: invoice automation, AI phone booking, quote calculator, reporting. The next step for anyone interested is a Finance Ops Audit (£100, normally £750, credited against setup; the card is only held until the call time is confirmed), or a short call.
Classify the reply:
- Interested: wants to talk, book, see prices or the audit.
- Question: asks something before deciding.
- Not interested: no thanks, not now, wrong person with no referral.
- Unsubscribe: asks to stop or remove them.
- Auto-reply: out of office, delivery notice, ticket system.
For Interested and Question, write Bilal's reply: warm, short (under 120 words), plain British English, answer their question honestly, suggest one clear next step (a 15-minute call, or the audit), signed "Bilal Khan, Keystone". Never invent facts, prices beyond the audit fee, clients or results. For the other types leave draft_subject and draft_body empty.`;
function replyPrompt(rec, msg) {
  return `Our original email to ${fv(rec, 'Company') || 'them'}:\nSubject: ${fv(rec, 'Email subject') || ''}\n${String(fv(rec, 'Email draft') || '').slice(0, 3000)}\n\nTheir reply (from ${msg.from}):\nSubject: ${msg.subject || ''}\n${String(msg.text || '').slice(0, 6000)}`;
}
// Strip quoted history from a reply so we keep only what they wrote.
function newPart(text) {
  const lines = String(text || '').split(/\r?\n/);
  const cut = lines.findIndex((l) => /^\s*>/.test(l) || /^On .+wrote:\s*$/.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From: /.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim().slice(0, 5000);
}
const addrOf = (s) => ((String(s || '').match(/<([^>]+)>/) || [])[1] || String(s || '')).trim().toLowerCase();

// ---------- weekly summary ----------
function weekly(prospects, now = Date.now(), q = {}) {
  const since = now - 7 * 864e5;
  const inWeek = (v) => v && Date.parse(v) >= since;
  const P = prospects.map((r) => r.fields || {});
  const sent = P.filter((f) => inWeek(f['Sent on']));
  const count = (t) => P.filter((f) => inWeek(f['Reply received at']) && sel(f['Reply type']) === t).length;
  const auto = sent.filter((f) => sel(f['Outreach mode']) === 'Automatic').length;
  const lines = [
    `Emails sent: ${sent.length} (${auto} automatic, ${sent.length - auto} approved by you)`,
    `Replies: ${P.filter((f) => inWeek(f['Reply received at'])).length} · interested ${count('Interested')} · questions ${count('Question')} · not interested ${count('Not interested')} · unsubscribed ${count('Unsubscribe')}`,
    `Bounced: ${count('Bounced')} · spam complaints: ${count('Complaint')}`,
    `Waiting for your YES/NO on a reply: ${P.filter((f) => f['Reply draft'] && !f['Reply sent at']).length}`,
    q.phase === 'auto' ? `Sending: ${q.limit}/day now (rising to 40/day by week 4)` : q.phase === 'approval' ? `Still in the approval stage: ${q.why}` : `Automatic sending is off (${q.why || ''})`,
    `Checked on Companies House this week: ${P.filter((f) => inWeek(f['Companies House checked at'])).length} (${P.filter((f) => inWeek(f['Companies House checked at']) && sel(f['Cold email OK']) === 'No').length} not allowed: sole traders, partnerships, dissolved)`,
  ];
  const interested = P.filter((f) => inWeek(f['Reply received at']) && ['Interested', 'Question'].includes(sel(f['Reply type']))).map((f) => `${f.Company}: ${String(f['Last reply'] || '').replace(/\s+/g, ' ').slice(0, 140)}`);
  return { subject: '[Keystone] Cold outreach: weekly summary', text: lines.join('\n') + (interested.length ? '\n\nInterested this week:\n- ' + interested.join('\n- ') : ''), lines, interested };
}

module.exports = { APPROVED_FIRST, RAMP, CORPORATE_TYPES, normName, chRequest, chResult, londonParts, dailyLimit, quota, footer, unsubUrl, ruleBreaks, buildEmail,
  REPLY_SCHEMA, REPLY_SYSTEM, replyPrompt, newPart, addrOf, weekly };
