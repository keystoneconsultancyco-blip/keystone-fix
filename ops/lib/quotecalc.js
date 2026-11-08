'use strict';
// Custom quote calculator, driven by Airtable "Quote Services" + "Quote Factors" rows
// (per client), plus VAT settings on the client's My Clients row.
// Used by: phone agent (get_quote), the customer quote form, and manual quotes.
// All arithmetic is here; the AI only helps when no service matches.

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const f = (r) => (r && r.fields ? r.fields : r || {});
const sel = (v) => (v && v.name) || v || '';
const list = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

function loadServices(rows, clientId) {
  return (rows || []).map(f).filter((x) => x['Client ID'] === clientId && x['Active'] !== false && x['Service'])
    .map((x) => ({
      name: x['Service'], basePrice: Number(x['Base price']) || 0, baseCost: Number(x['Cost (base)']) || 0,
      unitName: x['Unit name'] || '', unitPrice: Number(x['Price per unit']) || 0, unitCost: Number(x['Cost per unit']) || 0,
      includedUnits: Number(x['Units included in base']) || 0, keywords: list(x['Keywords']), description: x['Description for customer'] || '',
    }));
}

function loadFactors(rows, clientId) {
  return (rows || []).map(f).filter((x) => x['Client ID'] === clientId && x['Active'] !== false && x['Factor'])
    .map((x) => ({
      name: x['Factor'], type: sel(x['Type']), amount: Number(x['Amount']) || 0, key: (x['Ask as'] || x['Factor']).trim().toLowerCase().replace(/\s+/g, '_'),
      question: x['Question'] || '', applies: sel(x['Applies']) || 'When customer says yes', freeUnits: Number(x['Free units']) || 0,
      onlyFor: list(x['Only for services']).map((s) => s.toLowerCase()), cost: Number(x['Cost']) || 0, waivedIfBooked: !!x['Waived if booked'],
    }));
}

// Pick the service: exact name, then longest keyword/name contained in the description.
function matchService(services, { service, description }) {
  if (service) {
    const s = services.find((x) => x.name.toLowerCase() === String(service).toLowerCase());
    if (s) return s;
  }
  const d = ` ${String(description || service || '').toLowerCase()} `;
  let best = null, len = 0;
  for (const s of services) for (const k of [s.name, ...s.keywords]) {
    const t = k.toLowerCase();
    if (t && d.includes(t) && t.length > len) { best = s; len = t.length; }
  }
  return best;
}

function truthy(v) { return v === true || ['yes', 'true', 'y', '1', 'on'].includes(String(v).toLowerCase()); }

// input: { service?, description?, quantity?, answers: {key: value}, source: 'phone'|'web'|'manual' }
// client: normalised registry row (VAT, margin). Returns a priced quote or {matched:false}.
function calculate({ services, factors, client, input }) {
  const src = input.source || 'web';
  const svc = matchService(services, input);
  if (!svc) return { matched: false, reason: 'no_matching_service', services: services.map((s) => s.name), lines: [], subtotal: 0, vat: 0, total: 0, cost: 0, marginPct: 0, minMarginPct: client.quotes.minMarginPct, belowMarginFloor: false, missing: [], followUps: [], notes: [] };
  const answers = Object.fromEntries(Object.entries(input.answers || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  const qty = input.quantity !== undefined && input.quantity !== '' ? Number(input.quantity) : (svc.unitName ? null : 0);
  const missing = [];
  if (svc.unitName && (qty === null || isNaN(qty)) && svc.includedUnits === 0) missing.push(`How many ${svc.unitName}s?`);

  const lines = [];
  if (svc.basePrice) lines.push({ description: svc.name, amount: svc.basePrice, cost: svc.baseCost });
  if (svc.unitName && qty) {
    const extra = Math.max(0, qty - svc.includedUnits);
    if (extra > 0) lines.push({ description: `${svc.name}: ${extra} ${svc.unitName}${extra === 1 ? '' : 's'}${svc.includedUnits ? ' extra' : ''} @ £${svc.unitPrice}`, amount: r2(extra * svc.unitPrice), cost: r2(extra * svc.unitCost) });
  }
  const applicable = factors.filter((fc) => !fc.onlyFor.length || fc.onlyFor.includes(svc.name.toLowerCase()));
  const notes = [];
  let multiplier = 1;
  const pctAdjust = [];
  for (const fc of applicable) {
    if (fc.applies === 'Manual quotes only' && src !== 'manual') continue;
    const val = answers[fc.key];
    const on = fc.applies === 'Always' || (fc.applies === 'When customer says yes' && truthy(val)) || ((fc.applies === 'When a number is given' || fc.applies === 'Manual quotes only') && val !== undefined && val !== '' && val !== false);
    if (!on) continue;
    if (fc.type === 'Fixed fee') {
      const waived = fc.waivedIfBooked && truthy(answers.booked);
      lines.push({ description: fc.name + (waived ? ' (waived when you book)' : ''), amount: waived ? 0 : fc.amount, cost: fc.cost });
      if (fc.waivedIfBooked && !waived) notes.push(`${fc.name} is waived if you go ahead and book.`);
    } else if (fc.type === 'Per unit') {
      const n = Math.max(0, Number(val) - fc.freeUnits);
      if (Number(val) > 0 && n > 0) lines.push({ description: `${fc.name} (${n}${fc.freeUnits ? ' beyond first ' + fc.freeUnits : ''})`, amount: r2(n * fc.amount), cost: r2(Number(val) * fc.cost) });
    } else if (fc.type === 'Materials markup %') {
      const m = Number(val) || 0;
      if (m > 0) lines.push({ description: fc.name, amount: r2(m * (1 + fc.amount / 100)), cost: m });
    } else if (fc.type === 'Multiplier') { multiplier *= fc.amount || 1; pctAdjust.push({ name: fc.name, mult: fc.amount }); }
    else if (fc.type === 'Percent of job') pctAdjust.push({ name: fc.name, pct: fc.amount });
  }
  // Multipliers and % apply to the service part of the job only (not travel/materials/fixed fees).
  const serviceTotal = lines.filter((l) => l.description.startsWith(svc.name)).reduce((s, l) => s + l.amount, 0);
  for (const p of pctAdjust) {
    const amt = p.mult !== undefined ? r2(serviceTotal * (p.mult - 1)) : r2(serviceTotal * p.pct / 100);
    if (amt) lines.push({ description: p.name, amount: amt, cost: 0 });
  }
  if (input.discountPct && src === 'manual') lines.push({ description: `Discount (${input.discountPct}%)`, amount: -r2(lines.reduce((s, l) => s + l.amount, 0) * input.discountPct / 100), cost: 0 });

  const vatRate = client.invoice.vatRatePct === undefined ? 20 : client.invoice.vatRatePct;
  const inc = !!client.quotes.pricesIncludeVat;
  const gross = r2(lines.reduce((s, l) => s + l.amount, 0));
  const subtotal = inc ? r2(gross / (1 + vatRate / 100)) : gross;
  const vat = inc ? r2(gross - subtotal) : r2(subtotal * vatRate / 100);
  const total = inc ? gross : r2(subtotal + vat);
  const cost = r2(lines.reduce((s, l) => s + (l.cost || 0), 0));
  const marginPct = subtotal > 0 ? r2((subtotal - cost) / subtotal * 100) : 0;
  const followUps = applicable.filter((fc) => fc.applies !== 'Always' && fc.applies !== 'Manual quotes only' && answers[fc.key] === undefined && fc.question).map((fc) => fc.question);
  return {
    matched: true, service: svc.name, serviceDescription: svc.description, lines: lines.map((l) => ({ ...l, amount: r2(l.amount), cost: r2(l.cost || 0) })),
    subtotal, vat, vatRate, pricesIncludeVat: inc, total, cost, marginPct, minMarginPct: client.quotes.minMarginPct,
    belowMarginFloor: subtotal > 0 && marginPct < client.quotes.minMarginPct, missing, followUps, notes,
  };
}

// The phrase the phone agent reads out. Always says "estimate".
function phoneSentence(q, clientName) {
  if (!q.matched) return `I can't give a set price for that over the phone, but I'll pass the details to the ${clientName} team and they'll get back to you with a quote.`;
  if (q.missing.length) return `To work out a price I just need to know: ${q.missing.join(' ')}`;
  const price = `£${Math.round(q.total)}`;
  return `For a ${q.service.toLowerCase()} the estimate is about ${price} including VAT. That's an estimate, and the team will confirm the final price.${q.notes.length ? ' ' + q.notes.join(' ') : ''}`;
}

const AI_QUOTE_SYSTEM = `You help a UK small business price a job its standard price list does not cover.
Use ONLY the business's own services and rates provided. Propose net (ex-VAT) line items with your estimated cost per line.
Do not calculate VAT or totals. If you cannot price it sensibly, return no lines and up to 3 short questions.
This is a draft the business owner will check before anything reaches the customer.`;

function aiQuotePrompt({ client, services, factors, input }) {
  return `Business: ${client.clientName} (${client.industry})
Customer request: ${input.description || input.service}
Answers given: ${JSON.stringify(input.answers || {})}
Price list (services): ${JSON.stringify(services.map((s) => ({ name: s.name, base: s.basePrice, unit: s.unitName, perUnit: s.unitPrice, cost: s.baseCost, unitCost: s.unitCost })))}
Pricing factors: ${JSON.stringify(factors.map((x) => ({ name: x.name, type: x.type, amount: x.amount })))}
Minimum margin: ${client.quotes.minMarginPct}%`;
}

const AI_QUOTE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['lines', 'questions', 'reasoning', 'confidence'],
  properties: {
    lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['description', 'amount', 'cost'], properties: { description: { type: 'string' }, amount: { type: 'number' }, cost: { type: 'number' } } } },
    questions: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
    confidence: { type: 'number' },
  },
};

// Totals for AI-proposed lines (same VAT / margin rules).
function totalsFromLines(lines, client) {
  const vatRate = client.invoice.vatRatePct === undefined ? 20 : client.invoice.vatRatePct;
  const subtotal = r2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const vat = r2(subtotal * vatRate / 100);
  const cost = r2(lines.reduce((s, l) => s + (Number(l.cost) || 0), 0));
  const marginPct = subtotal > 0 ? r2((subtotal - cost) / subtotal * 100) : 0;
  return { subtotal, vat, vatRate, total: r2(subtotal + vat), cost, marginPct, minMarginPct: client.quotes.minMarginPct, belowMarginFloor: subtotal > 0 && marginPct < client.quotes.minMarginPct };
}

module.exports = { loadServices, loadFactors, matchService, calculate, phoneSentence, AI_QUOTE_SYSTEM, aiQuotePrompt, AI_QUOTE_SCHEMA, totalsFromLines, truthy, r2 };
