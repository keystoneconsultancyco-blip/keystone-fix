'use strict';
// Finance Ops Audit questionnaire page (Keystone branded). Posts JSON to the audit intake webhook.
const { QUESTIONS, PILLARS } = require('./audit');
const { escapeHtml: e } = require('./log');

function field(q) {
  const id = 'q_' + q.id;
  if (q.type === 'choice') return `<label for="${id}">${e(q.q)}</label><select id="${id}" name="${e(q.id)}"><option value=""></option>${q.options.map((o) => `<option>${e(o)}</option>`).join('')}</select>`;
  if (q.type === 'bool') return `<label for="${id}">${e(q.q)}</label><select id="${id}" name="${e(q.id)}"><option value=""></option><option value="yes">Yes</option><option value="no">No</option></select>`;
  return `<label for="${id}">${e(q.q)}</label><input id="${id}" name="${e(q.id)}" ${q.type === 'number' ? 'type="number" step="any" min="0" inputmode="decimal"' : 'type="text"'}>`;
}

function auditFormPage(postUrl, xeroTenantId) {
  const groups = Object.entries(PILLARS).map(([k, name]) => `<fieldset><legend>${e(name)}</legend>${QUESTIONS.filter((q) => q.pillar === k).map(field).join('')}</fieldset>`).join('')
    + `<fieldset><legend>Your systems</legend>${QUESTIONS.filter((q) => q.pillar === 'all').map(field).join('')}</fieldset>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finance Ops Audit | Keystone</title>
<style>body{margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2433}.wrap{max-width:660px;margin:0 auto;padding:16px}
.head{background:#1F3A5F;color:#fff;padding:18px 20px;border-radius:10px 10px 0 0;font-size:20px;font-weight:600}.card{background:#fff;padding:20px;border-radius:0 0 10px 10px}
fieldset{border:1px solid #e5e7eb;border-radius:8px;margin:16px 0;padding:12px 14px}legend{font-weight:700;padding:0 6px}label{display:block;font-size:14px;font-weight:600;margin:12px 0 6px}
input,select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d0d5dd;border-radius:6px;font-size:15px;font-family:inherit}button{margin-top:18px;background:#1F3A5F;color:#fff;border:0;padding:12px 18px;border-radius:6px;font-size:16px;width:100%;cursor:pointer}
.res{margin-top:16px;padding:14px;border-radius:8px;display:none}.ok{background:#f0fdf4}.bad{background:#fef2f2}.muted{color:#6b7280;font-size:13px}</style></head>
<body><div class="wrap"><div class="head">Keystone</div><div class="card"><h2 style="margin-top:0">Finance Ops Audit questionnaire</h2>
<p class="muted">About 10 minutes. Rough numbers are fine. We use them to estimate where time and money are leaking, and we'll go through them with you.</p>
<form id="af"><input type="hidden" name="xeroTenantId" value="${e(xeroTenantId || '')}"><fieldset><legend>About the business</legend>
<label for="bn">Business name</label><input id="bn" name="businessName" required><label for="cn">Your name</label><input id="cn" name="contactName" required>
<label for="ce">Email</label><input id="ce" name="contactEmail" type="email" required><label for="in">Industry</label><input id="in" name="industry" required placeholder="e.g. plumbing and heating">
<label for="se">What do you sell?</label><input id="se" name="sells" required placeholder="e.g. boiler installs and servicing">
<label for="rb">Annual revenue</label><select id="rb" name="revenueBand" required><option value=""></option><option value="under500k">Under £500K</option><option value="500k-2m">£500K-£2M</option><option value="2m-5m">£2M-£5M</option><option value="5m-10m">£5M-£10M</option><option value="10mplus">£10M+</option></select>
<label for="sb">Staff</label><select id="sb" name="staffBand" required><option value=""></option><option value="justme">Just me</option><option value="2-10">2-10</option><option value="11-50">11-50</option><option value="50plus">50+</option></select></fieldset>
${groups}<button id="btn" type="submit">Send my answers</button></form><div class="res" id="res"></div></div></div>
<script>(function(){var f=document.getElementById('af'),b=document.getElementById('btn'),r=document.getElementById('res');
f.addEventListener('submit',function(ev){ev.preventDefault();b.disabled=true;b.textContent='Analysing... (up to a minute)';var d=new FormData(f),a={},top={};
['businessName','contactName','contactEmail','industry','sells','revenueBand','staffBand','xeroTenantId'].forEach(function(k){top[k]=d.get(k);});
d.forEach(function(v,k){if(!(k in top)&&v!=='')a[k]=(v==='yes')?true:(v==='no')?false:(isNaN(Number(v))?v:Number(v));});top.answers=a;
fetch(${JSON.stringify(postUrl)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(top)}).then(function(x){return x.json();}).then(function(j){r.style.display='block';r.className='res '+(j.ok?'ok':'bad');r.textContent=j.message;}).catch(function(){r.style.display='block';r.className='res bad';r.textContent='Sorry, something went wrong. Please email us instead.';}).finally(function(){b.disabled=false;b.textContent='Send my answers';});});})();</script></body></html>`;
}

module.exports = { auditFormPage };
