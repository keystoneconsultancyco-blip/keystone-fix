'use strict';
// Bridges the Airtable registry to the field names your existing [Stock] workflows already use,
// so the "Client Config" sub-workflows can read My Clients without changing any caller.

const Rg = require('./registry');

const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

function field(record, name) { const f = record && record.fields ? record.fields : record || {}; return f[name]; }

// Works out which client a call into the sub-workflow is for.
// hint: { clientId, calledNumber, service }. Falls back to the only Active client with that service on.
function chooseClient(records, hint) {
  const all = (records || []).map((r) => ({ r, c: Rg.normalizeClient(r) }));
  const h = hint || {};
  let pick = [];
  let how = '';
  if (h.clientId) { pick = all.filter((x) => x.c.clientId === String(h.clientId).trim()); how = 'clientId'; }
  if (!pick.length && h.calledNumber) { const p = Rg.normalizePhone(h.calledNumber); pick = all.filter((x) => x.c.phone.businessNumber === p); how = 'calledNumber'; }
  if (!pick.length && !h.clientId) {
    pick = all.filter((x) => x.c.status === 'Active' && (!h.service || x.c.toggles[h.service]));
    how = 'onlyActive';
    if (pick.length > 1) return { error: `ambiguous: ${pick.length} active clients have ${h.service || 'services'} on, and the call did not say which one` };
  }
  if (!pick.length) return { error: `no client found (${JSON.stringify(h)})` };
  if (pick.length > 1) return { error: `ambiguous match on ${how}` };
  const { c, r } = pick[0];
  const g = Rg.gate(c, h.service);
  if (!g.ok) return { error: `client ${c.clientId} blocked: ${g.reason}`, client: c };
  return { client: c, record: r, how };
}

function toInvoiceConfig(client, record) {
  return {
    clientId: client.clientId,
    clientName: client.clientName,
    brandLogoUrl: client.invoice.brandLogoUrl,
    brandColour: client.invoice.brandColour,
    paymentOptions: client.invoice.paymentOptions,
    sendWindowStart: client.invoice.sendWindowStart || '00:00',
    sendWindowEnd: client.invoice.sendWindowEnd || '23:59',
    sendWindowTimezone: client.timezone,
    milestoneInvoicingEnabled: client.invoice.milestoneInvoicingEnabled,
    discountPercent: 0,
    xeroSalesAccountCode: client.invoice.accountCode,
    invoiceStatus: 'DRAFT', // fixed: Keystone never authorises invoices automatically
    invoiceDueDays: client.invoice.paymentTermsDays,
    invoiceLineAmountType: client.invoice.invoiceLineAmountType,
    confirmationFromEmail: field(record, 'From email') || 'onboarding@resend.dev',
    jobsSheetId: field(record, 'Jobs sheet ID') || '',
    jobsSheetTabName: field(record, 'Jobs sheet tab') || 'Jobs',
    discountsSheetTabName: 'Discounts',
    collectionsReminder1Days: 7,
    collectionsReminder2Days: 14,
    collectionsReminder3Days: 21,
    collectionsNotificationEmail: client.businessEmail,
    xeroCashAccountCode: field(record, 'Xero cash account code') || '',
    // new (used by the Keystone upgrades)
    xeroTenantIdFromRegistry: client.invoice.xeroTenantId || '',
    businessEmail: client.businessEmail,
    isDemo: client.isDemo,
    vatRatePct: client.invoice.vatRatePct,
    registrySource: 'airtable',
  };
}

function toPhoneConfig(client, record) {
  const hours = client.phone.openingHours || {};
  const openDays = Object.keys(DAY_NAMES).filter((d) => Array.isArray(hours[d]) && hours[d].length === 2);
  const starts = openDays.map((d) => hours[d][0]).sort();
  const ends = openDays.map((d) => hours[d][1]).sort();
  const services = client.phone.services || [];
  return {
    clientId: client.clientId,
    businessName: client.clientName,
    timezone: client.timezone,
    receptionForwardNumber: client.phone.receptionNumber,
    managerPhoneNumber: Rg.normalizePhone(field(record, 'Manager phone')) || client.phone.receptionNumber,
    vapiSipCredentialId: field(record, 'Vapi SIP credential ID') || '',
    vapiSipRegionHost: 'sip.vapi.ai',
    vapiSipUri: field(record, 'Vapi SIP URI') || '',
    vapiAssistantId: field(record, 'Vapi assistant ID') || '',
    googleCalendarId: client.phone.calendarId || 'primary',
    bookingSlotDurationMinutes: 30,
    businessHoursStart: starts[0] || '09:00',
    businessHoursEnd: ends[ends.length - 1] || '17:00',
    businessDays: openDays.map((d) => DAY_NAMES[d]),
    serviceMenu: services.map((s) => ({ name: s.name, durationMinutes: Number(s.durationMins) || 60 })),
    confirmationFromEmail: field(record, 'From email') || 'onboarding@resend.dev',
    businessNotificationEmail: client.businessEmail,
    reportingSheetId: field(record, 'Call log sheet ID') || '',
    callLogTabName: 'CallLog',
    quoteLogTabName: 'QuoteLog',
    quoteConfig: { jobTypes: [] },
    // new (used by the Keystone upgrades)
    openingHours: hours,
    greeting: client.phone.greeting || `Thanks for calling ${client.clientName}.`,
    tone: client.phone.tone,
    urgentKeywords: client.phone.urgentKeywords,
    escalationSmsNumber: client.phone.escalationSms,
    isDemo: client.isDemo,
    registrySource: 'airtable',
  };
}

// Pulls a client hint out of whatever the caller passed into the sub-workflow.
function hintFrom(json, service) {
  const j = json || {};
  const b = j.body || {};
  const msg = b.message || {};
  const call = msg.call || {};
  const md = (call.assistant && call.assistant.metadata) || (msg.assistant && msg.assistant.metadata) || call.metadata || {};
  const sip = (call.phoneCallProviderDetails && call.phoneCallProviderDetails.sipHeaders) || {};
  return {
    clientId: j.clientId || b.clientId || md.clientId || sip['X-Keystone-Client'] || sip['x-clientId'] || null,
    calledNumber: j.calledNumber || b.To || b.Called || (call.phoneNumber && call.phoneNumber.number) || null,
    service,
  };
}

module.exports = { chooseClient, toInvoiceConfig, toPhoneConfig, hintFrom, DAY_NAMES };
