'use strict';
// Fix: n8n Code nodes cannot call helpers.httpRequestWithAuthentication, so the sheet-based stats step
// broke for every real client. Stats now come from the Agent Log (already fetched in "Value stats").
const { H } = require('../scripts/stock');
module.exports = async function modify(w) {
  const cs = H.node(w, 'Compile Phone/Invoice Sheet Stats');
  delete cs.onError;
  cs.parameters.jsCode = `const client = $input.item.json;
const v = client.valueStats || {};
return { json: { ...client, callsAnswered: v.aiCallsHandled || 0, bookingsMade: v.aiBookings || 0, quotesGiven: v.quotesDrafted || 0, invoicesSent: v.aiInvoicesDrafted || 0, cashJobs: 0, invoiceReferencesToCheck: [] } };`;
  const fr = H.node(w, 'Format Client Report');
  fr.parameters.jsCode = fr.parameters.jsCode
    .replace("parts.push(`We sent ${c.invoicesSent} ${plural(c.invoicesSent, 'invoice')} this month.`);", "parts.push(`We prepared ${c.invoicesSent} ${plural(c.invoicesSent, 'invoice')} in Xero for you this month.`);")
    .replace("parts.push(`We didn't send any invoices this month.`);", "parts.push(`We didn't have any invoices to prepare this month.`);");
  if (!fr.parameters.jsCode.includes('We prepared')) throw new Error('format not rewritten');
};
