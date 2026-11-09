'use strict';
// Turns Client Hunter's research (the 3 checks) into Airtable fields: Lead value, Audit offer, Why, Checks passed,
// Revenue band and an internal Website quote. Code, not AI, makes the final call, so the rules always hold:
// Free audit ONLY when Fit + Timing + Pain all pass with evidence, revenue is £1M–£10M, and they can afford
// £1,500+/month with urgent pain and strong recurring potential. Everyone else gets the £100 offer.
const P = require('./pricing');

const BAND_TO_FIELD = { under500k: 'Under £500k', '500k-1m': '£500k–£1M', '1m-3m': '£1M–£3M', '3m-10m': '£3M–£10M', over10m: 'Over £10M' };
const FIELD_TO_BAND = Object.fromEntries(Object.entries(BAND_TO_FIELD).map(([k, v]) => [v, k]));
const SERVICE_FIELD = { invoicing: 'Invoice Automation', phone: 'AI Phone Booking', quotes: 'Quote Calculator', reporting: 'Reporting Dashboard' };
const FIELD_SERVICE = Object.fromEntries(Object.entries(SERVICE_FIELD).map(([k, v]) => [v, k]));

const ok = (c) => !!(c && c.pass && String(c.evidence || '').trim() && !/^unknown/i.test(String(c.evidence).trim()));

function score(c, { timeWaster = false } = {}) {
  const band = c.revenue_band && c.revenue_band !== 'unknown' ? c.revenue_band : null;
  const inRange = band === '1m-3m' || band === '3m-10m';
  const fit = ok(c.check_fit) && inRange;
  const timing = ok(c.check_timing);
  const pain = ok(c.check_pain);
  const offer = P.auditOffer({ fit, timing, pain, affordable: !!c.can_afford_1500_month, urgent: !!c.urgent_inelastic_pain, recurring: !!c.strong_recurring_potential, timeWaster });
  const why = [
    `Fit: ${fit ? 'yes' : 'no'}${c.check_fit && c.check_fit.evidence ? ' – ' + c.check_fit.evidence : ''}${!inRange ? ' (revenue band ' + (band ? BAND_TO_FIELD[band] : 'unknown') + ', needs £1M–£10M)' : ''}`,
    `Timing: ${timing ? 'yes' : 'no'}${c.check_timing && c.check_timing.evidence ? ' – ' + c.check_timing.evidence : ''}`,
    `Pain: ${pain ? 'yes' : 'no'}${c.check_pain && c.check_pain.evidence ? ' – ' + c.check_pain.evidence : ''}`,
    offer.leadValue === 'High' ? 'High value: all 3 checks, can afford £1,500+/month, urgent pain, strong recurring potential.'
      : `Standard: ${[!fit && 'fit', !timing && 'timing', !pain && 'pain', !c.can_afford_1500_month && 'affordability', !c.urgent_inelastic_pain && 'urgency', !c.strong_recurring_potential && 'recurring potential', timeWaster && 'marked as possible time-waster'].filter(Boolean).join(', ') || 'not all conditions met'} not met.`,
  ].join('\n');
  const services = (c.services_needed || []).filter((s) => P.SERVICES.includes(s));
  const priced = services.length ? P.priceProposal(services, { revenue: band || '1m-3m' }) : null;
  const websiteQuote = priced ? `INTERNAL (never in first-touch emails)\n${priced.package.name} £${priced.package.price}/month (${band ? BAND_TO_FIELD[band] : 'revenue unknown: £1M–£3M band assumed'})\nSetup £${priced.setup.total}: ${priced.setup.lines.map((l) => l.name + ' £' + l.fee).join(', ')}${priced.setup.discountPct ? ' less ' + priced.setup.discountPct + '%' : ''}\nAudit offer: ${offer.shownAs}` : '';
  return { leadValue: offer.leadValue, auditOffer: offer.auditOffer, shownAs: offer.shownAs, why, checks: [fit && 'Fit', timing && 'Timing', pain && 'Pain'].filter(Boolean), revenueBandField: band ? BAND_TO_FIELD[band] : undefined, services, servicesField: services.map((s) => SERVICE_FIELD[s]), websiteQuote };
}

module.exports = { score, BAND_TO_FIELD, FIELD_TO_BAND, SERVICE_FIELD, FIELD_SERVICE };
