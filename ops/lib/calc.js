'use strict';
// Website quote calculator (free but email-verified): validation, codes, rate limits, free-mail flag, results.
// Pure functions, unit-tested; the n8n workflow "KS Website Calculator" does the I/O.
const P = require('./pricing');

const LIMIT_PER_DAY = 3;
const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 3;
const BANDS = { under500k: 'Under £500k', '500k-1m': '£500k–£1M', '1m-3m': '£1M–£3M', '3m-10m': '£3M–£10M', over10m: 'Over £10M' };
const SERVICE_KEYS = ['invoicing', 'phone', 'quotes', 'reporting'];
const FREE_MAIL = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'outlook.co.uk', 'live.com', 'live.co.uk', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aol.co.uk', 'btinternet.com', 'sky.com', 'virginmedia.com', 'talktalk.net', 'protonmail.com', 'proton.me', 'gmx.com', 'gmx.co.uk', 'mail.com', 'zoho.com'];

// Small non-cryptographic hash (cyrb53) with a secret salt: enough for 15-minute 6-digit codes with 3 attempts.
function hash(str, salt) {
  const s = String(salt || '') + '|' + String(str || '');
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function randomCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function randomId(n = 24) { const c = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }

function parseBody(b) {
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  if (b && typeof b === 'object') {
    const keys = Object.keys(b);
    // text/plain bodies can arrive as {"<json>": ""}
    if (keys.length === 1 && keys[0].startsWith('{') && !b[keys[0]]) { try { return JSON.parse(keys[0]); } catch (e) { return b; } }
    return b;
  }
  return {};
}

function clientIp(headers) {
  const h = headers || {};
  return String(h['cf-connecting-ip'] || h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || '').trim();
}

function isFreeMail(email) { const d = String(email || '').split('@')[1] || ''; return FREE_MAIL.includes(d.toLowerCase()); }

function validateStart(b) {
  const x = {
    name: String(b.name || '').trim().slice(0, 100), email: String(b.email || '').trim().toLowerCase().slice(0, 200),
    company: String(b.company || '').trim().slice(0, 150), revenueBand: String(b.revenueBand || ''),
    services: (Array.isArray(b.services) ? b.services : []).filter((s) => SERVICE_KEYS.includes(s)), consent: b.consent === true,
    honeypot: String(b.website || b.url || '').trim(),
  };
  const errors = [];
  if (x.name.length < 2) errors.push('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x.email)) errors.push('Please enter a valid business email.');
  if (x.company.length < 2) errors.push('Please enter your company name.');
  if (!BANDS[x.revenueBand]) errors.push('Please choose your annual revenue.');
  return { x, errors, isBot: !!x.honeypot };
}

// recent = Calculator Requests rows created today matching this email or IP hash.
function rateLimited(recent, email, ipHash) {
  const byEmail = recent.filter((r) => String(r.Email || '').toLowerCase() === email).length;
  const byIp = ipHash ? recent.filter((r) => r['IP hash'] === ipHash).length : 0;
  return byEmail >= LIMIT_PER_DAY || byIp >= LIMIT_PER_DAY;
}

// Is the verification email allowed to go out? Off until the domain is verified (only Bilal's own inbox for testing).
function sendingAllowed(S, email, testInbox) {
  if (String(S.website_calculator || 'auto').toLowerCase() === 'off') return false;
  const verified = S.domain_status === 'Verified' && S.email_from && !/@resend\.dev/i.test(S.email_from);
  return verified || String(email).toLowerCase() === String(testInbox).toLowerCase();
}

function checkCode(row, code, salt, now) {
  if (!row) return { ok: false, reason: 'expired', message: 'That code has expired. Please request a new one.' };
  if (row.Verified) return { ok: false, reason: 'used', message: 'That code has already been used. Please request a new one.' };
  if (Date.parse(row.Expires) < (now || Date.now())) return { ok: false, reason: 'expired', message: 'That code has expired (codes last 15 minutes). Please request a new one.' };
  const attempts = Number(row.Attempts) || 0;
  if (attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked', message: 'Too many wrong attempts. Please request a new code.' };
  if (hash(String(code || '').trim(), salt) !== row['Code hash']) {
    const left = MAX_ATTEMPTS - attempts - 1;
    return { ok: false, reason: 'wrong', attempts: attempts + 1, message: left > 0 ? `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.` : 'That code is not right, and that was the last attempt. Please request a new code.' };
  }
  return { ok: true };
}

function results(services) {
  const r = P.websiteRanges(services);
  return {
    setupFrom: r.setupFrom, monthlyFrom: r.monthlyFrom, packageName: r.packageName, services: r.services, packages: r.allPackages,
    note: r.note,
    cta: 'Get your exact quote with a Finance Ops Audit – £100 (normally £750). Qualifying businesses may receive it free.',
  };
}

function codeEmail(name, code) {
  const first = String(name || '').split(' ')[0] || 'there';
  const text = `Hi ${first},\n\nYour Keystone verification code is ${code}\n\nIt lasts 15 minutes. If you did not ask for an estimate, ignore this email.\n\nKeystone`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px"><p>Hi ${first.replace(/[<>&"]/g, '')},</p><p>Your Keystone verification code is</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p><p>It lasts 15 minutes. If you did not ask for an estimate, ignore this email.</p><p>Keystone</p></div>`;
  return { subject: `Your Keystone code: ${code}`, text, html };
}

module.exports = { LIMIT_PER_DAY, CODE_MINUTES, MAX_ATTEMPTS, BANDS, SERVICE_KEYS, FREE_MAIL, hash, randomCode, randomId, parseBody, clientIp, isFreeMail, validateStart, rateLimited, sendingAllowed, checkCode, results, codeEmail };
