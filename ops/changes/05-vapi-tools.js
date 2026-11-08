'use strict';
// Change 6 (CHANGE_LIST #6): [Stock] Phone Booking - 2. Vapi Tools
//  - UK-time slots (was server time), no past slots, closed days, real service durations, re-check before booking
//  - get_quote asks KS Quote Calculator (always "an estimate")
//  - new tools: flag_urgent, log_complaint, take_message, reschedule_booking
const n = require('../scripts/n8n');
const { H } = require('../scripts/stock');
const L = ['time', 'registry', 'requests', 'log'];
const QUOTE_URL = 'https://keystoneconsultancy.app.n8n.cloud/webhook/ks-quote';

function rule(name) {
  return { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: '={{ $json.toolName }}', rightValue: name, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, renameOutput: true, outputKey: name };
}

module.exports = async function modify(w) {
  H.node(w, 'Extract Tool Call').parameters.jsCode = `const body = $json.body || {};
const msg = body.message || {};
const tc = (msg.toolCallList && msg.toolCallList[0]) || (msg.toolCalls && msg.toolCalls[0]) || {};
const fn = tc.function || {};
let args = tc.arguments !== undefined ? tc.arguments : fn.arguments;
if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
return [{ json: { toolCallId: tc.id, toolName: tc.name || fn.name, toolArgs: args || {}, body } }];`;

  // ---- routing: 4 new tools; unknown-tool fallback moves to the last output ----
  const sw = H.node(w, 'Route On Tool Name');
  const unknownTargets = H.targets(w, 'Route On Tool Name', 3);
  const NEW = ['flag_urgent', 'log_complaint', 'take_message', 'reschedule_booking'];
  sw.parameters.rules.values = sw.parameters.rules.values.filter((v) => !NEW.includes(v.outputKey)).concat(NEW.map(rule));

  // ---- availability in UK time ----
  H.node(w, 'Compute Available Slots').parameters.jsCode = KS_BUNDLE(['time']) + `
const T = KS.time;
const config = $('Merge Context').item.json;
const args = config.toolArgs || {};
const tz = config.timezone || 'Europe/London';
const date = String(args.date || '').slice(0, 10);
const events = $input.all().map((i) => i.json).filter((e) => e && (e.start || e.end));
const menu = config.serviceMenu || [];
const svc = menu.find((s) => (s.name || '').toLowerCase() === String(args.service || '').toLowerCase());
const dur = (svc && svc.durationMinutes) || config.bookingSlotDurationMinutes || 30;
const step = config.bookingSlotDurationMinutes || 30;
const dayKey = /^\\d{4}-\\d{2}-\\d{2}$/.test(date) ? T.weekdayOf(date) : null;
let hours = null;
if (config.openingHours && Object.keys(config.openingHours).length) hours = dayKey ? config.openingHours[dayKey] : null;
else if (dayKey) { const full = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }[dayKey]; if ((config.businessDays || []).includes(full)) hours = [config.businessHoursStart || '09:00', config.businessHoursEnd || '17:00']; }
const busy = events.map((e) => {
  if (e.start && e.start.date && !e.start.dateTime) return { s: T.zonedToUtc(e.start.date, '00:00', tz), e: T.zonedToUtc(e.end && e.end.date ? e.end.date : T.addDaysStr(e.start.date, 1), '00:00', tz) };
  const s = new Date(e.start && e.start.dateTime ? e.start.dateTime : e.start);
  let en = new Date(e.end && e.end.dateTime ? e.end.dateTime : e.end);
  if (!(en > s)) en = new Date(s.getTime() + dur * 60000);
  return { s, e: en };
});
const slots = [];
const earliest = new Date(Date.now() + 60 * 60000);
if (Array.isArray(hours) && hours.length === 2) {
  const open = T.toMinutes(hours[0]), close = T.toMinutes(hours[1]);
  for (let m = open; m + dur <= close; m += step) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    const st = T.zonedToUtc(date, hh, tz); const en = new Date(st.getTime() + dur * 60000);
    if (st < earliest) continue;
    if (!busy.some((b) => st < b.e && en > b.s)) slots.push(hh);
  }
}
const preferredTime = args.preferredTime || args.time || null;
return [{ json: { date, preferredTime, preferredAvailable: preferredTime ? slots.includes(preferredTime) : false, alternativeSlots: slots.filter((s) => s !== preferredTime).slice(0, 5), allAvailableSlots: slots, closedDay: !Array.isArray(hours), durationMinutes: dur } }];`;
  const av = H.node(w, 'Build Availability Result Text');
  av.parameters.assignments.assignments[0].value = "={{ !$json.date || $json.date.length !== 10 ? 'Which day would you like? Please give me the date.' : $json.closedDay ? ('Sorry, we are closed on ' + $json.date + '. Please choose another day.') : !$json.allAvailableSlots.length ? ('Sorry, ' + $json.date + ' is fully booked. Please choose another day.') : $json.preferredTime && $json.preferredAvailable ? ($json.date + ' at ' + $json.preferredTime + ' is available.') : ($json.preferredTime ? ($json.date + ' at ' + $json.preferredTime + ' is not available. Free times on ' + $json.date + ': ' + $json.alternativeSlots.join(', ') + '.') : ('Free times on ' + $json.date + ': ' + $json.allAvailableSlots.slice(0, 6).join(', ') + '.')) }}";

  // ---- booking: UK-time start/end, re-check the slot is still free ----
  H.node(w, 'Compute Booking End Time').parameters.jsCode = KS_BUNDLE(['time']) + `
const T = KS.time;
const config = $('Merge Context').item.json;
const args = config.toolArgs || {};
const tz = config.timezone || 'Europe/London';
const menu = config.serviceMenu || [];
const match = menu.find((s) => (s.name || '').toLowerCase() === (args.service || '').toLowerCase());
const durationMinutes = (match && match.durationMinutes) || config.bookingSlotDurationMinutes || 30;
const date = String(args.date || '').slice(0, 10), time = String(args.time || '').slice(0, 5);
let problem = null, startIso = null, endIso = null, endTime = null;
if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || !/^\\d{1,2}:\\d{2}$/.test(time)) problem = 'I need the date and time for the booking.';
else {
  const st = T.zonedToUtc(date, time, tz); const en = new Date(st.getTime() + durationMinutes * 60000);
  startIso = st.toISOString(); endIso = en.toISOString(); endTime = T.localParts(en, tz).timeStr;
  const h = config.openingHours && config.openingHours[T.weekdayOf(date)];
  if (st < new Date()) problem = 'That time has already passed. Please choose a later time.';
  else if (config.openingHours && Object.keys(config.openingHours).length && !(Array.isArray(h) && T.toMinutes(time) >= T.toMinutes(h[0]) && T.toMinutes(time) + durationMinutes <= T.toMinutes(h[1]))) problem = 'That is outside our opening hours. Please choose another time.';
}
const cal = encodeURIComponent(config.googleCalendarId || 'primary');
const req = startIso ? { method: 'GET', url: 'https://www.googleapis.com/calendar/v3/calendars/' + cal + '/events?singleEvents=true&timeMin=' + encodeURIComponent(startIso) + '&timeMax=' + encodeURIComponent(endIso) } : { method: 'GET', url: 'https://www.googleapis.com/calendar/v3/calendars/' + cal + '/events?maxResults=1' };
return [{ json: { endTime, startIso, endIso, durationMinutes, problem, req } }];`;
  const ce = H.node(w, 'Compute Booking End Time').position;
  H.add(w, Object.assign(n.http('Re-check slot is free', 'gcal', { method: 'GET', sendBody: false }), { onError: 'continueRegularOutput' }), [ce[0] + 200, ce[1] + 160]);
  H.add(w, n.code('Slot still free?', `
const b = $('Compute Booking End Time').item.json;
let problem = b.problem;
if (!problem) {
  const r = $input.item.json;
  if (!(r.statusCode >= 200 && r.statusCode < 300)) problem = 'I could not check the diary just now, so I will ask the team to confirm your booking.';
  else if (((r.body || {}).items || []).some((e) => e.status !== 'cancelled' && e.transparency !== 'transparent')) problem = 'Sorry, that time has just been taken. Shall I find another time?';
}
return { json: { ...b, ok: !problem, problem } };`, { mode: 'runOnceForEachItem' }), [ce[0] + 400, ce[1] + 160]);
  H.add(w, n.iff('Can book?', 'ok'), [ce[0] + 600, ce[1] + 160]);
  H.add(w, n.code('Booking problem text', `return { json: { resultText: $json.problem } };`, { mode: 'runOnceForEachItem' }), [ce[0] + 800, ce[1] + 300]);
  H.setOut(w, 'Compute Booking End Time', 0, ['Re-check slot is free']);
  H.setOut(w, 'Re-check slot is free', 0, ['Slot still free?']);
  H.setOut(w, 'Slot still free?', 0, ['Can book?']);
  H.setOut(w, 'Can book?', 0, ['Google Calendar - Book Slot']);
  H.setOut(w, 'Can book?', 1, ['Booking problem text']);
  H.setOut(w, 'Booking problem text', 0, ['Build Tool Response']);
  const bk = H.node(w, 'Google Calendar - Book Slot').parameters;
  bk.start = "={{ $('Compute Booking End Time').item.json.startIso }}";
  bk.end = "={{ $('Compute Booking End Time').item.json.endIso }}";

  // ---- get_quote -> KS Quote Calculator ----
  H.node(w, 'Compute Quote').parameters.jsCode = `const config = $('Merge Context').item.json;
const a = config.toolArgs || {};
const answers = { ...(a.answers || {}) };
if (a.isEmergency === true || a.isEmergency === 'true') answers.urgent = 'yes';
if (a.miles) answers.miles = a.miles;
const req = { method: 'POST', url: '${QUOTE_URL}', body: { clientId: config.clientId, source: 'phone', service: a.service || '', description: a.jobDescription || a.service || '', quantity: a.quantity, answers, customer: { name: a.customerName || '', phone: a.customerPhone || '', email: a.customerEmail || '' } } };
return [{ json: { ...config, jobDescription: a.jobDescription || '', isEmergencyApplied: answers.urgent === 'yes', req } }];`;
  const cq = H.node(w, 'Compute Quote').position;
  H.add(w, Object.assign(n.http('Ask Quote Calculator', null, { method: 'POST', timeout: 20000 }), { onError: 'continueRegularOutput' }), [cq[0] + 200, cq[1] + 160]);
  H.add(w, n.code('Read quote answer', `
const prior = $('Compute Quote').item.json;
const r = $input.item.json;
const b = (r && r.body) || {};
const ok = r && r.statusCode >= 200 && r.statusCode < 300 && b.ok;
return { json: { ...prior, req: undefined, matched: !!(ok && b.total > 0), matchedJobType: b.service || null, priceMin: b.total || null, priceMax: b.total || null, quoteRef: b.ref || null, quoteMessage: ok ? b.message : null } };`, { mode: 'runOnceForEachItem' }), [cq[0] + 400, cq[1] + 160]);
  H.setOut(w, 'Compute Quote', 0, ['Ask Quote Calculator']);
  H.setOut(w, 'Ask Quote Calculator', 0, ['Read quote answer']);
  H.setOut(w, 'Read quote answer', 0, ['Was Job Type Matched?']);
  H.node(w, 'Build Quote Result Text').parameters.jsCode = `const d = $json;
return [{ json: { ...d, resultText: d.quoteMessage + ' Would you like me to book that in for you?', wasFallback: false } }];`;
  H.node(w, 'Build Fallback Quote Result Text').parameters.jsCode = `const d = $json;
const resultText = d.quoteMessage || "That needs a proper look before I can give you a price. I'll pass your details to the team and they'll come back to you with a quote. Would you like me to book a visit as well?";
return [{ json: { ...d, resultText, matchedJobType: null, wasFallback: true } }];`;
  H.node(w, 'Log Quote To QuoteLog').onError = 'continueRegularOutput';

  // ---- urgent / complaint / message -> Ops Notify (business + Bilal) ----
  const ub = H.node(w, 'Build Unknown-Tool Result Text').position;
  H.add(w, n.code('Build escalation', `
const c = $('Merge Context').item.json;
const a = c.toolArgs || {};
const kind = c.toolName === 'flag_urgent' ? 'urgent_call' : c.toolName === 'log_complaint' ? 'complaint' : 'message';
const who = (a.customerName || 'A caller') + (a.customerPhone ? ' (' + a.customerPhone + ')' : '');
const what = a.summary || a.message || '';
const text = kind === 'urgent_call' ? 'URGENT: ' + who + ' - ' + what + (a.address ? '. Address: ' + a.address : '') + '. Please call them back now.'
  : kind === 'complaint' ? 'Complaint from ' + who + ': ' + what + (a.severity ? ' (severity ' + a.severity + ')' : '') + '. A manager should call them back.'
  : 'Message for ' + (a.forPerson || 'the team') + ' from ' + who + ': ' + what;
return { json: { kind, clientId: c.clientId, clientName: c.businessName, text, businessText: text, audience: kind === 'message' ? 'business' : 'both', business: { email: c.businessNotificationEmail, sms: c.escalationSmsNumber || c.managerPhoneNumber, isDemo: !!c.isDemo } } };`, { mode: 'runOnceForEachItem' }), [ub[0], ub[1] + 200]);
  H.add(w, n.notify('Tell the business now'), [ub[0] + 220, ub[1] + 200]);
  H.add(w, n.code('Escalation result text', `
const k = $('Build escalation').item.json.kind;
const resultText = k === 'urgent_call' ? 'I have alerted the team straight away and someone will call you back as soon as possible. If anyone is in danger, please call 999, or the gas emergency line on 0800 111 999 if you can smell gas.'
  : k === 'complaint' ? "I'm sorry about this. I've passed it to a manager, who will contact you."
  : "Thanks, I've passed your message to the team and they'll get back to you.";
return { json: { resultText } };`, { mode: 'runOnceForEachItem' }), [ub[0] + 440, ub[1] + 200]);
  H.setOut(w, 'Build escalation', 0, ['Tell the business now']);
  H.setOut(w, 'Tell the business now', 0, ['Escalation result text']);
  H.setOut(w, 'Escalation result text', 0, ['Build Tool Response']);

  // ---- reschedule ----
  H.add(w, n.code('Find booking request', `
const c = $('Merge Context').item.json;
const a = c.toolArgs || {};
const digits = String(a.customerPhone || '').replace(/\\D/g, '').slice(-9);
const cal = encodeURIComponent(c.googleCalendarId || 'primary');
const now = new Date(), until = new Date(Date.now() + 90 * 86400000);
return { json: { digits, req: { method: 'GET', url: 'https://www.googleapis.com/calendar/v3/calendars/' + cal + '/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=' + encodeURIComponent(now.toISOString()) + '&timeMax=' + encodeURIComponent(until.toISOString()) } } };`, { mode: 'runOnceForEachItem' }), [ub[0], ub[1] + 400]);
  H.add(w, Object.assign(n.http('Search bookings', 'gcal', { method: 'GET', sendBody: false }), { onError: 'continueRegularOutput' }), [ub[0] + 220, ub[1] + 400]);
  H.add(w, n.code('Pick booking to move', KS_BUNDLE(['time']) + `
const T = KS.time;
const c = $('Merge Context').item.json;
const a = c.toolArgs || {};
const tz = c.timezone || 'Europe/London';
const digits = $('Find booking request').item.json.digits;
const items = (($json.body || {}).items) || [];
const ev = digits.length >= 6 ? items.find((e) => String(e.description || '').replace(/\\D/g, '').includes(digits)) : null;
if (!ev) return { json: { found: false, resultText: "I couldn't find an upcoming booking under that phone number. I'll pass a message to the team to sort it out." } };
const date = String(a.newDate || '').slice(0, 10), time = String(a.newTime || '').slice(0, 5);
if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || !/^\\d{1,2}:\\d{2}$/.test(time)) return { json: { found: false, resultText: 'What new date and time would you like?' } };
const oldS = new Date(ev.start.dateTime || ev.start.date), oldE = new Date(ev.end.dateTime || ev.end.date);
const dur = Math.max(15, Math.round((oldE - oldS) / 60000) || 60);
const st = T.zonedToUtc(date, time, tz), en = new Date(st.getTime() + dur * 60000);
if (st < new Date()) return { json: { found: false, resultText: 'That time has already passed. Please choose a later time.' } };
const cal = encodeURIComponent(c.googleCalendarId || 'primary');
return { json: { found: true, eventId: ev.id, newDate: date, newTime: time, req: { method: 'PATCH', url: 'https://www.googleapis.com/calendar/v3/calendars/' + cal + '/events/' + ev.id, body: { start: { dateTime: st.toISOString() }, end: { dateTime: en.toISOString() }, description: (ev.description || '') + '\\nRescheduled by AI phone assistant on ' + new Date().toISOString() } } } };`, { mode: 'runOnceForEachItem' }), [ub[0] + 440, ub[1] + 400]);
  H.add(w, n.iff('Booking found?', 'found'), [ub[0] + 660, ub[1] + 400]);
  H.add(w, Object.assign(n.http('Move booking', 'gcal', { method: 'PATCH' }), { onError: 'continueRegularOutput' }), [ub[0] + 880, ub[1] + 340]);
  H.add(w, n.code('Reschedule result text', `
const p = $('Pick booking to move').item.json;
const ok = $json.statusCode >= 200 && $json.statusCode < 300;
return { json: { resultText: ok ? 'Done. Your booking has been moved to ' + p.newDate + ' at ' + p.newTime + '.' : "I couldn't move the booking just now, so I've asked the team to do it and they'll confirm with you." } };`, { mode: 'runOnceForEachItem' }), [ub[0] + 1100, ub[1] + 340]);
  H.add(w, n.code('Reschedule not possible', `return { json: { resultText: $json.resultText } };`, { mode: 'runOnceForEachItem' }), [ub[0] + 880, ub[1] + 480]);
  H.setOut(w, 'Find booking request', 0, ['Search bookings']);
  H.setOut(w, 'Search bookings', 0, ['Pick booking to move']);
  H.setOut(w, 'Pick booking to move', 0, ['Booking found?']);
  H.setOut(w, 'Booking found?', 0, ['Move booking']);
  H.setOut(w, 'Booking found?', 1, ['Reschedule not possible']);
  H.setOut(w, 'Move booking', 0, ['Reschedule result text']);
  H.setOut(w, 'Reschedule result text', 0, ['Build Tool Response']);
  H.setOut(w, 'Reschedule not possible', 0, ['Build Tool Response']);

  // switch outputs: 0 check, 1 book, 2 quote, 3 urgent, 4 complaint, 5 message, 6 reschedule, 7 unknown
  H.setOut(w, 'Route On Tool Name', 3, ['Build escalation']);
  H.setOut(w, 'Route On Tool Name', 4, ['Build escalation']);
  H.setOut(w, 'Route On Tool Name', 5, ['Build escalation']);
  H.setOut(w, 'Route On Tool Name', 6, ['Find booking request']);
  H.setOut(w, 'Route On Tool Name', 7, unknownTargets.length ? unknownTargets : ['Build Unknown-Tool Result Text']);
};

function KS_BUNDLE(libs) { return require('../scripts/n8n').bundle(libs); }
