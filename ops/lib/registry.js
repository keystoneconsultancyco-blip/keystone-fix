'use strict';
// Client Registry: turns a "My Clients" Airtable row into one config object,
// and decides whether a given service may run for that client.
// Rule: every workflow calls gate() first and exits cleanly if it isn't ok.

const TEST_INBOX = 'keystoneconsultancy.co@gmail.com';

const SERVICE_TOGGLES = {
  invoicing: 'Invoicing on',
  phone: 'Phone on',
  quotes: 'Quotes on',
  reporting: 'Reporting on',
  monitoring: 'Monitoring on',
};

// Jurisdictions where the phone agent must NOT be deployed (proactive AI disclosure required).
const BLOCKED_PHONE_JURISDICTIONS = ['Republic of Ireland / EU'];

function parseJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (e) { return { __invalid: true, raw: String(value) }; }
}

function splitList(value) {
  if (!value) return [];
  return String(value).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

// Accepts an Airtable record ({id, fields}) or a flattened n8n Airtable item.
function normalizeClient(record) {
  const f = record && record.fields ? record.fields : record || {};
  const services = parseJson(f['Services'], []);
  const hours = parseJson(f['Opening hours'], {});
  const pricing = parseJson(f['Pricing rules'], null);
  return {
    recordId: record.id || f.id || null,
    clientId: (f['Client ID'] || '').trim(),
    clientName: f['Client name'] || '',
    status: (f['Status'] && f['Status'].name) || f['Status'] || 'Onboarding',
    isDemo: !!f['Is demo/test'],
    contactName: f['Contact name'] || '',
    contactEmail: f['Contact email'] || '',
    contactPhone: f['Contact phone'] || '',
    industry: f['Industry'] || '',
    halalPassed: !!f['Halal screen passed'],
    jurisdiction: (f['Jurisdiction'] && f['Jurisdiction'].name) || f['Jurisdiction'] || '',
    aiDisclosurePassed: !!f['AI disclosure check passed'],
    toggles: {
      invoicing: !!f['Invoicing on'],
      phone: !!f['Phone on'],
      quotes: !!f['Quotes on'],
      reporting: !!f['Reporting on'],
      monitoring: !!f['Monitoring on'],
    },
    businessEmail: f['Business email'] || f['Contact email'] || '',
    timezone: f['Timezone'] || 'Europe/London',
    invoice: {
      brandLogoUrl: f['Brand logo URL'] || '',
      brandColour: f['Brand colour'] || '#1F3A5F',
      paymentOptions: f['Payment options'] || '',
      sendWindowStart: f['Send window start'] || '',
      sendWindowEnd: f['Send window end'] || '',
      milestoneInvoicingEnabled: !!f['Milestone invoicing enabled'],
      invoiceLineAmountType: (f['Invoice line amount type'] && f['Invoice line amount type'].name) || f['Invoice line amount type'] || 'Inclusive',
      vatRatePct: f['VAT rate %'] === undefined || f['VAT rate %'] === null ? 20 : Number(f['VAT rate %']),
      accountCode: f['Xero account code'] || '200',
      paymentTermsDays: f['Payment terms days'] === undefined || f['Payment terms days'] === null ? 14 : Number(f['Payment terms days']),
      xeroCredentialName: f['Xero credential name'] || '',
      xeroTenantId: f['Xero organisation ID'] || '',
      jobSource: (f['Job source'] && f['Job source'].name) || f['Job source'] || 'Airtable Jobs table',
    },
    phone: {
      businessNumber: normalizePhone(f['Business phone number']),
      receptionNumber: normalizePhone(f['Reception forwarding number']),
      calendarId: f['Calendar ID'] || '',
      services: Array.isArray(services) ? services : [],
      openingHours: hours && !hours.__invalid ? hours : {},
      greeting: f['Greeting'] || '',
      tone: f['Tone / brand voice'] || 'Warm, professional and concise.',
      urgentKeywords: splitList(f['Urgent keywords']),
      escalationSms: normalizePhone(f['Escalation SMS number'] || f['Reception forwarding number']),
    },
    quotes: {
      pricingRules: pricing,
      pricesIncludeVat: !!f['Prices include VAT'],
      validDays: Number(f['Quote valid days']) || 30,
      minMarginPct: f['Minimum margin %'] === undefined || f['Minimum margin %'] === null ? 30 : Number(f['Minimum margin %']),
      approverEmail: f['Quote approver email'] || f['Business email'] || f['Contact email'] || '',
    },
    reporting: { recipients: splitList(f['Report recipients']) },
    dashboardToken: f['Dashboard token'] || '',
    monthlyFee: f['Monthly fee'] || 0,
    prospectIds: f['Prospect'] || [],
    _invalidJson: [
      services && services.__invalid ? 'Services' : null,
      hours && hours.__invalid ? 'Opening hours' : null,
      pricing && pricing.__invalid ? 'Pricing rules' : null,
    ].filter(Boolean),
  };
}

function normalizePhone(p) {
  if (!p) return '';
  let s = String(p).replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('0')) s = '+44' + s.slice(1);
  if (!s.startsWith('+') && s.length >= 10) s = '+' + s;
  return s;
}

// The gate. Returns {ok:true} or {ok:false, reason}. Never throws.
function gate(client, service) {
  if (!client || !client.clientId) return { ok: false, reason: 'client_not_found' };
  if (client.status !== 'Active') return { ok: false, reason: `status_${String(client.status).toLowerCase()}` };
  if (!client.halalPassed) return { ok: false, reason: 'halal_screen_not_passed' };
  if (service && SERVICE_TOGGLES[service] && !client.toggles[service]) return { ok: false, reason: `${service}_toggle_off` };
  if (service === 'phone') {
    if (!client.aiDisclosurePassed) return { ok: false, reason: 'ai_disclosure_check_not_passed' };
    if (BLOCKED_PHONE_JURISDICTIONS.includes(client.jurisdiction)) return { ok: false, reason: 'jurisdiction_requires_ai_disclosure' };
  }
  if (client._invalidJson && client._invalidJson.length) {
    const relevant = { phone: ['Services', 'Opening hours'], quotes: ['Pricing rules'] }[service] || [];
    const bad = client._invalidJson.filter((x) => relevant.includes(x));
    if (bad.length) return { ok: false, reason: `invalid_json_${bad.join('_').replace(/\s/g, '').toLowerCase()}` };
  }
  return { ok: true };
}

// Pick the one client row for a lookup; refuses ambiguous matches (isolation).
function resolveClient(records, { clientId, phoneNumber } = {}) {
  const clients = (records || []).map(normalizeClient);
  let matches = [];
  if (clientId) matches = clients.filter((c) => c.clientId === String(clientId).trim());
  else if (phoneNumber) {
    const p = normalizePhone(phoneNumber);
    matches = clients.filter((c) => c.phone.businessNumber && c.phone.businessNumber === p);
  }
  if (matches.length === 0) return { client: null, error: 'client_not_found' };
  if (matches.length > 1) return { client: null, error: 'ambiguous_client_match' };
  return { client: matches[0], error: null };
}

// Demo/test safety: outbound email to anyone other than Keystone goes to the test inbox.
function safeRecipients(client, emails) {
  const list = (Array.isArray(emails) ? emails : [emails]).filter(Boolean);
  if (!client || client.isDemo) return list.length ? [TEST_INBOX] : [];
  return list;
}

function safeSmsNumber(client, number, testNumber) {
  if (!client || client.isDemo) return testNumber || null;
  return number;
}

// Registry-wide integrity checks: duplicate keys would break isolation.
function validateRegistry(records) {
  const clients = (records || []).map(normalizeClient);
  const problems = [];
  const dup = (key, label) => {
    const seen = {};
    for (const c of clients) {
      const v = key(c);
      if (!v) continue;
      if (seen[v]) problems.push(`Duplicate ${label} "${v}" on ${seen[v]} and ${c.clientName}`);
      else seen[v] = c.clientName;
    }
  };
  dup((c) => c.clientId, 'Client ID');
  dup((c) => c.phone.businessNumber, 'Business phone number');
  dup((c) => c.invoice.xeroTenantId, 'Xero organisation ID');
  dup((c) => c.dashboardToken, 'Dashboard token');
  for (const c of clients) if (!c.clientId) problems.push(`Client "${c.clientName || '(unnamed)'}" has no Client ID`);
  return problems;
}

module.exports = { TEST_INBOX, SERVICE_TOGGLES, BLOCKED_PHONE_JURISDICTIONS, parseJson, splitList, normalizeClient, normalizePhone, gate, resolveClient, safeRecipients, safeSmsNumber, validateRegistry };
