'use strict';
// CHANGE_LIST #5: [Stock] Phone Booking - 1. Inbound IVR
//  - greeting from the client's registry row, British voice
//  - no key pressed / wrong key -> put through to reception (was: "Goodbye" and hang up)
//  - option 2 uses the client's Vapi SIP URI when set
//  - if the client can't be looked up, the caller gets voicemail (not an error) and Bilal is told
const n = require('../scripts/n8n');
const { H } = require('../scripts/stock');
const VOICE = 'voice="Polly.Amy-Neural" language="en-GB"';

module.exports = async function modify(w) {
  const greet = H.node(w, 'Build Greeting TwiML').parameters.assignments.assignments[0];
  greet.value = `=<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" timeout="6" action="https://keystoneconsultancy.app.n8n.cloud/webhook/twilio/gather-result" method="POST">
    <Say ${VOICE}>{{ ($json.greeting || ('Thanks for calling ' + $json.businessName + '.')).replace(/&/g, 'and').replace(/</g, '') }} Press 1 to speak to the team. Press 2 to book, reschedule or get a price estimate.</Say>
  </Gather>
  <Say ${VOICE}>Putting you through to the team now.</Say>
  <Dial>{{ $json.receptionForwardNumber }}</Dial>
</Response>`;
  H.node(w, 'Build Forward-To-Reception TwiML').parameters.assignments.assignments[0].value = `=<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say ${VOICE}>Connecting you now.</Say>
  <Dial>{{ $json.receptionForwardNumber }}</Dial>
</Response>`;
  H.node(w, 'Build Fallback TwiML').parameters.assignments.assignments[0].value = `=<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say ${VOICE}>Let me put you through to the team.</Say>
  <Dial>{{ $json.receptionForwardNumber }}</Dial>
</Response>`;
  H.node(w, 'Build Vapi Handoff TwiML').parameters.assignments.assignments[0].value = `=<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true" action="https://keystoneconsultancy.app.n8n.cloud/webhook/twilio/vapi-dial-status" method="POST">
    <Sip>
      {{ $json.vapiSipUri ? $json.vapiSipUri : ('sip:' + $json.calledNumber + '@' + $json.vapiSipCredentialId + '.' + $json.vapiSipRegionHost) }}
      <Parameter name="clientId" value="{{ $json.clientId }}" />
      <Parameter name="callerNumber" value="{{ $json.callerNumber }}" />
    </Sip>
  </Dial>
</Response>`;
  const sf = H.node(w, 'Build SIP-Failure Fallback TwiML');
  sf.parameters.jsCode = sf.parameters.jsCode.replace('<Say voice="Polly.Joanna">', `<Say ${VOICE}>`);

  // Fail-safe if Client Config can't find the client
  const p = H.node(w, 'Get Client Config').position;
  H.add(w, n.code('Safe voicemail TwiML', `
let call = {};
for (const nm of ['Inbound Call', 'Gather Result', 'Dial Status Callback']) { try { call = $(nm).first().json.body || {}; if (call.From) break; } catch (e) {} }
const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say ${VOICE}>Sorry, we can\\'t take your call right now. Please leave your name, number and a short message after the tone and we\\'ll call you back.</Say><Record maxLength="120" playBeep="true"/></Response>';
return [{ json: { twiml, notice: { kind: 'urgent_call', audience: 'bilal', text: 'Phone line problem: a call from ' + (call.From || 'unknown') + ' to ' + (call.To || 'unknown') + ' could not be matched to a client (Client Config failed). The caller was sent to voicemail. Check My Clients > Business phone number.' } } }];`), [p[0] + 200, p[1] + 520]);
  H.add(w, n.respond('Return voicemail TwiML', 'xml'), [p[0] + 420, p[1] + 460]);
  H.add(w, n.code('Voicemail notice', `return [{ json: $input.first().json.notice }];`), [p[0] + 420, p[1] + 600]);
  H.add(w, n.notify('Tell Bilal (phone line)'), [p[0] + 640, p[1] + 600]);
  for (const nm of ['Get Client Config', 'Get Client Config1', 'Get Client Config2']) {
    H.node(w, nm).onError = 'continueErrorOutput';
    H.setOut(w, nm, 1, ['Safe voicemail TwiML']);
  }
  H.setOut(w, 'Safe voicemail TwiML', 0, ['Return voicemail TwiML', 'Voicemail notice']);
  H.setOut(w, 'Voicemail notice', 0, ['Tell Bilal (phone line)']);
};
