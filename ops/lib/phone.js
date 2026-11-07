'use strict';
// AI Phone Booking logic: TwiML, the per-client Vapi assistant config (built from
// the registry), free-slot calculation, urgency detection and call-outcome logging.

const T = require('./time');
const { escapeHtml } = require('./log');

const DEFAULT_URGENT = ['leak', 'leaking', 'flood', 'flooding', 'burst', 'no heating', 'no hot water', 'gas smell', 'smell of gas', 'sparking', 'burning smell', 'smoke', 'no power', 'carbon monoxide', 'emergency', 'water everywhere', 'electric shock'];

function xml(s) { return escapeHtml(s).replace(/'/g, '&apos;'); }

// Step 1: the caller hears the client greeting, then 1 for reception or 2 for the assistant.
function menuTwiml(client, actionUrl) {
  const name = client.clientName || 'us';
  const greeting = client.phone.greeting || `Thanks for calling ${name}.`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" numDigits="1" timeout="6" action="${xml(actionUrl)}" method="POST">
    <Say voice="Polly.Amy-Neural" language="en-GB">${xml(greeting)} Press 1 to speak to the team. Press 2 to book, reschedule or get a price estimate now.</Say>
  </Gather>
  <Redirect method="POST">${xml(actionUrl)}?Digits=2</Redirect>
</Response>`;
}

// Step 2: route the choice. Option 2 dials Vapi over SIP; if that fails, the fallback forwards to reception.
function routeTwiml(client, digit, { vapiSipUri, fallbackUrl }) {
  if (String(digit) === '1' || !vapiSipUri) {
    return dialReceptionTwiml(client, 'Connecting you to the team now.');
  }
  const sip = `${vapiSipUri}${vapiSipUri.includes('?') ? '&' : '?'}X-Keystone-Client=${encodeURIComponent(client.clientId)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="15" action="${xml(fallbackUrl)}" method="POST" answerOnBridge="true">
    <Sip>${xml(sip)}</Sip>
  </Dial>
</Response>`;
}

function dialReceptionTwiml(client, say) {
  const reception = client.phone.receptionNumber;
  if (!reception) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say voice="Polly.Amy-Neural" language="en-GB">Sorry, nobody is available right now. Please leave your name, number and a short message after the tone.</Say><Record maxLength="120" playBeep="true"/></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>${say ? `<Say voice="Polly.Amy-Neural" language="en-GB">${xml(say)}</Say>` : ''}<Dial timeout="25">${xml(reception)}</Dial></Response>`;
}

// Dial action callback: if the SIP leg failed, protect the caller by sending them to reception.
function sipFailed(dialCallStatus) {
  return ['failed', 'busy', 'no-answer', 'canceled'].includes(String(dialCallStatus || '').toLowerCase());
}

function fallbackTwiml(client, dialCallStatus) {
  if (!sipFailed(dialCallStatus)) return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
  return dialReceptionTwiml(client, 'Sorry about that. Let me put you through to the team.');
}

// ---------- Vapi assistant built from the registry ----------

function servicesText(services) {
  if (!services || !services.length) return 'No fixed service list. Take details and offer a callback.';
  return services.map((s) => `- ${s.name}: about ${s.durationMins || 60} minutes${s.price ? `, from £${s.price}` : ''}`).join('\n');
}

function hoursText(hours) {
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return order.map((d) => {
    const h = hours[d];
    return `${d}: ${Array.isArray(h) && h.length === 2 ? `${h[0]}-${h[1]}` : 'closed'}`;
  }).join(', ');
}

function assistantSystemPrompt(client, now) {
  const local = T.localParts(now || new Date(), client.timezone);
  return `You are the phone assistant for ${client.clientName}, a ${client.industry || 'local'} business in the UK. Today is ${local.weekday} ${local.dateStr}, and the local time is ${local.timeStr} (${client.timezone}).
Voice and tone: ${client.phone.tone}
Services you can book:
${servicesText(client.phone.services)}
Opening hours: ${hoursText(client.phone.openingHours)}

How to handle calls:
1. Find out what the caller needs. Get their name, the best callback number and the job address.
2. URGENT problems (for example ${(client.phone.urgentKeywords.length ? client.phone.urgentKeywords : DEFAULT_URGENT).slice(0, 8).join(', ')}): call flag_urgent straight away with a short summary, then tell the caller the team has been alerted and will call back as soon as possible. If anyone is in danger (gas smell, electric shock, carbon monoxide, serious flooding near electrics), tell them to call 999, or the National Gas Emergency line on 0800 111 999 for gas.
3. Bookings: use check_availability, offer up to 3 times, agree one, then call book_appointment. Read the date and time back to the caller.
4. Reschedules: use find_booking, then check_availability, then reschedule_booking.
5. Prices: use get_price_estimate. Always say it is an estimate and that the final price is confirmed by the team. Never commit to a fixed price.
6. Complaints: stay calm and apologetic and never argue. Listen, take the details, call log_complaint, and tell them a manager will contact them.
7. Anything else, or anything you can't do: call take_message so the team can call back.
8. If the caller asks for a person, call transfer_to_human.
9. Never take card details, agree refunds, discounts or contracts, or promise anything about money or legal matters. Take a message instead.
10. If asked whether you are an AI, a robot or a real person, answer honestly: you are an AI assistant working for ${client.clientName}. Do not raise it yourself otherwise.
Keep replies short and natural. Ask one question at a time. Use British English.`;
}

const TOOL_DEFS = [
  ['check_availability', 'Find free appointment slots for a service.', { service: 'string', preferredDate: 'string (YYYY-MM-DD, optional)', partOfDay: 'string: morning|afternoon|any (optional)' }, ['service']],
  ['book_appointment', 'Book a confirmed slot.', { service: 'string', start: 'string ISO datetime of the chosen slot', customerName: 'string', customerPhone: 'string', customerEmail: 'string (optional)', address: 'string', notes: 'string (optional)' }, ['service', 'start', 'customerName', 'customerPhone', 'address']],
  ['find_booking', 'Find an existing booking for this caller.', { customerName: 'string', customerPhone: 'string' }, ['customerPhone']],
  ['reschedule_booking', 'Move an existing booking to a new free slot.', { bookingId: 'string', newStart: 'string ISO datetime' }, ['bookingId', 'newStart']],
  ['get_price_estimate', 'Get an estimate from the business pricing rules.', { jobDescription: 'string', service: 'string (optional)', inputs: 'object of extra details e.g. {"miles": 12} (optional)' }, ['jobDescription']],
  ['flag_urgent', 'Alert the business immediately about an urgent job.', { summary: 'string', customerName: 'string', customerPhone: 'string', address: 'string' }, ['summary', 'customerPhone']],
  ['log_complaint', 'Log a complaint and escalate to a manager.', { summary: 'string', customerName: 'string', customerPhone: 'string', severity: 'string: low|medium|high' }, ['summary', 'customerPhone']],
  ['take_message', 'Take a message for the team.', { message: 'string', customerName: 'string', customerPhone: 'string', forPerson: 'string (optional)' }, ['message', 'customerPhone']],
];

function toolSchema([name, description, props, required]) {
  const properties = {};
  for (const [k, v] of Object.entries(props)) properties[k] = { type: v.startsWith('object') ? 'object' : 'string', description: v };
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

// Response to Vapi's "assistant-request" server message.
function buildVapiAssistant(client, { serverUrl, model = 'claude-sonnet-4-6', voiceId, now } = {}) {
  const tools = TOOL_DEFS.map(toolSchema).map((t) => ({ ...t, server: { url: serverUrl } }));
  if (client.phone.receptionNumber) {
    tools.push({
      type: 'transferCall',
      destinations: [{ type: 'number', number: client.phone.receptionNumber, message: 'Putting you through to the team now.' }],
      function: { name: 'transfer_to_human', description: 'Transfer the caller to a human at the business.' },
    });
  }
  return {
    assistant: {
      name: `${client.clientName} assistant`.slice(0, 40),
      firstMessage: `Hi, you're through to ${client.clientName}. How can I help today?`,
      model: { provider: 'anthropic', model, messages: [{ role: 'system', content: assistantSystemPrompt(client, now) }], tools },
      voice: voiceId ? { provider: '11labs', voiceId } : { provider: 'azure', voiceId: 'en-GB-SoniaNeural' },
      transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en-GB' },
      serverUrl,
      metadata: { clientId: client.clientId },
      endCallFunctionEnabled: true,
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 900,
    },
  };
}

// ---------- Calendar ----------

function eventBounds(ev, tz, defaultMins) {
  if (ev.start && ev.start.date && !ev.start.dateTime) {
    // All-day event blocks the whole local day.
    return { start: T.zonedToUtc(ev.start.date, '00:00', tz), end: T.zonedToUtc(ev.end && ev.end.date ? ev.end.date : T.addDaysStr(ev.start.date, 1), '00:00', tz) };
  }
  const start = new Date(ev.start && ev.start.dateTime ? ev.start.dateTime : ev.start);
  let end = new Date(ev.end && ev.end.dateTime ? ev.end.dateTime : ev.end);
  // Zero-duration or missing end: assume the service duration (an earlier fix, kept here).
  if (!(end > start)) end = new Date(start.getTime() + defaultMins * 60000);
  return { start, end };
}

function serviceDuration(client, serviceName) {
  const s = matchPhoneService(client, serviceName);
  return (s && Number(s.durationMins)) || 60;
}

function matchPhoneService(client, serviceName) {
  const n = String(serviceName || '').toLowerCase();
  const list = client.phone.services || [];
  return list.find((s) => s.name.toLowerCase() === n) || list.find((s) => n.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(n)) || null;
}

// Free slots across the next `days` days. An empty calendar is fine: no events means every slot in opening hours is free.
function freeSlots(client, events, { serviceName, from, days = 7, stepMins = 30, bufferMins = 15, max = 3, partOfDay = 'any', preferredDate } = {}) {
  const tz = client.timezone;
  const dur = serviceDuration(client, serviceName);
  const now = from || new Date();
  const busy = (events || []).filter((e) => e && e.status !== 'cancelled').map((e) => eventBounds(e, tz, dur));
  const leadTime = new Date(now.getTime() + 60 * 60000);
  const out = [];
  let day = preferredDate || T.localParts(now, tz).dateStr;
  for (let i = 0; i < days && out.length < max; i++, day = T.addDaysStr(day, 1)) {
    const h = client.phone.openingHours[T.weekdayOf(day)];
    if (!Array.isArray(h) || h.length !== 2) continue;
    const open = T.toMinutes(h[0]), close = T.toMinutes(h[1]);
    for (let m = open; m + dur <= close && out.length < max; m += stepMins) {
      if (partOfDay === 'morning' && m >= 12 * 60) break;
      if (partOfDay === 'afternoon' && m < 12 * 60) continue;
      const hh = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      const start = T.zonedToUtc(day, hh, tz);
      const end = new Date(start.getTime() + dur * 60000);
      if (start < leadTime) continue;
      const clash = busy.some((b) => start < new Date(b.end.getTime() + bufferMins * 60000) && end > new Date(b.start.getTime() - bufferMins * 60000));
      if (!clash) out.push({ start: start.toISOString(), end: end.toISOString(), label: `${T.weekdayOf(day)} ${day} at ${hh}` });
    }
  }
  return { durationMins: dur, slots: out, fullyBooked: out.length === 0 };
}

function slotStillFree(client, events, startIso, serviceName) {
  const dur = serviceDuration(client, serviceName);
  const start = new Date(startIso), end = new Date(start.getTime() + dur * 60000);
  const h = client.phone.openingHours[T.weekdayOf(T.localParts(start, client.timezone).dateStr)];
  if (!Array.isArray(h)) return false;
  return !(events || []).filter((e) => e && e.status !== 'cancelled').map((e) => eventBounds(e, client.timezone, dur)).some((b) => start < b.end && end > b.start);
}

// ---------- Urgency + outcome ----------

function detectUrgency(text, keywords) {
  const t = String(text || '').toLowerCase();
  const list = (keywords && keywords.length ? keywords : DEFAULT_URGENT).map((k) => k.toLowerCase());
  const hits = list.filter((k) => t.includes(k));
  return { urgent: hits.length > 0, hits };
}

function askedIfAi(transcript) {
  return /\b(are you|is this|am i (talking|speaking) to)\s+(an?\s+)?(ai|a\.i\.|robot|bot|real person|human|machine|computer)\b/i.test(String(transcript || ''));
}

// Builds the Call Log row from Vapi's end-of-call report plus the tools called during the call.
function callOutcome(client, report, toolsCalled) {
  const names = (toolsCalled || []).map((t) => t.name);
  const transcript = report.transcript || (report.artifact && report.artifact.transcript) || '';
  let category = 'Other', outcome = report.endedReason || 'ended';
  if (names.includes('flag_urgent')) category = 'Urgent';
  else if (names.includes('log_complaint')) category = 'Complaint';
  else if (names.includes('reschedule_booking')) category = 'Reschedule';
  else if (names.includes('book_appointment')) category = 'Booking';
  else if (names.includes('get_price_estimate')) category = 'Quote';
  else if (names.includes('take_message')) category = 'Message';
  else if (names.includes('transfer_to_human')) category = 'Human reception';
  const urgency = detectUrgency(transcript, client.phone.urgentKeywords);
  const missedUrgent = urgency.urgent && !names.includes('flag_urgent');
  const booking = (toolsCalled || []).find((t) => t.name === 'book_appointment' || t.name === 'reschedule_booking');
  return {
    row: {
      'Call ID': report.callId || (report.call && report.call.id) || '',
      'Client ID': client.clientId,
      'Caller number': (report.call && report.call.customer && report.call.customer.number) || report.customerNumber || '',
      'Caller name': (booking && booking.args && booking.args.customerName) || '',
      'Category': category,
      'Outcome': outcome,
      'Service': (booking && booking.args && booking.args.service) || '',
      'Booking start': booking && booking.args ? booking.args.start || booking.args.newStart || null : null,
      'Escalated': names.includes('flag_urgent') || names.includes('log_complaint') || missedUrgent,
      'Asked if AI': askedIfAi(transcript),
      'Summary': (report.summary || (report.analysis && report.analysis.summary) || '').slice(0, 5000),
      'Timestamp': new Date().toISOString(),
    },
    // Safety net: urgent words were heard but the agent never escalated, so escalate anyway.
    safetyNetEscalation: missedUrgent ? urgency.hits : null,
    events: [
      'call_handled',
      ...(names.includes('book_appointment') ? ['booking_made'] : []),
      ...(names.includes('reschedule_booking') ? ['reschedule'] : []),
      ...(names.includes('flag_urgent') || missedUrgent ? ['urgent_escalated'] : []),
      ...(names.includes('log_complaint') ? ['complaint_logged'] : []),
      ...(names.includes('take_message') ? ['message_taken'] : []),
    ],
  };
}

// Vapi tool-call payload helpers.
function parseToolCalls(body) {
  const msg = body && body.message ? body.message : body || {};
  const list = msg.toolCallList || msg.toolCalls || [];
  return list.map((tc) => {
    let args = tc.function ? tc.function.arguments : tc.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
    return { id: tc.id, name: tc.function ? tc.function.name : tc.name, args: args || {} };
  });
}

function vapiClientId(body) {
  const msg = body && body.message ? body.message : body || {};
  const call = msg.call || {};
  const md = (call.assistant && call.assistant.metadata) || call.metadata || (msg.assistant && msg.assistant.metadata) || {};
  if (md.clientId) return md.clientId;
  const sipHeaders = (call.phoneCallProviderDetails && call.phoneCallProviderDetails.sipHeaders) || call.sipHeaders || {};
  return sipHeaders['X-Keystone-Client'] || sipHeaders['x-keystone-client'] || null;
}

module.exports = {
  DEFAULT_URGENT, menuTwiml, routeTwiml, dialReceptionTwiml, sipFailed, fallbackTwiml, assistantSystemPrompt, buildVapiAssistant,
  TOOL_DEFS, eventBounds, serviceDuration, matchPhoneService, freeSlots, slotStillFree, detectUrgency, askedIfAi, callOutcome, parseToolCalls, vapiClientId,
};
