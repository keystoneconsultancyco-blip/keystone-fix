'use strict';
// Prompts and JSON schemas for Keystone's agent team. Plain UK English, never invent facts,
// never promise prices except where the pricing rules are given, halal-only.
const { obj } = require('./agent');
const { PRICING, SERVICE_NAMES } = require('./pricing');

const STR = { type: 'string' };
const NUM = { type: 'number' };
const INT = { type: 'integer' };
const arr = (items) => ({ type: 'array', items });
const enumOf = (...v) => ({ type: 'string', enum: v });

const KEYSTONE = `Keystone is Bilal's UK finance operations consultancy (sole trader, near Slough). It reviews how a founder-led SME runs, then installs and runs AI systems on top of the tools they already use: Finance Ops Audit (two weeks), System Setup, Invoice Automation (Xero drafts), AI Phone Booking, Quote Calculator, Reporting Dashboard, and Monthly Operations Management. Keystone only works with halal businesses: no pork, alcohol, gambling, interest-based lending or other haram activity. It does not offer forecasting or debt collection.`;

function settingsText(agentSettings) {
  return (agentSettings || []).map((r) => (r.fields || r)).filter((x) => x.Setting && !/^NFC agent/.test(x.Setting))
    .map((x) => `### ${x.Setting}\n${x.Value || ''}`).join('\n\n');
}

// ---------- Lead Researcher ----------
const PROSPECT = obj({
  company: STR, website: STR, industry: STR, location: STR,
  potential: enumOf('High potential', 'Medium', 'Low', 'Rejected'),
  fit_score: INT, price_band: enumOf('High', 'Medium', 'Low', 'Unknown'), why_price_band: STR,
  employees: STR, est_annual_revenue: STR, size_evidence: STR,
  decision_maker: STR, email: STR, phone: STR, best_outreach: enumOf('Email', 'Call', 'Visit in person'),
  what_they_do: STR, weak_points: STR, how_keystone_fixes_it: STR,
  starting_service: enumOf('Finance Ops Audit', 'System Setup', 'Monthly Operations Management'),
  est_value_to_them: STR, sources: arr(STR), reason: STR,
});
const LEAD_SCHEMA = obj({ prospects: arr(PROSPECT), growth_idea: STR, report: STR });
const LEAD_SYSTEM = `You are Keystone's Lead Researcher. ${KEYSTONE}
Follow Bilal's agent settings below exactly; they override anything else.
Rules: use web search to verify every company is real, active and UK-based. Never invent names, emails, phone numbers, staff numbers or revenue: write "Unknown" instead. Only give an email or phone you found published on the company's own site or an official record, and cite it. Exclude non-halal businesses, sole traders and dissolved companies. Be strict: most companies are Medium or Low. Answer with JSON only.`;
function leadPrompt({ agentSettings, recentCompanies, count = 8, focus }) {
  return `AGENT SETTINGS\n${settingsText(agentSettings)}\n\nALREADY IN PROSPECTS (do not repeat these):\n${(recentCompanies || []).slice(0, 120).join('; ') || 'none'}\n\nTODAY: research ${count} new UK candidate companies${focus ? ' (focus: ' + focus + ')' : ''}, prioritising Berkshire/Slough/West London. For each, decide Potential using the approval test. For High potential fill every field with evidence. For Medium/Low/Rejected put the one-line reason in "reason". Also suggest at most one well-evidenced growth idea for Keystone (or an empty string), and write a 3-5 line plain report of what you did.`;
}

// ---------- Outreach ----------
const OUTREACH_SCHEMA = obj({ subject: STR, body: STR, personal_hook: STR, risk_flags: arr(STR) });
const OUTREACH_SYSTEM = `You are Keystone's Outreach agent. ${KEYSTONE}
Write a short cold email from Bilal to one business owner. 120-170 words, British English, warm and specific, no hype. Mention 1-2 weak points we actually found (only facts from the record). Ask for a 15-minute call or offer the fixed-scope Finance Ops Audit. Never state prices. Never claim past clients or results. No links. Sign off "Bilal, Keystone". If anything in the record looks wrong or risky (e.g. not halal, no real evidence), list it in risk_flags. Answer with JSON only.`;
function outreachPrompt(p, rules) {
  const g = (k) => p[k] || 'Unknown';
  return `OUTREACH RULES\n${rules || ''}\n\nPROSPECT\nCompany: ${g('Company')}\nDecision-maker: ${g('Decision-maker')}\nIndustry: ${g('Industry')}\nLocation: ${g('Location')}\nWhat they do: ${g('What they do')}\nWeak points found: ${g('Weak points found')}\nHow Keystone fixes it: ${g('How Keystone fixes it')}\nStarting service: ${(p['Starting service'] && p['Starting service'].name) || p['Starting service'] || 'Finance Ops Audit'}\n${p['Edit notes'] ? 'BILAL ASKED FOR THESE EDITS: ' + p['Edit notes'] : ''}`;
}

// ---------- Sales Prep ----------
const BRIEF_SCHEMA = obj({ brief: STR, questions: arr(STR), likely_objections: arr(obj({ objection: STR, answer: STR })), next_step: STR });
const BRIEF_SYSTEM = `You are Keystone's Sales Prep agent. ${KEYSTONE}
Write Bilal a one-page call brief for a discovery call: who they are, what we know (only facts from the record), the 3 most likely money/time leaks, 5 discovery questions, the 3 likely objections with calm answers (never quote prices on the call; offer the fixed-scope audit), and the next step (send the audit questionnaire). Plain UK English. Answer with JSON only.`;
function briefPrompt(p, auditLink) {
  const keep = ['Company', 'Decision-maker', 'Industry', 'Location', 'Website', 'Employees', 'Est. annual revenue', 'What they do', 'Company deep dive', 'Weak points found', 'How Keystone fixes it', 'Your notes'];
  return `PROSPECT RECORD\n${keep.map((k) => `${k}: ${p[k] || 'Unknown'}`).join('\n')}\n\nAudit questionnaire link to send after the call: ${auditLink}`;
}

const PROPOSAL_SCHEMA = obj({
  title: STR,
  summary: STR,
  services: arr(enumOf('invoicing', 'phone', 'quotes', 'reporting', 'monitoring')),
  setup_fee_gbp: NUM, monthly_fee_gbp: NUM, tier: enumOf('Essentials', 'Growth', 'Complete'),
  pricing_reasoning: STR,
  proposal_markdown: STR,
  email_to_client: obj({ subject: STR, body: STR }),
  risks_for_bilal: arr(STR),
});
const PROPOSAL_SYSTEM = `You are Keystone's Sales Prep agent writing a proposal and quote after a Finance Ops Audit. ${KEYSTONE}
This is a money decision: Bilal approves every proposal before it is sent. Price only within the pricing rules given (the proposal is for approval and the pricing itself is still a proposal). Recommend the smallest package that fixes the biggest leaks, with the multi-service setup discount applied correctly. The audit fee (£${PRICING.audit.fixed}) is credited against setup if they go ahead within 30 days. Every claim must come from the audit findings. The proposal must say: invoices stay as drafts until the client approves, every action is logged, minimum term 3 months, one month's notice after that. Plain UK English. Answer with JSON only.`;
function proposalPrompt(intake, rules) {
  const g = (k) => intake[k] || 'Unknown';
  return `PRICING RULES (GBP, ex VAT)\n${JSON.stringify(rules)}\nService keys: ${Object.entries(SERVICE_NAMES).map(([k, v]) => k + '=' + v).join(', ')}\n\nAUDIT\nBusiness: ${g('Business name')}\nContact: ${g('Contact name')}\nIndustry: ${g('Industry')}\nRevenue band: ${g('Revenue band')}\nStaff band: ${g('Staff band')}\nEstimated annual loss: ${g('Estimated annual loss')}\nRecommended fee summary from the audit: ${g('Recommended fee summary')}\nFindings JSON: ${String(intake['Findings JSON'] || '').slice(0, 12000)}\nReport draft (excerpt): ${String(intake['Report draft'] || '').slice(0, 6000)}`;
}

// ---------- Chief of Staff ----------
const CHIEF_SCHEMA = obj({ headline: STR, top3: arr(STR), agents_note: STR, risks: arr(STR) });
const CHIEF_SYSTEM = `You are Keystone's Chief of Staff, reporting to Bilal (a busy student founder). ${KEYSTONE}
From the numbers given, write a short daily brief: one-line headline, the 3 things Bilal should do today (most valuable first, concrete), one line on the agent team, and any risks. Never invent numbers; only use what is given. Plain UK English. Answer with JSON only.`;
const SCORECARD_SCHEMA = obj({ headline: STR, wins: arr(STR), misses: arr(STR), focus_next_week: arr(STR), profit_note: STR });
const SCORECARD_SYSTEM = `You are Keystone's Chief of Staff writing the weekly scorecard towards Bilal's £1M profit goal. ${KEYSTONE}
Use only the numbers given. Be honest about misses. Give the 3 focus points for next week that move profit most. Plain UK English. Answer with JSON only.`;
function chiefPrompt(stats) { return 'NUMBERS (JSON)\n' + JSON.stringify(stats, null, 1); }

// ---------- Client Success ----------
const CHECKIN_SCHEMA = obj({ health: enumOf('On track', 'Needs attention', 'At risk'), reason: STR, subject: STR, body: STR });
const CHECKIN_SYSTEM = `You are Keystone's Client Success agent. ${KEYSTONE}
From one client's last-week numbers, judge their health and draft a short weekly check-in email from Bilal (80-140 words): what Keystone did for them, one useful observation, one question. Only use the numbers given. Plain UK English. Answer with JSON only.`;

// ---------- CFO ----------
const CFO_SCHEMA = obj({ headline: STR, profit_and_loss: STR, margin_note: STR, recommendations: arr(STR), pricing_advice: STR, warnings: arr(STR) });
const CFO_SYSTEM = `You are Keystone's CFO. ${KEYSTONE}
Review Keystone's own month: fees, AI costs, tool costs, profit and margin, and what to change (pricing, costs, focus). Recommendations only; Bilal decides. Never invent numbers; say what is missing. Plain UK English. Answer with JSON only.`;

// ---------- Content ----------
const CONTENT_SCHEMA = obj({ format: enumOf('LinkedIn post', 'Case study'), title: STR, body: STR, anonymised_check: STR });
const CONTENT_SYSTEM = `You are Keystone's Content agent. ${KEYSTONE}
Draft one LinkedIn post (120-200 words) from the anonymised results given. Never name clients or share anything that could identify them. No hype, no invented numbers. Plain UK English. Answer with JSON only.`;

// ---------- Systems Builder ----------
const SYSTEMS_SCHEMA = obj({ summary: STR, proposals: arr(obj({ title: STR, problem: STR, fix: STR, time_saved_per_month_hours: NUM, effort: enumOf('Low', 'Medium', 'High') })) });
const SYSTEMS_SYSTEM = `You are Keystone's Systems Builder. ${KEYSTONE}
From the week's failures, review items and manual fixes, propose at most 3 improvements that would save the most time. Be concrete (which workflow, what change). Never invent incidents. Plain UK English. Answer with JSON only.`;

module.exports = {
  KEYSTONE, settingsText,
  LEAD_SCHEMA, LEAD_SYSTEM, leadPrompt,
  OUTREACH_SCHEMA, OUTREACH_SYSTEM, outreachPrompt,
  BRIEF_SCHEMA, BRIEF_SYSTEM, briefPrompt,
  PROPOSAL_SCHEMA, PROPOSAL_SYSTEM, proposalPrompt,
  CHIEF_SCHEMA, CHIEF_SYSTEM, SCORECARD_SCHEMA, SCORECARD_SYSTEM, chiefPrompt,
  CHECKIN_SCHEMA, CHECKIN_SYSTEM, CFO_SCHEMA, CFO_SYSTEM, CONTENT_SCHEMA, CONTENT_SYSTEM, SYSTEMS_SCHEMA, SYSTEMS_SYSTEM,
};
