// Minimal fake of the Telegram Bot API for local testing of the bot.
// Usage: node tests/e2e/fake-telegram.mjs  (listens on :8081)
// POST /_inject {text} or {callback} to simulate Bilal; GET /_sent to read replies.
import http from "node:http";
const updates = [];
const sent = [];
let uid = 1;
const CHAT = { id: 4242, type: "private", first_name: "Bilal" };
http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const data = body ? (req.headers["content-type"]?.includes("json") ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body))) : {};
  const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (req.url === "/_inject") {
    const u = { update_id: uid++ };
    if (data.callback) u.callback_query = { id: String(uid), from: CHAT, chat_instance: "x", data: data.callback, message: { message_id: 1, date: 0, chat: CHAT } };
    else u.message = { message_id: uid, date: Math.floor(Date.now() / 1000), chat: CHAT, from: { ...CHAT, is_bot: false }, text: data.text, entities: data.text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: data.text.split(" ")[0].length }] : undefined };
    updates.push(u);
    return json({ ok: true });
  }
  if (req.url === "/_sent") return json(sent);
  const method = req.url.split("/").pop();
  if (method === "getMe") return json({ ok: true, result: { id: 1, is_bot: true, first_name: "BilalOS", username: "bilal_os_test_bot" } });
  if (method === "getUpdates") {
    const offset = Number(data.offset ?? 0);
    const wait = Date.now() + 2000;
    while (Date.now() < wait && !updates.some((u) => u.update_id >= offset)) await new Promise((r) => setTimeout(r, 100));
    return json({ ok: true, result: updates.filter((u) => u.update_id >= offset) });
  }
  if (method === "sendMessage") { sent.push(data); return json({ ok: true, result: { message_id: 99, date: 0, chat: CHAT, text: data.text } }); }
  return json({ ok: true, result: true });
}).listen(8081, () => console.log("fake telegram on :8081"));
