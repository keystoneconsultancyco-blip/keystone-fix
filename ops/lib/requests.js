'use strict';
// Request builders for the HTTP Request nodes. Each returns {url, method, body, tenantId?}
// and goes on an item as $json.req. Credentials come from n8n, never from here.

const { formulaString } = require('./log');

const AIRTABLE_API = 'https://api.airtable.com/v0';
// Change once a domain is verified in Resend (BLOCKERS.md). resend.dev only delivers to the Resend account owner.
const EMAIL_FROM = 'Keystone <onboarding@resend.dev>';

function airtableList(baseId, tableId, { formula, fields, maxRecords = 100, sort } = {}) {
  const q = new URLSearchParams();
  if (formula) q.set('filterByFormula', formula);
  if (maxRecords) q.set('maxRecords', String(maxRecords));
  (fields || []).forEach((f) => q.append('fields[]', f));
  (sort || []).forEach((s, i) => { q.set(`sort[${i}][field]`, s.field); q.set(`sort[${i}][direction]`, s.direction || 'asc'); });
  return { method: 'GET', url: `${AIRTABLE_API}/${baseId}/${tableId}?${q.toString()}` };
}

function airtableCreate(baseId, tableId, fieldsList) {
  return { method: 'POST', url: `${AIRTABLE_API}/${baseId}/${tableId}`, body: { records: fieldsList.slice(0, 10).map((f) => ({ fields: clean(f) })), typecast: true } };
}

function airtableUpdate(baseId, tableId, updates) {
  return { method: 'PATCH', url: `${AIRTABLE_API}/${baseId}/${tableId}`, body: { records: updates.slice(0, 10).map((u) => ({ id: u.id, fields: clean(u.fields) })), typecast: true } };
}

function clean(f) {
  const o = {};
  for (const [k, v] of Object.entries(f || {})) if (v !== undefined && v !== null && !(typeof v === 'number' && !isFinite(v))) o[k] = v;
  return o;
}

function byClientFormula(clientId, extra) {
  const base = `{Client ID} = ${formulaString(clientId)}`;
  return extra ? `AND(${base}, ${extra})` : base;
}

function email({ to, subject, html, text, replyTo }) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  return { method: 'POST', url: 'https://api.resend.com/emails', body: { from: EMAIL_FROM, to: list, subject: String(subject).slice(0, 200), html, text, ...(replyTo ? { reply_to: replyTo } : {}) } };
}

function xero(client, method, pathAndQuery, body) {
  return { method, url: `https://api.xero.com/api.xro/2.0/${pathAndQuery}`, body, tenantId: client.invoice.xeroTenantId };
}

// Real Xero calls only for live clients with a real tenant ID. Demo rows use the simulated path.
function useRealXero(client) {
  return !!client.invoice.xeroTenantId && !/^DEMO-/.test(client.invoice.xeroTenantId);
}

function gcal(calendarId, method, path, body) {
  return { method, url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/${path}`, body };
}

// Writes fan out to one shared tail (Airtable write / email / SMS) in every workflow.
const write = {
  airtable: (req) => ({ kind: 'airtable', req }),
  email: (req) => ({ kind: 'email', req }),
  sms: (from, to, message) => ({ kind: 'sms', sms: { from, to, message: String(message).slice(0, 600) } }),
};

function ok(res) { return res && res.statusCode >= 200 && res.statusCode < 300; }

module.exports = { write, AIRTABLE_API, EMAIL_FROM, airtableList, airtableCreate, airtableUpdate, byClientFormula, email, xero, useRealXero, gcal, ok, clean };
