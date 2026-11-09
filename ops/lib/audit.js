'use strict';
// Finance Ops Audit: halal screen, a 5-pillar diagnosis with explicit £/hour formulas,
// and the prompt for the audit-writing agent. The agent writes the narrative; all
// numbers come from here so they can be checked and defended in the meeting.

const { obj } = require('./agent');
const { priceProposal, SERVICE_NAMES } = require('./pricing');

// ---------- Halal screen (used by audit intake, onboarding and lead flows) ----------
const HARAM_TERMS = [
  'pork', 'bacon', 'gammon', 'charcuterie', 'alcohol', 'brewery', 'brewing', 'distillery', 'winery', 'wine bar', 'off licence', 'off-licence', 'liquor',
  'pub ', 'pubs', 'public house', 'bar & grill', 'cocktail', 'nightclub', 'casino', 'betting', 'bookmaker', 'bookies', 'gambling', 'lottery', 'slot machine', 'bingo',
  'payday', 'pawnbroker', 'money lending', 'moneylender', 'loan broker', 'consumer credit', 'interest-bearing', 'mortgage lender', 'adult entertainment', 'escort', 'strip club', 'cannabis', 'vape shop',
];
const CHECK_TERMS = ['restaurant', 'hotel', 'catering', 'events', 'convenience store', 'supermarket', 'finance', 'leasing', 'insurance', 'investment', 'butcher', 'takeaway', 'deli'];

function halalScreen(...texts) {
  const t = ' ' + texts.filter(Boolean).join(' ').toLowerCase() + ' ';
  const hits = HARAM_TERMS.filter((w) => t.includes(w));
  const checks = CHECK_TERMS.filter((w) => t.includes(w));
  return { pass: hits.length === 0, hits, needsManualCheck: hits.length === 0 && checks.length > 0, checks };
}

// ---------- Questionnaire ----------
const QUESTIONS = [
  { id: 'avg_job_value', pillar: 'invoicing', q: 'Average invoice value (£)', type: 'number' },
  { id: 'invoices_per_month', pillar: 'invoicing', q: 'Invoices sent per month', type: 'number' },
  { id: 'days_to_invoice', pillar: 'invoicing', q: 'Days from job finished to invoice sent (typical)', type: 'number' },
  { id: 'avg_days_to_pay', pillar: 'invoicing', q: 'Average days for customers to pay', type: 'number' },
  { id: 'payment_terms_days', pillar: 'invoicing', q: 'Your payment terms (days)', type: 'number' },
  { id: 'admin_hours_invoicing_week', pillar: 'invoicing', q: 'Hours per week spent creating and chasing invoices', type: 'number' },
  { id: 'cash_check_frequency', pillar: 'cash', q: 'How often do you check your cash position?', type: 'choice', options: ['daily', 'weekly', 'monthly', 'rarely'] },
  { id: 'cash_surprises_year', pillar: 'cash', q: 'Times in the last year cash was tighter than expected', type: 'number' },
  { id: 'reports_monthly', pillar: 'reporting', q: 'Do you get a monthly P&L within 10 days of month end?', type: 'bool' },
  { id: 'kpis_tracked', pillar: 'reporting', q: 'Which numbers do you track weekly? (comma list)', type: 'text' },
  { id: 'admin_hours_reporting_month', pillar: 'reporting', q: 'Hours per month pulling numbers together', type: 'number' },
  { id: 'calls_per_week', pillar: 'bookings', q: 'Inbound calls per week', type: 'number' },
  { id: 'missed_call_pct', pillar: 'bookings', q: 'Share of calls missed or sent to voicemail (%)', type: 'number' },
  { id: 'call_to_job_pct', pillar: 'bookings', q: 'Share of answered enquiry calls that become jobs (%)', type: 'number' },
  { id: 'admin_hours_bookings_week', pillar: 'bookings', q: 'Hours per week spent on booking and rescheduling', type: 'number' },
  { id: 'quotes_per_week', pillar: 'planning', q: 'Quotes sent per week', type: 'number' },
  { id: 'quote_turnaround_days', pillar: 'planning', q: 'Days to send a quote (typical)', type: 'number' },
  { id: 'quote_win_pct', pillar: 'planning', q: 'Quote win rate (%)', type: 'number' },
  { id: 'has_budget', pillar: 'planning', q: 'Do you have a budget or plan for this year?', type: 'bool' },
  { id: 'systems', pillar: 'all', q: 'Tools you use (Xero, Tradify, spreadsheets...)', type: 'text' },
  { id: 'hourly_admin_cost', pillar: 'all', q: 'Loaded hourly cost of admin staff (£, default 28)', type: 'number' },
];

const PILLARS = {
  invoicing: 'Invoicing & collections',
  cash: 'Cash flow visibility',
  reporting: 'Reporting & KPIs',
  bookings: 'Bookings & admin',
  planning: 'Planning & growth',
};

function n(v, d = 0) { const x = Number(v); return isFinite(x) && v !== '' && v !== null && v !== undefined ? x : d; }
function r0(x) { return Math.round(x); }

// Deterministic findings. Each has evidence, a formula, £/year and hours/year, plus the fixing service.
function diagnose(answers, { xero, calls } = {}) {
  const a = answers || {};
  const rate = n(a.hourly_admin_cost, 28);
  const out = [];
  const add = (f) => out.push({ ...f, annualCost: r0(f.annualCost || 0), annualHours: r0(f.annualHours || 0) });

  // Pillar 1: invoicing and collections
  const avg = n(a.avg_job_value), perMonth = n(a.invoices_per_month);
  const delay = n(a.days_to_invoice), dtp = n(a.avg_days_to_pay), terms = n(a.payment_terms_days, 30);
  const invHours = n(a.admin_hours_invoicing_week);
  if (delay > 1 && avg && perMonth) {
    const tiedUp = (avg * perMonth * 12 / 365) * delay;
    add({ pillar: 'invoicing', title: `Invoices go out ${delay} days after the job`, evidence: `${perMonth} invoices/month at about £${avg}, sent ${delay} days late`, formula: 'daily invoiced value × days of delay = cash waiting to be invoiced at any time', cashTiedUp: r0(tiedUp), annualCost: invHours * 0.4 * 52 * rate, annualHours: invHours * 0.4 * 52, service: 'invoicing', severity: delay >= 5 ? 'high' : 'medium' });
  }
  if (invHours >= 3) add({ pillar: 'invoicing', title: `${invHours} hours a week spent on invoicing admin`, evidence: 'Self-reported', formula: 'hours/week × 60% automatable × 52 × hourly cost', annualCost: invHours * 0.6 * 52 * rate, annualHours: invHours * 0.6 * 52, service: 'invoicing', severity: invHours >= 8 ? 'high' : 'medium' });
  if (dtp > terms + 7) add({ pillar: 'invoicing', title: `Customers pay in ${dtp} days against ${terms}-day terms`, evidence: xero ? 'From Xero aged receivables' : 'Self-reported', formula: 'late days × daily invoiced value = extra cash waiting', cashTiedUp: r0((avg * perMonth * 12 / 365) * (dtp - terms)), annualCost: 0, annualHours: 0, service: 'reporting', severity: 'medium' });

  // Pillar 2: cash flow visibility
  const freq = a.cash_check_frequency, surprises = n(a.cash_surprises_year);
  if (['monthly', 'rarely'].includes(freq) || surprises >= 2) add({ pillar: 'cash', title: freq === 'rarely' ? 'Cash position is rarely checked' : `Cash surprises ${surprises} times last year`, evidence: `Checks cash ${freq || 'unknown'}; ${surprises} surprises`, formula: 'Qualitative. Each surprise typically costs 3-5 hours of firefighting.', annualCost: surprises * 4 * rate, annualHours: surprises * 4, service: 'reporting', severity: surprises >= 3 ? 'high' : 'medium' });

  // Pillar 3: reporting and KPIs
  const repHours = n(a.admin_hours_reporting_month);
  if (a.reports_monthly === false || a.reports_monthly === 'no' || repHours >= 4) add({ pillar: 'reporting', title: a.reports_monthly === false || a.reports_monthly === 'no' ? 'No timely monthly P&L' : `${repHours} hours a month compiling numbers`, evidence: `KPIs tracked: ${a.kpis_tracked || 'none stated'}`, formula: 'hours/month × 75% automatable × 12 × hourly cost', annualCost: repHours * 0.75 * 12 * rate, annualHours: repHours * 0.75 * 12, service: 'reporting', severity: 'medium' });

  // Pillar 4: bookings and admin
  const cpw = n(calls && calls.callsPerWeek !== undefined ? calls.callsPerWeek : a.calls_per_week);
  const missed = n(calls && calls.missedPct !== undefined ? calls.missedPct : a.missed_call_pct);
  const conv = n(a.call_to_job_pct, 30);
  if (cpw && missed >= 10 && avg) {
    const lostJobs = cpw * (missed / 100) * 0.5 * (conv / 100) * 52; // assume half of missed callers are new enquiries
    add({ pillar: 'bookings', title: `${missed}% of calls are missed`, evidence: calls ? 'From call data' : 'Self-reported', formula: 'calls/week × missed% × 50% new enquiries × conversion% × 52 × average job value', lostJobs: r0(lostJobs), annualCost: lostJobs * avg, annualHours: 0, service: 'phone', severity: missed >= 20 ? 'high' : 'medium' });
  }
  const bookHours = n(a.admin_hours_bookings_week);
  if (bookHours >= 3) add({ pillar: 'bookings', title: `${bookHours} hours a week booking and rescheduling`, evidence: 'Self-reported', formula: 'hours/week × 50% automatable × 52 × hourly cost', annualCost: bookHours * 0.5 * 52 * rate, annualHours: bookHours * 0.5 * 52, service: 'phone', severity: 'medium' });

  // Pillar 5: planning and growth
  const qpw = n(a.quotes_per_week), qt = n(a.quote_turnaround_days), win = n(a.quote_win_pct, 35);
  if (qpw && qt >= 2 && avg) {
    const uplift = Math.min(0.15, 0.04 * qt); // slower quotes lose more jobs; capped at a 15% relative uplift
    const extraWins = qpw * 52 * (win / 100) * uplift;
    add({ pillar: 'planning', title: `Quotes take ${qt} days to go out`, evidence: `${qpw} quotes/week, ${win}% win rate`, formula: 'quotes/yr × win% × relative uplift from same-day quotes (4%/day of delay, max 15%) × average job value', extraWins: r0(extraWins), annualCost: extraWins * avg, annualHours: qpw * 0.5 * 52, service: 'quotes', severity: qt >= 4 ? 'high' : 'medium' });
  }
  if (a.has_budget === false || a.has_budget === 'no') add({ pillar: 'planning', title: 'No budget or plan for the year', evidence: 'Self-reported', formula: 'Qualitative. Covered by the advisory upsell once the reporting is in place.', annualCost: 0, annualHours: 0, service: 'reporting', severity: 'low' });

  const services = [...new Set(out.map((f) => f.service))];
  if (services.length) services.push('monitoring');
  return {
    findings: out,
    pillarsCovered: Object.keys(PILLARS).map((p) => ({ pillar: p, name: PILLARS[p], findings: out.filter((f) => f.pillar === p).length })),
    totalAnnualCost: r0(out.reduce((s, f) => s + f.annualCost, 0)),
    totalAnnualHours: r0(out.reduce((s, f) => s + f.annualHours, 0)),
    totalCashTiedUp: r0(out.reduce((s, f) => s + (f.cashTiedUp || 0), 0)),
    recommendedServices: services,
  };
}

const AUDIT_REPORT_SCHEMA = obj({
  executiveSummary: { type: 'string' },
  pillars: {
    type: 'array',
    items: obj({ pillar: { type: 'string' }, rating: { type: 'string', enum: ['strong', 'ok', 'weak', 'critical'] }, narrative: { type: 'string' } }),
  },
  quickWins: { type: 'array', items: { type: 'string' } },
  questionsForMeeting: { type: 'array', items: { type: 'string' } },
});

const AUDIT_SYSTEM = `You are drafting a Finance Ops Audit report for Keystone, an outsourced operations team for UK founder-led SMEs. Bilal, the consultant, will review it and present it to the business owner.
Rules:
- Cover all 5 pillars: Invoicing & collections, Cash flow visibility, Reporting & KPIs, Bookings & admin, Planning & growth.
- Use ONLY the findings and figures provided, and quote them exactly. Never invent numbers. If a pillar has no finding, rate it ok or strong and say what evidence would confirm it.
- Plain English for a busy owner. Be specific and commercial, not salesy.
- Never recommend debt, loans, invoice finance or anything interest-based.
- questionsForMeeting: 3-6 questions Bilal should ask to firm up the estimates.`;

function auditPrompt(intake, diagnosis) {
  return `Business: ${intake.businessName} (${intake.industry}). Sells: ${intake.sells}. Revenue band: ${intake.revenueBand}. Staff: ${intake.staffBand}.
Systems: ${intake.answers && intake.answers.systems}
Findings (JSON): ${JSON.stringify(diagnosis.findings)}
Totals: £${diagnosis.totalAnnualCost}/year in lost time and revenue, ${diagnosis.totalAnnualHours} hours/year, £${diagnosis.totalCashTiedUp} of cash waiting to be invoiced or paid.`;
}

function buildAuditReportMarkdown(intake, diagnosis, agentReport, proposal) {
  const gbp = (x) => '£' + Number(x || 0).toLocaleString('en-GB');
  const lines = [];
  lines.push(`# Finance Ops Audit: ${intake.businessName}`, '', `*DRAFT for Keystone review. Prepared ${new Date().toISOString().slice(0, 10)}.*`, '');
  lines.push('## Summary', '', agentReport ? agentReport.executiveSummary : 'AI narrative unavailable. Findings below are complete.', '');
  lines.push(`**Estimated annual cost of current weaknesses:** ${gbp(diagnosis.totalAnnualCost)}  `, `**Admin hours recoverable per year:** ${diagnosis.totalAnnualHours}  `, `**Cash waiting to be invoiced or collected:** ${gbp(diagnosis.totalCashTiedUp)}`, '');
  lines.push('## The five pillars', '');
  for (const p of Object.keys(PILLARS)) {
    const ar = agentReport && agentReport.pillars.find((x) => x.pillar.toLowerCase().startsWith(PILLARS[p].toLowerCase().slice(0, 6)));
    lines.push(`### ${PILLARS[p]}${ar ? ` (${ar.rating})` : ''}`, '');
    if (ar) lines.push(ar.narrative, '');
    const fs = diagnosis.findings.filter((f) => f.pillar === p);
    if (!fs.length) lines.push('_No weakness found from the answers given._', '');
    for (const f of fs) {
      lines.push(`- **${f.title}.** Evidence: ${f.evidence}. Estimated cost: ${gbp(f.annualCost)}/yr${f.annualHours ? `, ${f.annualHours} hrs/yr` : ''}${f.cashTiedUp ? `, ${gbp(f.cashTiedUp)} cash waiting` : ''}. Fix: **${SERVICE_NAMES[f.service]}**.`);
      lines.push(`  - _How we worked it out:_ ${f.formula}`);
    }
    lines.push('');
  }
  if (agentReport && agentReport.quickWins.length) lines.push('## Quick wins (this month, no cost)', '', ...agentReport.quickWins.map((q) => `- ${q}`), '');
  lines.push('## Recommended Keystone package', '');
  lines.push('| Service | Fixes | One-off setup |', '|---|---|---|');
  for (const l of proposal.setup.lines) {
    const fixes = diagnosis.findings.filter((f) => f.service === l.key).map((f) => f.title).join('; ');
    lines.push(`| ${l.name} | ${fixes} | ${gbp(l.fee)} |`);
  }
  lines.push('', `Setup total${proposal.setup.discountPct ? ` (with ${proposal.setup.discountPct}% multi-service discount)` : ''}: **${gbp(proposal.setup.total)}** (no VAT: Keystone is not VAT registered).  `);
  lines.push(`Monthly package: **${proposal.package.name}, ${gbp(proposal.package.price)}/month** (${proposal.band.label} revenue band; ${proposal.package.includes}). Monitoring, fixes and alerts are included.  `);
  lines.push(proposal.terms + '  ');
  lines.push(`Audit fee: ${proposal.audit.note}`, '');
  const sc = proposal.senseCheck;
  lines.push(`_Sense check for Bilal: monthly fee ${gbp(sc.monthlyFee)} vs one-third of the monthly loss found ${gbp(sc.limit)}: ${sc.ok === null ? 'no loss figure' : sc.ok ? 'OK' : '**fee is above one-third of the monthly loss: review before presenting**'}${proposal.band.outOfRange ? '; revenue is outside the £500k–£10M bands, nearest band used' : ''}._`, '');
  if (agentReport && agentReport.questionsForMeeting.length) lines.push('## For Bilal: questions to ask in the meeting', '', ...agentReport.questionsForMeeting.map((q) => `- ${q}`), '');
  lines.push('---', '_Estimates are based on the answers provided and stated assumptions. Prices are estimates until confirmed in a proposal._');
  return lines.join('\n');
}

function runAuditCore(intake) {
  const screen = halalScreen(intake.industry, intake.sells, intake.businessName);
  if (!screen.pass) return { rejected: true, screen };
  const diagnosis = diagnose(intake.answers, { xero: intake.xero, calls: intake.calls });
  const proposal = priceProposal(diagnosis.recommendedServices.filter((s) => s !== 'monitoring'), { revenue: intake.revenueBand, monthlyLoss: diagnosis.totalAnnualCost / 12 });
  return { rejected: false, screen, diagnosis, proposal };
}

module.exports = { HARAM_TERMS, CHECK_TERMS, halalScreen, QUESTIONS, PILLARS, diagnose, AUDIT_REPORT_SCHEMA, AUDIT_SYSTEM, auditPrompt, buildAuditReportMarkdown, runAuditCore };
