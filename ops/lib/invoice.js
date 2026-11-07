'use strict';
// Invoice Automation: the fixed core plus the guardrails around the exception agent.
// Hard rule: every invoice payload built here is a Xero DRAFT. Nothing in this module
// can authorise, approve or send an invoice.

const { obj } = require('./agent');

const GENERIC_DESCRIPTIONS = ['job', 'work', 'misc', 'stuff', 'labour', 'service', 'as discussed', 'see notes', 'n/a', 'tbc', 'various', 'done', 'complete', 'completed'];

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[£,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Accepts an Airtable Jobs row, a flat n8n item, or the legacy webhook/Sheet payload.
function normalizeJob(raw) {
  const f = raw && raw.fields ? raw.fields : raw || {};
  const pick = (...keys) => { for (const k of keys) if (f[k] !== undefined && f[k] !== null && f[k] !== '') return f[k]; return undefined; };
  let lineItems = pick('Line items', 'lineItems');
  if (typeof lineItems === 'string') {
    try { lineItems = JSON.parse(lineItems); } catch (e) { lineItems = { __invalid: true, raw: lineItems }; }
  }
  const status = pick('Status', 'status');
  return {
    recordId: raw.id || f.id || null,
    jobId: String(pick('Job ID', 'jobId') || '').trim(),
    clientId: String(pick('Client ID', 'clientId') || '').trim(),
    status: (status && status.name) || status || '',
    customerId: String(pick('Customer ID', 'customerId') || '').trim(),
    customerName: String(pick('Customer name', 'customerName') || '').trim(),
    customerEmail: String(pick('Customer email', 'customerEmail') || '').trim().toLowerCase(),
    customerPhone: String(pick('Customer phone', 'customerPhone') || '').trim(),
    description: String(pick('Job description', 'jobDescription') || '').trim(),
    value: num(pick('Job value', 'jobValue')),
    lineItems: lineItems || null,
    paymentMethod: String(pick('Payment method', 'paymentMethod') || '').trim(),
    completedAt: pick('Completed at', 'completedAt') || null,
    xeroInvoiceId: pick('Xero invoice ID', 'invoiceReference', 'xeroInvoiceId') || '',
    errorMessage: String(pick('Error message', 'errorMessage') || ''),
  };
}

// Returns {route, issues}. route: 'core' | 'agent' | 'skip'.
//  - core: clean data, so the fixed pipeline runs with no AI.
//  - agent: messy or ambiguous data goes to the exception agent.
//  - skip: already invoiced, or the job belongs to a different client (isolation).
function assessJob(job, { client, recentInvoices = [] } = {}) {
  const issues = [];
  const add = (code, severity, message) => issues.push({ code, severity, message });

  if (client && job.clientId && job.clientId !== client.clientId) add('CLIENT_MISMATCH', 'skip', 'Job client ID does not match the registry row');
  if (job.xeroInvoiceId) add('ALREADY_INVOICED', 'skip', `Job already linked to Xero invoice ${job.xeroInvoiceId}`);
  if (!job.jobId) add('MISSING_JOB_ID', 'ambiguous', 'No job ID');
  if (!job.customerName) add('MISSING_CUSTOMER_NAME', 'ambiguous', 'No customer name');
  if (!job.customerEmail) add('MISSING_EMAIL', 'warn', 'No customer email; draft will be created without one');
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(job.customerEmail)) add('INVALID_EMAIL', 'ambiguous', `Email looks wrong: ${job.customerEmail}`);

  if (job.value === null) add('MISSING_VALUE', 'ambiguous', 'No job value');
  else if (Number.isNaN(job.value)) add('UNPARSEABLE_VALUE', 'ambiguous', 'Job value is not a number');
  else if (job.value === 0) add('ZERO_VALUE', 'ambiguous', 'Job value is zero');
  else if (job.value < 0) add('NEGATIVE_VALUE', 'ambiguous', 'Job value is negative (credit note?)');

  if (job.lineItems && job.lineItems.__invalid) add('INVALID_LINE_ITEMS', 'ambiguous', 'Line items are not valid JSON');
  else if (Array.isArray(job.lineItems) && job.lineItems.length) {
    const sum = round2(job.lineItems.reduce((a, l) => a + (num(l.amount) || 0), 0));
    if (job.value && !Number.isNaN(job.value) && Math.abs(sum - job.value) > 0.01) add('CONFLICTING_AMOUNTS', 'ambiguous', `Line items total £${sum} but job value is £${job.value}`);
    if (job.lineItems.some((l) => !l.description || num(l.amount) === null || Number.isNaN(num(l.amount)))) add('INCOMPLETE_LINE_ITEM', 'ambiguous', 'A line item is missing a description or amount');
  }

  const d = job.description.toLowerCase().replace(/[^a-z\s/]/g, '').trim();
  if (!d) add('MISSING_DESCRIPTION', 'ambiguous', 'No job description');
  else if (d.length < 6 || GENERIC_DESCRIPTIONS.includes(d)) add('VAGUE_DESCRIPTION', 'ambiguous', `Description too vague for an invoice: "${job.description}"`);

  const dup = findPossibleDuplicate(job, recentInvoices);
  if (dup) add('POSSIBLE_DUPLICATE', 'ambiguous', `Looks like ${dup.jobId || dup.invoiceNumber} (${dup.reason})`);

  const route = issues.some((i) => i.severity === 'skip') ? 'skip' : issues.some((i) => i.severity === 'ambiguous') ? 'agent' : 'core';
  return { route, issues };
}

// recentInvoices: [{jobId, customerName, customerEmail, value, description, invoiceNumber, date}] from the SAME client only.
function findPossibleDuplicate(job, recentInvoices) {
  for (const r of recentInvoices || []) {
    if (r.jobId && job.jobId && r.jobId === job.jobId) return { ...r, reason: 'same job ID already invoiced' };
    const sameCustomer = (r.customerEmail && r.customerEmail === job.customerEmail) || (r.customerName && r.customerName.toLowerCase() === job.customerName.toLowerCase());
    const sameValue = job.value && Math.abs((num(r.value) || 0) - job.value) < 0.01;
    const sameDesc = r.description && job.description && r.description.toLowerCase().trim() === job.description.toLowerCase().trim();
    if (sameCustomer && sameValue && sameDesc) return { ...r, reason: 'same customer, amount and description' };
  }
  return null;
}

// Discounts are per client. Only rows for THIS client are ever considered.
function findDiscount(job, discounts, client, today) {
  const t = (today || new Date()).toISOString().slice(0, 10);
  const candidates = (discounts || []).map((r) => (r.fields ? r.fields : r)).filter((d) => {
    if ((d['Client ID'] || '').trim() !== client.clientId) return false;
    if (d['Active'] === false) return false;
    if (d['Valid until'] && d['Valid until'] < t) return false;
    const byId = d['Customer ID'] && job.customerId && d['Customer ID'] === job.customerId;
    const byNameEmail = !d['Customer ID'] && d['Customer name'] && d['Customer name'].toLowerCase() === job.customerName.toLowerCase() &&
      (!d['Customer email'] || d['Customer email'].toLowerCase() === job.customerEmail);
    if (!byId && !byNameEmail) return false;
    if (d['Applies to'] && !job.description.toLowerCase().includes(String(d['Applies to']).toLowerCase())) return false;
    return true;
  });
  if (!candidates.length) return null;
  // Airtable percent fields store 0.1 for 10%. Accept 10 too.
  const pct = (d) => { const v = Number(d['Discount %']) || 0; return v <= 1 ? v * 100 : v; };
  const best = candidates.sort((a, b) => pct(b) - pct(a))[0];
  return { ruleName: best['Rule'] || '', percent: Math.min(100, Math.max(0, pct(best))) };
}

function buildLineItems(job, client, discount, opts = {}) {
  const cfg = client.invoice;
  let lines;
  if ((cfg.milestoneInvoicingEnabled || opts.forceMultiLine) && Array.isArray(job.lineItems) && job.lineItems.length) {
    lines = job.lineItems.map((l) => ({ description: String(l.description), amount: round2(num(l.amount)) }));
  } else {
    lines = [{ description: job.description, amount: round2(job.value) }];
  }
  return lines.map((l) => {
    const li = { Description: l.description.slice(0, 4000), Quantity: 1, UnitAmount: l.amount, AccountCode: cfg.accountCode };
    if (discount && discount.percent > 0) li.DiscountRate = round2(discount.percent);
    return li;
  });
}

// Contact matching. Xero contact names must be unique, so a same-name, different
// customer gets a suffix like "Alex Morgan (DISAMB-CUST-A2)". Reuse a contact only
// when the name AND (email or phone) match.
function digits(p) { return String(p || '').replace(/\D/g, '').replace(/^44/, '0'); }

function chooseContact(job, existingContacts) {
  const base = job.customerName.trim();
  const candidates = (existingContacts || []).filter((c) => {
    const n = String(c.Name || '');
    return n === base || n.startsWith(base + ' (DISAMB-');
  });
  for (const c of candidates) {
    const emailMatch = job.customerEmail && c.EmailAddress && c.EmailAddress.toLowerCase() === job.customerEmail;
    const phones = (c.Phones || []).map((p) => digits((p.PhoneAreaCode || '') + (p.PhoneNumber || ''))).filter(Boolean);
    const phoneMatch = job.customerPhone && phones.includes(digits(job.customerPhone));
    if (emailMatch || phoneMatch) return { action: 'reuse', contactId: c.ContactID, name: c.Name };
  }
  const nameTaken = candidates.some((c) => c.Name === base);
  const suffixId = job.customerId || (job.customerEmail ? job.customerEmail.split('@')[0].toUpperCase().slice(0, 12) : job.jobId);
  const name = nameTaken ? `${base} (DISAMB-${suffixId})` : base;
  const contact = { Name: name };
  if (job.customerEmail) contact.EmailAddress = job.customerEmail;
  if (job.customerPhone) contact.Phones = [{ PhoneType: 'MOBILE', PhoneNumber: job.customerPhone }];
  if (job.customerId) contact.AccountNumber = job.customerId;
  return { action: 'create', contact, name };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildXeroDraftInvoice({ job, client, contactId, lineItems, note, today }) {
  const date = (today || new Date()).toISOString().slice(0, 10);
  const ref = [job.jobId, note ? 'AI-checked' : ''].filter(Boolean).join(' | ').slice(0, 255);
  const invoice = {
    Type: 'ACCREC',
    Contact: { ContactID: contactId },
    Date: date,
    DueDate: addDays(date, client.invoice.paymentTermsDays || 14),
    LineAmountTypes: client.invoice.invoiceLineAmountType || 'Inclusive',
    LineItems: lineItems,
    Reference: ref,
    Status: 'DRAFT',
  };
  assertDraft(invoice);
  return { Invoices: [invoice] };
}

// Belt and braces: refuse anything that isn't a draft.
function assertDraft(payload) {
  const list = payload.Invoices || [payload];
  for (const inv of list) {
    if (inv.Status !== 'DRAFT') throw new Error(`KEYSTONE GUARDRAIL: invoice status must be DRAFT, got ${inv.Status}`);
  }
  return true;
}

// ---------- Exception agent ----------

const EXCEPTION_AGENT_SCHEMA = obj({
  decision: { type: 'string', enum: ['create_draft', 'needs_review', 'skip_duplicate'] },
  confidence: { type: 'number' },
  reasoning: { type: 'string' },
  noteForDraft: { type: 'string' },
  corrected: obj({
    customerName: { type: 'string' },
    customerEmail: { type: 'string' },
    lineItems: { type: 'array', items: obj({ description: { type: 'string' }, amount: { type: 'number' } }) },
  }),
});

const EXCEPTION_AGENT_SYSTEM = `You are Keystone's invoice exception agent. A UK small business's job record failed automatic checks. Work out the most likely correct invoice from the data you are given.
Rules:
- You can only prepare a DRAFT. A human approves every invoice. Never suggest sending or approving.
- Use only amounts that appear in the data (job value, line item amounts, or their sums). Never invent, estimate or round a price. If the right amount is unclear, choose needs_review.
- Pick create_draft only if you would bet on being right. Otherwise choose needs_review and explain what a human must check.
- If it looks like a repeat of an invoice already raised, choose skip_duplicate unless the data clearly shows it is separate work.
- Write invoice line descriptions a customer would understand, based on the job description. Keep them factual and don't add work that isn't in the data.
- noteForDraft is a short internal note (max 200 characters) saying what you changed and why.
- confidence runs from 0 to 1.`;

function exceptionAgentPrompt(job, issues, { recentInvoices = [], client }) {
  return `Client business: ${client.clientName} (${client.industry || 'trade business'})
VAT handling: amounts are ${client.invoice.invoiceLineAmountType}
Checks that failed:
${issues.map((i) => `- ${i.code}: ${i.message}`).join('\n')}

Job record (JSON):
${JSON.stringify({ jobId: job.jobId, customerId: job.customerId, customerName: job.customerName, customerEmail: job.customerEmail, customerPhone: job.customerPhone, description: job.description, value: job.value, lineItems: job.lineItems, paymentMethod: job.paymentMethod }, null, 2)}

Recent invoices for this same client (possible duplicates):
${JSON.stringify(recentInvoices.slice(0, 15), null, 2)}`;
}

const CONFIDENCE_THRESHOLD = 0.8;

// Applies the guardrails to the agent's answer. Returns {action:'draft'|'review'|'skip', job, note, reason}.
function applyAgentDecision(job, agentResult, issues) {
  if (!agentResult || !agentResult.ok) {
    return { action: 'review', reason: `Agent unavailable (${agentResult ? agentResult.error : 'no result'}); sent to review.` };
  }
  const a = agentResult.data;
  if (a.decision === 'skip_duplicate' && a.confidence >= CONFIDENCE_THRESHOLD) return { action: 'skip', reason: a.reasoning };
  if (a.decision !== 'create_draft') return { action: 'review', reason: a.reasoning };
  if (typeof a.confidence !== 'number' || a.confidence < CONFIDENCE_THRESHOLD) return { action: 'review', reason: `Confidence ${a.confidence} below ${CONFIDENCE_THRESHOLD}. ${a.reasoning}` };

  const lines = (a.corrected && a.corrected.lineItems) || [];
  if (!lines.length || lines.some((l) => !(l.amount > 0) || !l.description)) return { action: 'review', reason: 'Agent proposed invalid line items. ' + a.reasoning };
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));

  // Money guardrail: the total, or every line amount, must already exist in the source data.
  const sourceAmounts = new Set();
  if (job.value && job.value > 0) sourceAmounts.add(round2(job.value));
  if (Array.isArray(job.lineItems)) {
    const amts = job.lineItems.map((l) => num(l.amount)).filter((x) => x > 0).map(round2);
    amts.forEach((x) => sourceAmounts.add(x));
    if (amts.length) sourceAmounts.add(round2(amts.reduce((s, x) => s + x, 0)));
  }
  const linesFromSource = lines.every((l) => sourceAmounts.has(round2(l.amount)));
  if (!sourceAmounts.has(total) && !linesFromSource) return { action: 'review', reason: `Agent total £${total} does not match any amount in the job data. ${a.reasoning}` };

  if (issues.some((i) => i.code === 'MISSING_CUSTOMER_NAME') && !a.corrected.customerName) return { action: 'review', reason: 'No customer name could be determined.' };

  const fixed = {
    ...job,
    customerName: (a.corrected.customerName || job.customerName).trim(),
    customerEmail: (a.corrected.customerEmail || job.customerEmail || '').trim().toLowerCase(),
    lineItems: lines,
    value: total,
    description: lines.length === 1 ? lines[0].description : job.description || lines.map((l) => l.description).join('; '),
  };
  return { action: 'draft', job: fixed, forceMultiLine: lines.length > 1, note: String(a.noteForDraft || '').slice(0, 200), reason: a.reasoning, confidence: a.confidence };
}

module.exports = {
  num, round2, normalizeJob, assessJob, findPossibleDuplicate, findDiscount, buildLineItems, chooseContact,
  buildXeroDraftInvoice, assertDraft, EXCEPTION_AGENT_SCHEMA, EXCEPTION_AGENT_SYSTEM, exceptionAgentPrompt,
  applyAgentDecision, CONFIDENCE_THRESHOLD,
};
