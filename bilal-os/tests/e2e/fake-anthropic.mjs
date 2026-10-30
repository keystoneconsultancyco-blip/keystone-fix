// Fake Anthropic Messages API for local testing (port 8083). Point the SDK at it
// with ANTHROPIC_BASE_URL=http://localhost:8083. Each call reports
// FAKE_IN/FAKE_OUT tokens so the cost cap can be exercised.
import http from "node:http";
const IN = Number(process.env.FAKE_IN ?? 20000), OUT = Number(process.env.FAKE_OUT ?? 2000);
let calls = 0;

function fromSchema(s) {
  if (s.enum) return s.enum[0];
  if (s.type === "object") return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, fromSchema(v)]));
  if (s.type === "array") return [fromSchema(s.items ?? { type: "string" })];
  if (s.type === "integer" || s.type === "number") return 75;
  if (s.type === "boolean") return true;
  return "example";
}

http.createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  if (req.url === "/_calls") { res.end(JSON.stringify({ calls })); return; }
  const body = JSON.parse(b || "{}");
  calls++;
  const sys = typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? "");
  const prompt = JSON.stringify(body.messages?.[0]?.content ?? "");
  let text;
  const schema = body.output_config?.format?.schema;
  if (schema) {
    const obj = fromSchema(schema);
    if (sys.includes("Telegram messages")) Object.assign(obj, { intent: "add_task", title: "Buy textbook", when: "2026-11-02T10:00", end: "", day_offset: 0, reply: "" });
    text = JSON.stringify(obj);
  } else if (prompt.includes("Write the guide section")) {
    text = "## Week 1\n### In one minute\n- Demand falls when price rises.\n### Worked examples\nPrice 10 → 12 is +20%; quantity 100 → 80 is −20%; elasticity = −20 / 20 = −1.";
  } else {
    text = "<b>Morning!</b> Fake AI briefing.";
  }
  res.writeHead(200, { "Content-Type": "application/json", "request-id": "req_fake" });
  res.end(JSON.stringify({
    id: `msg_${calls}`, type: "message", role: "assistant", model: body.model,
    content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: IN, output_tokens: OUT, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  }));
}).listen(8083, () => console.log("fake anthropic on :8083"));
