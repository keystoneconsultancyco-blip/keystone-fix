'use strict';
// Branded quote email (print-friendly, so it can be saved as PDF from any email app)
// and the customer-facing quote form page.

const { escapeHtml: e } = require('./log');
const { shell, table, gbp } = require('./render');

function linesTable(q) {
  const rows = q.lines.map((l) => [e(l.description), gbp(l.amount)]);
  if (q.pricesIncludeVat) rows.push(['<strong>Total (inc VAT)</strong>', `<strong>${gbp(q.total)}</strong>`], [`<span style="color:#6b7280">Includes VAT at ${q.vatRate}%</span>`, `<span style="color:#6b7280">${gbp(q.vat)}</span>`]);
  else rows.push(['Subtotal', gbp(q.subtotal)], [`VAT (${q.vatRate}%)`, gbp(q.vat)], ['<strong>Total</strong>', `<strong>${gbp(q.total)}</strong>`]);
  return table(rows, ['Item', 'Price']);
}

// To the CUSTOMER (after approval, or directly for manual quotes).
function customerQuoteEmail(client, q) {
  const body = `<h2 style="margin-top:0">Your quote ${e(q.ref)}</h2>
<p>Hi ${e(q.customerName || 'there')},</p>
<p>Thanks for getting in touch with ${e(client.clientName)}. Here is your quote for <strong>${e(q.service || q.description)}</strong>.</p>
${q.serviceDescription ? `<p style="color:#4b5563">${e(q.serviceDescription)}</p>` : ''}
${linesTable(q)}
${(q.notes || []).length ? `<p>${q.notes.map(e).join('<br>')}</p>` : ''}
<p style="font-size:13px;color:#4b5563">Valid until ${e(q.validUntil)}. ${q.pricedBy === 'agent' ? 'This is an estimate based on the details provided; we will confirm on site. ' : ''}Reply to this email to book or ask a question.</p>`;
  return shell(client, `Quote ${q.ref} from ${client.clientName}`, body);
}

// To the BUSINESS for approval (form and phone quotes).
function approvalEmail(client, q, approveUrl) {
  const flag = q.belowMarginFloor
    ? `<p style="background:#fee2e2;border-left:4px solid #dc2626;padding:10px"><strong>Below your minimum margin:</strong> ${q.marginPct}% vs ${q.minMarginPct}%. Check the price before approving.</p>`
    : `<p style="color:#059669;font-size:13px">Estimated margin ${q.marginPct}% (your minimum ${q.minMarginPct}%).</p>`;
  const body = `<h2 style="margin-top:0">${q.total > 0 ? 'New quote to approve' : 'Quote request needs details'}: ${e(q.ref)}</h2>
<p><strong>${e(q.customerName || 'Customer')}</strong> ${q.customerEmail ? '(' + e(q.customerEmail) + ')' : ''} ${q.customerPhone ? e(q.customerPhone) : ''} asked for: ${e(q.description || q.service)}</p>
<p>Source: ${e(q.source)} · Priced by: ${q.pricedBy === 'agent' ? 'AI estimate (not in your price list)' : 'your price list'}</p>
${linesTable(q)}
${flag}
${q.agentNotes ? `<p style="font-size:13px"><strong>How the AI priced it:</strong> ${e(q.agentNotes)}</p>` : ''}
${(q.questions || []).length ? `<p><strong>Still need from the customer:</strong></p><ul>${q.questions.map((x) => `<li>${e(x)}</li>`).join('')}</ul>` : ''}
${approveUrl && q.customerEmail && !(q.questions || []).length ? `<p><a href="${e(approveUrl)}" style="background:#059669;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;display:inline-block">Approve and send to customer</a></p><p style="font-size:12px;color:#6b7280">Want to change it? Edit the quote in Airtable (Quotes table) and create a manual quote instead.</p>` : '<p>No email address or details still needed, so call the customer to finish this one.</p>'}
<p style="font-size:12px;color:#6b7280">Nothing has been sent to the customer yet.</p>`;
  return shell(client, `Approve quote ${q.ref}`, body);
}

function page(client, title, inner) {
  const colour = /^#[0-9a-f]{3,8}$/i.test(client.invoice.brandColour) ? client.invoice.brandColour : '#1F3A5F';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title>
<style>body{margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2433}
.wrap{max-width:620px;margin:0 auto;padding:16px}.head{background:${colour};color:#fff;padding:18px 20px;border-radius:10px 10px 0 0;font-size:20px;font-weight:600}
.card{background:#fff;padding:20px;border-radius:0 0 10px 10px}label{display:block;font-weight:600;margin:14px 0 6px;font-size:14px}
input,select,textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d0d5dd;border-radius:6px;font-size:15px;font-family:inherit}
.check{display:flex;gap:8px;align-items:center;font-weight:400}.check input{width:auto}
button{margin-top:18px;background:${colour};color:#fff;border:0;padding:12px 18px;border-radius:6px;font-size:16px;cursor:pointer;width:100%}
.result{margin-top:18px;padding:14px;border-radius:8px;background:#f0fdf4;display:none}.err{background:#fef2f2}
.muted{color:#6b7280;font-size:13px}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #eee}td:last-child{text-align:right}</style></head>
<body><div class="wrap"><div class="head">${client.invoice.brandLogoUrl ? `<img src="${e(client.invoice.brandLogoUrl)}" alt="" style="max-height:40px">` : e(client.clientName)}</div><div class="card">${inner}</div>
<p class="muted" style="text-align:center">Quotes powered by Keystone</p></div></body></html>`;
}

// Customer quote form. manual=true shows the internal fields (materials, discounts, send directly).
function quoteFormPage(client, services, factors, { postUrl, manual = false, token = '' }) {
  const fs = factors.filter((f) => f.applies !== 'Always' && (manual || f.applies !== 'Manual quotes only'));
  const factorInputs = fs.map((f) => {
    const numeric = f.type === 'Per unit' || f.type === 'Materials markup %' || f.applies === 'When a number is given';
    const label = e(f.question || f.name);
    return numeric
      ? `<label>${label}</label><input type="number" step="any" min="0" name="a_${e(f.key)}" inputmode="decimal">`
      : `<label class="check"><input type="checkbox" name="a_${e(f.key)}" value="yes"> ${label}</label>`;
  }).join('');
  const opts = services.map((s) => `<option value="${e(s.name)}" data-unit="${e(s.unitName)}">${e(s.name)}${s.basePrice ? ' (from ' + gbp(s.basePrice) + ')' : ''}</option>`).join('');
  const inner = `<h2 style="margin-top:0">${manual ? 'Create a quote' : 'Get a quote'}</h2>
<p class="muted">${manual ? 'Manual quote: sent straight to the customer.' : 'Tell us what you need and we\'ll show you an estimate straight away. We\'ll then confirm your quote by email.'}</p>
<form id="qf">
<label>What do you need?</label><select name="service" id="svc">${opts}<option value="">Something else (describe below)</option></select>
<div id="qtyWrap"><label id="qtyLabel">How many?</label><input type="number" step="any" min="0" name="quantity" inputmode="decimal"></div>
<label>Describe the job</label><textarea name="description" rows="3" placeholder="e.g. boiler not firing up, 3-bed semi"></textarea>
${factorInputs}
${manual ? '<label>Extra discount % (optional)</label><input type="number" step="any" min="0" max="100" name="discountPct">' : ''}
<label>Your name</label><input name="name" required autocomplete="name">
<label>Email</label><input name="email" type="email" ${manual ? 'required' : 'required'} autocomplete="email">
<label>Phone</label><input name="phone" type="tel" autocomplete="tel">
<button type="submit" id="btn">${manual ? 'Calculate and send quote' : 'Get my estimate'}</button>
</form><div class="result" id="res"></div>
<script>
(function(){var f=document.getElementById('qf'),svc=document.getElementById('svc'),qw=document.getElementById('qtyWrap'),ql=document.getElementById('qtyLabel'),res=document.getElementById('res'),btn=document.getElementById('btn');
function upd(){var o=svc.options[svc.selectedIndex],u=o&&o.getAttribute('data-unit');qw.style.display=u?'block':'none';ql.textContent=u?('How many '+u+'s?'):'';}
svc.addEventListener('change',upd);upd();
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
f.addEventListener('submit',function(ev){ev.preventDefault();btn.disabled=true;btn.textContent='Working...';var d=new FormData(f),answers={};
d.forEach(function(v,k){if(k.indexOf('a_')===0&&v!=='')answers[k.slice(2)]=v;});
var body={clientId:${JSON.stringify(client.clientId)},source:${JSON.stringify(manual ? 'manual' : 'web')},token:${JSON.stringify(token)},service:d.get('service'),description:d.get('description'),quantity:d.get('quantity'),discountPct:Number(d.get('discountPct')||0),answers:answers,customer:{name:d.get('name'),email:d.get('email'),phone:d.get('phone')}};
fetch(${JSON.stringify(postUrl)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json();}).then(function(j){
res.style.display='block';res.className='result'+(j.ok?'':' err');
if(!j.ok){res.innerHTML='<strong>Sorry</strong>, '+esc(j.message||'something went wrong. Please call us.');return;}
var h='<strong>'+esc(j.message)+'</strong>';if(j.lines&&j.lines.length){h+='<table>';j.lines.forEach(function(l){h+='<tr><td>'+esc(l.description)+'</td><td>&pound;'+l.amount.toFixed(2)+'</td></tr>';});h+='<tr><td><strong>Total</strong></td><td><strong>&pound;'+j.total.toFixed(2)+'</strong></td></tr></table>';}
if(j.questions&&j.questions.length){h+='<p>We just need to check: '+j.questions.map(esc).join(' ')+'</p>';}
h+='<p class="muted">Reference '+esc(j.ref)+'</p>';res.innerHTML=h;}).catch(function(){res.style.display='block';res.className='result err';res.textContent='Sorry, we could not get a quote right now. Please call us.';}).finally(function(){btn.disabled=false;btn.textContent=${JSON.stringify(manual ? 'Calculate and send quote' : 'Get my estimate')};});});})();
</script>`;
  return page(client, `${manual ? 'Create a quote' : 'Get a quote'} | ${client.clientName}`, inner);
}

function messagePage(client, title, text) {
  return page(client || { clientName: 'Keystone', invoice: { brandColour: '#1F3A5F', brandLogoUrl: '' } }, title, `<h2 style="margin-top:0">${e(title)}</h2><p>${e(text)}</p>`);
}

module.exports = { customerQuoteEmail, approvalEmail, quoteFormPage, messagePage, linesTable };
