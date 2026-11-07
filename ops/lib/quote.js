'use strict';
// Generic rule-driven quote engine. Each client's rules live in the registry
// ("Pricing rules" JSON). The engine does all the arithmetic. The quote agent only
// proposes line items or follow-up questions for jobs the rules don't cover, and the
// engine then re-prices those lines and checks the margin floor.
//
// Rules shape (see docs/QUOTE_ENGINE.md):
// {
//   "vatRatePct": 20, "pricesIncludeVat": false, "minimumCharge": 85,
//   "services": [{ "key": "boiler_service", "name": "Boiler service", "match": ["boiler service"],
//                  "base": 95, "cost": 35, "requiredInputs": [],
//                  "unitRates": [{ "input": "extra_radiators", "label": "Extra radiator", "rate": 40, "cost": 15 }] }],
//   "travel": { "input": "miles", "freeMiles": 10, "perMile": 1.2, "costPerMile": 0.45 },
//   "surcharges": [{ "label": "Airport fee", "input": "location", "contains": ["heathrow"], "amount": 10, "cost": 10 }],
//   "modifiers": [{ "label": "Out of hours", "input": "out_of_hours", "equals": true, "multiplier": 1.5 }]
// }

const { obj } = require('./agent');

function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function matchService(rules, { serviceKey, description }) {
  const services = (rules && rules.services) || [];
  if (serviceKey) {
    const byKey = services.find((s) => s.key === serviceKey || (s.name || '').toLowerCase() === String(serviceKey).toLowerCase());
    if (byKey) return byKey;
  }
  const d = String(description || '').toLowerCase();
  if (!d) return null;
  let best = null, bestLen = 0;
  for (const s of services) {
    for (const m of [s.name, ...(s.match || [])].filter(Boolean)) {
      const t = m.toLowerCase();
      if (d.includes(t) && t.length > bestLen) { best = s; bestLen = t.length; }
    }
  }
  return best;
}

function inputMatches(cond, inputs) {
  const v = inputs[cond.input];
  if (cond.equals !== undefined) return v === cond.equals || String(v).toLowerCase() === String(cond.equals).toLowerCase();
  if (cond.contains) return v !== undefined && cond.contains.some((c) => String(v).toLowerCase().includes(String(c).toLowerCase()));
  if (cond.min !== undefined) return Number(v) >= cond.min;
  return false;
}

// Prices a request with the rules alone. Returns {covered, ...}.
function priceWithRules(rules, request) {
  const inputs = request.inputs || {};
  if (!rules || !Array.isArray(rules.services)) return { covered: false, reason: 'no_pricing_rules' };
  const service = matchService(rules, request);
  if (!service) return { covered: false, reason: 'no_matching_service' };
  const missing = (service.requiredInputs || []).filter((k) => inputs[k] === undefined || inputs[k] === null || inputs[k] === '');
  if (rules.travel && rules.travel.required && (inputs[rules.travel.input] === undefined)) missing.push(rules.travel.input);
  if (missing.length) return { covered: false, reason: 'missing_inputs', service: service.key, missingInputs: missing };

  const lines = [{ description: service.name, amount: service.base || 0, cost: service.cost || 0 }];
  for (const u of service.unitRates || []) {
    const qty = Number(inputs[u.input]) || 0;
    if (qty > 0) lines.push({ description: `${u.label} x ${qty}`, amount: r2(u.rate * qty), cost: r2((u.cost || 0) * qty) });
  }
  let mult = 1;
  const applied = [];
  for (const m of [...(rules.modifiers || []), ...(service.modifiers || [])]) {
    if (inputMatches(m, inputs)) { mult *= m.multiplier; applied.push(m.label); }
  }
  if (mult !== 1) {
    const serviceTotal = lines.reduce((s, l) => s + l.amount, 0);
    lines.push({ description: `${applied.join(', ')} adjustment`, amount: r2(serviceTotal * (mult - 1)), cost: 0 });
  }
  if (rules.travel) {
    const t = rules.travel;
    const miles = Number(inputs[t.input]) || 0;
    const chargeable = Math.max(0, miles - (t.freeMiles || 0));
    if (chargeable > 0) lines.push({ description: `Travel (${chargeable} miles)`, amount: r2(chargeable * t.perMile), cost: r2(miles * (t.costPerMile || 0)) });
  }
  for (const s of rules.surcharges || []) {
    if (inputMatches(s, inputs)) lines.push({ description: s.label, amount: s.amount, cost: s.cost || 0 });
  }
  return { covered: true, service: service.key, serviceName: service.name, lines, modifiers: applied };
}

// Totals, minimum charge, discount, VAT and margin. Used for rules AND agent quotes.
function finalizeQuote(rules, lines, { minMarginPct = 30, discountPct = 0 } = {}) {
  rules = rules || {};
  const out = lines.map((l) => ({ description: String(l.description), amount: r2(Number(l.amount) || 0), cost: r2(Number(l.cost) || 0) }));
  let net = out.reduce((s, l) => s + l.amount, 0);
  if (rules.minimumCharge && net < rules.minimumCharge) {
    out.push({ description: 'Minimum charge adjustment', amount: r2(rules.minimumCharge - net), cost: 0 });
    net = rules.minimumCharge;
  }
  if (discountPct > 0) {
    const d = r2(net * discountPct / 100);
    out.push({ description: `Discount (${discountPct}%)`, amount: -d, cost: 0 });
    net = r2(net - d);
  }
  const vatRate = rules.vatRatePct === undefined ? 20 : rules.vatRatePct;
  let subtotal, vat, total;
  if (rules.pricesIncludeVat) {
    total = r2(net); subtotal = r2(total / (1 + vatRate / 100)); vat = r2(total - subtotal);
  } else {
    subtotal = r2(net); vat = r2(subtotal * vatRate / 100); total = r2(subtotal + vat);
  }
  const cost = r2(out.reduce((s, l) => s + l.cost, 0));
  const marginPct = subtotal > 0 ? r2(((subtotal - cost) / subtotal) * 100) : 0;
  return { lines: out, subtotal, vat, total, cost, marginPct, minMarginPct, belowMarginFloor: marginPct < minMarginPct };
}

// ---------- Quote agent (for jobs the rules don't cover) ----------

const QUOTE_AGENT_SCHEMA = obj({
  status: { type: 'string', enum: ['estimate', 'need_info'] },
  questions: { type: 'array', items: { type: 'string' } },
  lines: { type: 'array', items: obj({ description: { type: 'string' }, amount: { type: 'number' }, cost: { type: 'number' } }) },
  assumptions: { type: 'array', items: { type: 'string' } },
  confidence: { type: 'number' },
  reasoning: { type: 'string' },
});

const QUOTE_AGENT_SYSTEM = `You are Keystone's quoting assistant for a UK small business. The business's standard pricing rules did not cover this request.
Your job is either to ask the follow-up questions needed for a fair price, or to build an estimate from the business's own rates and similar past quotes.
Rules:
- Base every price on the rates and past quotes provided. Don't use outside market prices unless nothing relevant exists, and say so in your assumptions if you do.
- Give net prices excluding VAT. Do not compute VAT or totals; the system does that.
- For each line, estimate the business's cost (labour plus materials) so the margin can be checked.
- If a missing fact would move the price by more than about 20%, choose need_info and ask at most 3 short, plain questions.
- This is a DRAFT for the business owner to approve. Never promise a price to the end customer.
- confidence runs from 0 to 1.`;

function quoteAgentPrompt({ client, request, rulesResult, similarQuotes }) {
  return `Business: ${client.clientName} (${client.industry})
Customer request: ${request.description}
Inputs given: ${JSON.stringify(request.inputs || {})}
Answers to earlier questions: ${JSON.stringify(request.answers || {})}
Why the rules could not price it: ${rulesResult.reason}${rulesResult.missingInputs ? ' (missing: ' + rulesResult.missingInputs.join(', ') + ')' : ''}
Pricing rules (JSON): ${JSON.stringify(client.quotes.pricingRules)}
Minimum margin: ${client.quotes.minMarginPct}%
Similar past quotes for this business: ${JSON.stringify((similarQuotes || []).slice(0, 10))}`;
}

// Simple similarity for "estimate from similar jobs": word overlap on description (same client only).
function similarQuotes(description, pastQuotes, limit = 5) {
  const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z]{4,}/g) || []);
  const target = words(description);
  return (pastQuotes || []).map((q) => {
    const w = words(q.description);
    let overlap = 0; for (const x of w) if (target.has(x)) overlap++;
    return { ...q, score: overlap };
  }).filter((q) => q.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

function quoteRef(clientId, now) {
  const d = (now || new Date()).toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return `Q-${clientId}-${d}-${Math.floor(Math.random() * 900 + 100)}`;
}

module.exports = { matchService, priceWithRules, finalizeQuote, QUOTE_AGENT_SCHEMA, QUOTE_AGENT_SYSTEM, quoteAgentPrompt, similarQuotes, quoteRef, r2 };
