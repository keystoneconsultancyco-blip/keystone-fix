'use strict';
// Builds a client's Vapi assistant + tools from the registry (used by scripts/vapi-setup.js).
// Tool names and arguments match [Stock] Phone Booking - 2. Vapi Tools.

const TOOLS_URL = 'https://keystoneconsultancy.app.n8n.cloud/webhook/vapi/tools';
const END_URL = 'https://keystoneconsultancy.app.n8n.cloud/webhook/vapi/end-of-call';

const s = (description) => ({ type: 'string', description });
const TOOL_SPECS = [
  ['check_availability', 'Check free appointment times on a date. Always call this before booking.', { date: s('YYYY-MM-DD'), service: s('Service name exactly as listed'), preferredTime: s('HH:MM 24h, optional') }, ['date', 'service']],
  ['book_appointment', 'Book a time the caller agreed, after check_availability said it is free.', { date: s('YYYY-MM-DD'), time: s('HH:MM 24h'), service: s('Service name'), customerName: s('Full name'), customerPhone: s('Callback number'), customerEmail: s('Email for the confirmation, optional') }, ['date', 'time', 'service', 'customerName', 'customerPhone']],
  ['get_quote', 'Get a price ESTIMATE from the business price list. Always tell the caller it is an estimate.', { jobDescription: s('What the caller needs, in their words'), service: s('Service name if known, optional'), quantity: s('Number of units (hours, radiators, miles) if relevant, optional'), isEmergency: { type: 'boolean', description: 'true if they need it today or out of hours' } }, ['jobDescription']],
  ['flag_urgent', 'Alert the business immediately about an urgent problem (leak, flood, no heating, gas smell, sparking, danger).', { summary: s('What is happening'), customerName: s('Name'), customerPhone: s('Callback number'), address: s('Job address') }, ['summary', 'customerPhone']],
  ['log_complaint', 'Log a complaint and escalate to a manager. Stay calm and apologetic.', { summary: s('The complaint'), customerName: s('Name'), customerPhone: s('Callback number'), severity: s('low, medium or high') }, ['summary', 'customerPhone']],
  ['take_message', 'Take a message for the team for anything you cannot handle.', { message: s('The message'), customerName: s('Name'), customerPhone: s('Callback number'), forPerson: s('Who it is for, optional') }, ['message', 'customerPhone']],
  ['reschedule_booking', "Move the caller's existing booking. Check availability for the new time first.", { customerPhone: s('Phone number the booking was made with'), newDate: s('YYYY-MM-DD'), newTime: s('HH:MM 24h') }, ['customerPhone', 'newDate', 'newTime']],
];

function toolBodies() {
  return TOOL_SPECS.map(([name, description, properties, required]) => ({
    type: 'function', async: false,
    function: { name, description, parameters: { type: 'object', properties, required } },
    server: { url: TOOLS_URL },
  }));
}

function systemPrompt(cfg) {
  const services = (cfg.serviceMenu || []).map((x) => `- ${x.name} (about ${x.durationMinutes} minutes)`).join('\n') || '- (ask the caller what they need)';
  const hours = Object.entries(cfg.openingHours || {}).map(([d, h]) => `${d}: ${Array.isArray(h) ? h.join('-') : 'closed'}`).join(', ');
  return `You are the phone assistant for ${cfg.businessName}, a UK business. Speak British English. Today's date: {{"now" | date: "%A %d %B %Y", "Europe/London"}}.
Tone: ${cfg.tone || 'warm, calm and professional'}.
Services:
${services}
Opening hours: ${hours}.

How to handle calls:
1. Find out what they need. Get their name and a callback number early.
2. URGENT (leak, flooding, water through ceiling, no heating or hot water, gas smell, sparking, burning smell, anyone in danger): call flag_urgent immediately, then tell them the team has been alerted. If anyone is in danger tell them to call 999, or 0800 111 999 for a gas smell.
3. Bookings: call check_availability, offer up to 3 times, agree one, call book_appointment, then read the date and time back.
4. Moving a booking: check_availability for the new time, then reschedule_booking.
5. Prices: call get_quote and say clearly it is an estimate and the team confirms the final price. Never promise a fixed price.
6. Complaints: stay calm and apologetic, never argue, call log_complaint, and say a manager will contact them.
7. Anything else: take_message.
8. If they want a person, transfer the call.
9. Never take card details or agree refunds, discounts or anything contractual.
10. If asked whether you are an AI, robot or a real person, answer honestly that you are an AI assistant for ${cfg.businessName}. Do not mention it otherwise.
Keep replies short. One question at a time.`;
}

function assistantBody(cfg, toolIds) {
  return {
    name: `Keystone - ${cfg.businessName}`.slice(0, 40),
    firstMessage: `Hi, you're through to ${cfg.businessName}. How can I help?`,
    model: { provider: 'openai', model: 'gpt-4.1', temperature: 0.4, messages: [{ role: 'system', content: systemPrompt(cfg) }], toolIds, tools: cfg.receptionForwardNumber && !/^\+447700900/.test(cfg.receptionForwardNumber) ? [{ type: 'transferCall', destinations: [{ type: 'number', number: cfg.receptionForwardNumber, message: 'Putting you through to the team now.' }] }] : [] },
    voice: { provider: 'vapi', voiceId: 'Elliot' },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'en' },
    server: { url: END_URL },
    serverMessages: ['end-of-call-report'],
    metadata: { clientId: cfg.clientId },
    analysisPlan: {
      summaryPlan: { enabled: true },
      structuredDataPlan: { enabled: true, schema: { type: 'object', properties: {
        bookingMade: { type: 'boolean' }, customerName: { type: 'string' }, customerPhone: { type: 'string' }, customerEmail: { type: 'string' },
        service: { type: 'string' }, bookingDate: { type: 'string' }, bookingTime: { type: 'string' }, transferredToManager: { type: 'boolean' }, transferReason: { type: 'string' }, complaint: { type: 'boolean' },
      } } },
    },
    endCallFunctionEnabled: true,
    maxDurationSeconds: 900,
  };
}

module.exports = { TOOL_SPECS, toolBodies, systemPrompt, assistantBody, TOOLS_URL, END_URL };
