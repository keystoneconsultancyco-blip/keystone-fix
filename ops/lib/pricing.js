'use strict';
// Keystone's APPROVED prices (docs/PRICING.md, 9 Nov 2026). One source of truth for the audit, proposals,
// agents and the website calculator. Change docs/PRICING.md and this file together.

const SERVICES = ['invoicing', 'phone', 'quotes', 'reporting'];
const SERVICE_NAMES = {
  invoicing: 'Invoice Automation',
  phone: 'AI Phone Booking',
  quotes: 'Quote Calculator',
  reporting: 'Reporting Dashboard',
  monitoring: 'Monthly Operations Management',
};
const SERVICE_DESCRIPTIONS = {
  invoicing: 'Invoices auto-drafted in Xero when a job is completed, plus payment chasing',
  phone: 'Answers calls, books jobs, flags urgent calls and complaints',
  quotes: 'Instant quotes by phone, form or manually',
  reporting: 'Live figures plus a weekly money email',
};

const PRICING = {
  setup: { invoicing: 1750, phone: 1250, quotes: 1250, reporting: 1500 },
  setupDiscount: { 1: 0, 2: 0.10, 3: 0.15, 4: 0.20 },
  packages: [
    { key: 'starter', name: 'Starter', base: 750, services: 1, includes: '1 core service + monitoring and fixes' },
    { key: 'growth', name: 'Growth', base: 1500, services: 3, includes: '3 core services + monitoring and fixes + monthly review call' },
    { key: 'complete', name: 'Complete', base: 2500, services: 4, includes: 'All 4 core services + monitoring and fixes + monthly review call + a custom AI agent built for your business, quarterly growth review and 4-hour priority response' },
  ],
  // Monthly packages only (setup never changes with size). Fixed bands, never case by case.
  bands: [
    { key: '500k-1m', label: '£500k–£1M', mult: 0.8 },
    { key: '1m-3m', label: '£1M–£3M', mult: 1.0 },
    { key: '3m-10m', label: '£3M–£10M', mult: 1.5 },
  ],
  audit: { worth: 750, paid: 100, note: 'Credited against setup if you sign within 30 days.' },
  pilot: { auditFree: true, setupDiscount: 0.5, minTermMonths: 3, note: 'First client only: free audit and 50% off setup in exchange for a written case study and testimonial.' },
  callMinutesIncluded: 500,
  minTermMonths: 3,
};

// Old band names (earlier forms) -> current bands.
const BAND_ALIASES = { under500k: 'under500k', '500k-2m': '500k-1m', '2m-5m': '1m-3m', '5m-10m': '3m-10m', '10mplus': 'over10m', '500k-1m': '500k-1m', '1m-3m': '1m-3m', '3m-10m': '3m-10m', over10m: 'over10m' };
const BAND_LABELS = { under500k: 'Under £500k', '500k-1m': '£500k–£1M', '1m-3m': '£1M–£3M', '3m-10m': '£3M–£10M', over10m: 'Over £10M' };

function bandOf(revenueBand) { return BAND_ALIASES[String(revenueBand || '').toLowerCase()] || '1m-3m'; }
function bandMultiplier(revenueBand) {
  const k = bandOf(revenueBand);
  const b = PRICING.bands.find((x) => x.key === k);
  if (b) return { mult: b.mult, band: k, outOfRange: false };
  // Outside the three bands: use the nearest band and say so (Bilal decides).
  return { mult: k === 'under500k' ? 0.8 : 1.5, band: k, outOfRange: true };
}

function packageFor(serviceCount) {
  const n = Math.max(1, Math.min(4, Number(serviceCount) || 1));
  return n === 1 ? PRICING.packages[0] : n <= 3 ? PRICING.packages[1] : PRICING.packages[2];
}
function packagePrice(pkg, revenueBand) {
  const p = typeof pkg === 'string' ? PRICING.packages.find((x) => x.key === pkg || x.name === pkg) : pkg;
  return Math.round(p.base * bandMultiplier(revenueBand).mult);
}

function setupQuote(serviceKeys, { pilot = false } = {}) {
  const keys = [...new Set(serviceKeys || [])].filter((k) => PRICING.setup[k] !== undefined);
  const lines = keys.map((k) => ({ key: k, name: SERVICE_NAMES[k], fee: PRICING.setup[k] }));
  const gross = lines.reduce((s, l) => s + l.fee, 0);
  const discountPct = (PRICING.setupDiscount[keys.length] || 0) * 100;
  let total = gross * (1 - discountPct / 100);
  if (pilot) total *= 1 - PRICING.pilot.setupDiscount;
  return { lines, gross, discountPct, pilot, total: Math.round(total * 100) / 100 };
}

// Full proposal pricing: setup (with discount), the package for the number of services, the band price,
// and the sense check (monthly fee <= about one-third of the monthly loss the audit found).
function priceProposal(serviceKeys, { revenue, monthlyLoss, pilot = false } = {}) {
  const keys = [...new Set(serviceKeys || [])].filter((k) => SERVICES.includes(k));
  const pkg = packageFor(keys.length || 1);
  const band = bandMultiplier(revenue);
  const monthly = packagePrice(pkg, revenue);
  const setup = setupQuote(keys, { pilot });
  const loss = Number(monthlyLoss) || 0;
  const senseCheck = { monthlyFee: monthly, monthlyLoss: Math.round(loss), limit: Math.round(loss / 3), ok: loss > 0 ? monthly <= loss / 3 * 1.05 : null };
  return {
    services: keys, package: { ...pkg, price: monthly }, band: { key: band.band, label: BAND_LABELS[band.band], mult: band.mult, outOfRange: band.outOfRange },
    setup, audit: { ...PRICING.audit, offer: pilot ? 'Free (pilot)' : null }, senseCheck,
    terms: `Minimum term ${PRICING.minTermMonths} months, then monthly rolling. AI phone call costs above ${PRICING.callMinutesIncluded} minutes a month are passed on at cost.`,
  };
}

// What the website calculator shows after email verification: "from" figures at the ×1.0 band only.
function websiteRanges(serviceKeys) {
  const keys = [...new Set(serviceKeys || [])].filter((k) => SERVICES.includes(k));
  const use = keys.length ? keys : SERVICES;
  const setupFrom = keys.length ? setupQuote(keys).total : Math.min(...Object.values(PRICING.setup));
  const pkg = packageFor(keys.length || 1);
  return { services: keys.map((k) => SERVICE_NAMES[k]), setupFrom: Math.round(setupFrom), monthlyFrom: pkg.base, packageName: pkg.name, allPackages: PRICING.packages.map((p) => ({ name: p.name, from: p.base, includes: p.includes })), note: 'Exact price depends on business size.', considered: use.length };
}

// Audit offer from the 3 checks. Free only for High value leads; everything else (and time-wasters) £100.
function auditOffer({ fit, timing, pain, affordable, urgent, recurring, timeWaster }) {
  const high = !!(fit && timing && pain && affordable && urgent && recurring) && !timeWaster;
  return { leadValue: high ? 'High' : 'Standard', auditOffer: high ? 'Free' : '£100',
    shownAs: high ? 'Free Finance Ops Audit – worth £750' : 'Finance Ops Audit – £100 (87% off – normally £750)' };
}

module.exports = { SERVICES, SERVICE_NAMES, SERVICE_DESCRIPTIONS, PRICING, BAND_LABELS, bandOf, bandMultiplier, packageFor, packagePrice, setupQuote, priceProposal, websiteRanges, auditOffer };
