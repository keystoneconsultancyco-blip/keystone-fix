'use strict';
// Keystone's own service pricing. This uses the same logic as the website's instant-quote
// calculator (keystone-website-v3/script.js: computeRange and the multipliers), applied to
// the launch services. The figures here are the PROPOSAL in docs/PRICING_PROPOSAL.md and
// stay a proposal until Bilal approves them.

const REVENUE_MULT = { under500k: 0.7, '500k-2m': 0.85, '2m-5m': 1.0, '5m-10m': 1.25, '10mplus': 1.5 };
const SCALE_MULT = { justme: 0.6, '2-10': 0.9, '11-50': 1.0, '50plus': 1.3 };
const VOL_MULT = { under20: 0.85, '20-50': 1.0, '50plus': 1.3 };

const PRICING = {
  audit: { fixed: 750, label: 'Finance Ops Audit', unit: 'one-off', note: 'Credited in full against setup if you go ahead within 30 days.' },
  setup: { invoicing: 1500, phone: 1250, quotes: 1000, reporting: 1250, monitoring: 0 },
  monthly: { invoicing: 395, phone: 450, quotes: 195, reporting: 295, monitoring: 0 },
  tiers: [
    { key: 'essentials', name: 'Essentials', price: 495, services: 1, includes: 'One service, Ops Monitor, monthly value report' },
    { key: 'growth', name: 'Growth', price: 995, services: 3, includes: 'Up to three services, Ops Monitor, weekly money explainer, monthly review call' },
    { key: 'complete', name: 'Complete', price: 1650, services: 5, includes: 'All five run services, priority response, quarterly operations review' },
  ],
  multiServiceSetupDiscount: { 2: 0.1, 3: 0.15, 4: 0.2, 5: 0.2 },
};

const SERVICE_NAMES = {
  invoicing: 'Invoice Automation',
  phone: 'AI Phone Booking',
  quotes: 'Quote Calculator',
  reporting: 'Reporting Dashboard',
  monitoring: 'Monthly Operations Management',
};

function roundTo(v, u) { return Math.round(v / u) * u; }

function computeRange(base, mults, { floorPct = 0.7, ceilPct = 2.0, midUnit = 50 } = {}) {
  const mult = mults.reduce((a, b) => a * (b || 1), 1);
  const clamped = Math.min(Math.max(base * mult, base * floorPct), base * ceilPct);
  const mid = roundTo(clamped, midUnit);
  return { low: roundTo(mid * 0.9, 50), mid, high: roundTo(mid * 1.1, 50) };
}

function isPoorFit(scale, revenue) { return scale === 'justme' || revenue === 'under500k'; }

// Price a recommended package for the audit report.
function priceProposal(serviceKeys, { revenue = '2m-5m', scale = '11-50', volume = '20-50' } = {}) {
  const keys = [...new Set(serviceKeys)].filter((k) => PRICING.setup[k] !== undefined);
  const runServices = keys.filter((k) => k !== 'monitoring');
  const disc = PRICING.multiServiceSetupDiscount[runServices.length] || 0;
  const setupLines = runServices.map((k) => {
    const r = computeRange(PRICING.setup[k], [REVENUE_MULT[revenue], SCALE_MULT[scale]], { floorPct: 0.8, ceilPct: 1.6, midUnit: 50 });
    return { key: k, name: SERVICE_NAMES[k], ...r };
  });
  const setupMid = setupLines.reduce((s, l) => s + l.mid, 0) * (1 - disc);
  const tier = PRICING.tiers.find((t) => t.services >= runServices.length) || PRICING.tiers[PRICING.tiers.length - 1];
  const monthly = computeRange(tier.price, [REVENUE_MULT[revenue], VOL_MULT[volume]], { floorPct: 0.9, ceilPct: 1.5, midUnit: 25 });
  return {
    poorFit: isPoorFit(scale, revenue),
    audit: PRICING.audit,
    setupLines,
    setupDiscountPct: disc * 100,
    setupTotal: { low: roundTo(setupMid * 0.9, 50), mid: roundTo(setupMid, 50), high: roundTo(setupMid * 1.1, 50) },
    tier: { ...tier, ...monthly },
  };
}

module.exports = { REVENUE_MULT, SCALE_MULT, VOL_MULT, PRICING, SERVICE_NAMES, computeRange, isPoorFit, priceProposal };
