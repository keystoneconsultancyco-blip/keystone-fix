'use strict';
// Onboarding checklist: decides whether a registry row is safe to set Active,
// and which services can be switched on.

const { BLOCKED_PHONE_JURISDICTIONS } = require('./registry');
const { halalScreen } = require('./audit');

function item(id, label, done, detail) { return { id, label, done: !!done, detail: detail || '' }; }

function checklist(client) {
  const c = client;
  const screen = halalScreen(c.industry, c.clientName);
  const items = [
    item('client_id', 'Client ID set', !!c.clientId),
    item('contact', 'Contact name and email', c.contactName && c.contactEmail),
    item('halal', 'Halal screen passed', c.halalPassed && screen.pass, screen.pass ? (screen.needsManualCheck ? `Manual check advised: ${screen.checks.join(', ')}` : '') : `Industry text hits: ${screen.hits.join(', ')}`),
    item('jurisdiction', 'Jurisdiction recorded', !!c.jurisdiction),
    item('business_email', 'Business notification email', !!c.businessEmail),
  ];
  const svc = {};
  if (c.toggles.invoicing) {
    svc.invoicing = [
      item('xero_tenant', 'Xero organisation ID', !!c.invoice.xeroTenantId),
      item('send_window', 'Send window set (HH:MM)', /^\d{1,2}:\d{2}$/.test(c.invoice.sendWindowStart) && /^\d{1,2}:\d{2}$/.test(c.invoice.sendWindowEnd)),
      item('vat', 'Invoice line amount type', ['Inclusive', 'Exclusive', 'NoTax'].includes(c.invoice.invoiceLineAmountType)),
      item('job_source', 'Job source chosen', !!c.invoice.jobSource),
    ];
  }
  if (c.toggles.phone) {
    svc.phone = [
      item('ai_disclosure', 'AI-disclosure jurisdiction check passed', c.aiDisclosurePassed && !BLOCKED_PHONE_JURISDICTIONS.includes(c.jurisdiction), BLOCKED_PHONE_JURISDICTIONS.includes(c.jurisdiction) ? 'Jurisdiction requires proactive AI disclosure: phone agent may not be deployed' : ''),
      item('twilio_number', 'Business (Twilio) phone number', !!c.phone.businessNumber),
      item('reception', 'Reception forwarding number (fail-safe)', !!c.phone.receptionNumber),
      item('calendar', 'Calendar ID', !!c.phone.calendarId),
      item('services', 'Services with durations', c.phone.services.length > 0 && c.phone.services.every((s) => s.name && s.durationMins)),
      item('hours', 'Opening hours', Object.keys(c.phone.openingHours || {}).length > 0),
      item('escalation', 'Escalation SMS number', !!c.phone.escalationSms),
    ];
  }
  if (c.toggles.quotes) {
    svc.quotes = [
      item('rules', 'Pricing rules JSON', c.quotes.pricingRules && Array.isArray(c.quotes.pricingRules.services) && c.quotes.pricingRules.services.length > 0),
      item('margin', 'Minimum margin %', c.quotes.minMarginPct > 0),
      item('approver', 'Quote approver email', !!c.quotes.approverEmail),
    ];
  }
  if (c.toggles.reporting) {
    svc.reporting = [
      item('recipients', 'Report recipients', c.reporting.recipients.length > 0),
      item('dashboard_token', 'Dashboard token (24+ chars)', (c.dashboardToken || '').length >= 24),
    ];
  }
  if ((c._invalidJson || []).length) items.push(item('json', 'All JSON fields valid', false, `Invalid: ${c._invalidJson.join(', ')}`));
  const allServiceItems = Object.values(svc).flat();
  const ready = items.every((i) => i.done) && allServiceItems.every((i) => i.done);
  return { ready, core: items, services: svc, missing: [...items, ...allServiceItems].filter((i) => !i.done) };
}

function randomToken(len = 32) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  let bytes = null;
  try { bytes = require('crypto').randomBytes(len); } catch (e) { bytes = null; }
  for (let i = 0; i < len; i++) out += chars[(bytes ? bytes[i] : Math.floor(Math.random() * 256)) % chars.length];
  return out;
}

module.exports = { checklist, randomToken };
