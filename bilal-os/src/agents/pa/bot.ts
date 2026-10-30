// Two-way Telegram bot (long polling, runs inside the worker).
// Only the linked chat is answered; everything else is ignored.
import { Bot, type Context } from "grammy";
import { getSecret, setSecret } from "@/lib/settings";
import { q, one } from "@/lib/db";
import { decideApproval } from "@/lib/approvals";
import { logActivity } from "@/lib/activity";
import { esc } from "@/lib/telegram";

export type CommandHandler = (args: string, ctx: Context) => Promise<string | void>;
const commands = new Map<string, { description: string; handler: CommandHandler }>();
let textHandler: ((text: string, ctx: Context) => Promise<string | void>) | null = null;

/** Sectors call this to add a /command. */
export function registerCommand(name: string, description: string, handler: CommandHandler) {
  commands.set(name, { description, handler });
}

/** The PA's natural-language handler for messages that aren't /commands. */
export function setTextHandler(fn: (text: string, ctx: Context) => Promise<string | void>) {
  textHandler = fn;
}

let bot: Bot | null = null;
let currentToken: string | null = null;
let watcher: NodeJS.Timeout | null = null;

async function isOwner(ctx: Context): Promise<boolean> {
  const chatId = await getSecret("telegram_chat_id");
  return Boolean(chatId && String(ctx.chat?.id) === chatId);
}

async function tryPair(ctx: Context, code: string): Promise<boolean> {
  const row = await one<{ value: { code: string; expires: number } }>(
    "SELECT value FROM agent_state WHERE agent_id = 'system' AND key = 'telegram_pair'",
  );
  if (!row || !code || row.value.code !== code.trim() || Date.now() > row.value.expires) return false;
  await setSecret("telegram_chat_id", String(ctx.chat!.id));
  await q("DELETE FROM agent_state WHERE agent_id = 'system' AND key = 'telegram_pair'");
  await logActivity({ sectorId: "pa", message: "Telegram linked" });
  return true;
}

function build(token: string): Bot {
  const b = new Bot(token);

  b.command("start", async (ctx) => {
    if (await isOwner(ctx)) return void ctx.reply("You're already linked. Send /help to see what I can do.");
    if (await tryPair(ctx, ctx.match)) return void ctx.reply("✅ Linked! I'm your Bilal OS assistant. Send /help to see what I can do.");
    // Silently ignore strangers; give a hint only if they used a code.
    if (ctx.match) await ctx.reply("That code didn't work or has expired. Make a new one on the dashboard Setup page.");
  });

  b.on("callback_query:data", async (ctx) => {
    if (!(await isOwner(ctx))) return void ctx.answerCallbackQuery();
    const m = /^appr:(\d+):(approve|reject)$/.exec(ctx.callbackQuery.data);
    if (m) {
      const res = await decideApproval(Number(m[1]), m[2] as "approve" | "reject", "via Telegram");
      await ctx.answerCallbackQuery({ text: res ? (m[2] === "approve" ? "Approved ✅" : "Rejected ❌") : "Already decided" });
      if (res) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      return;
    }
    const handler = callbackHandlers.find((h) => h.prefix && ctx.callbackQuery.data.startsWith(h.prefix));
    if (handler) {
      const text = await handler.fn(ctx.callbackQuery.data.slice(handler.prefix.length), ctx);
      await ctx.answerCallbackQuery({ text: text ?? "Done" });
      return;
    }
    await ctx.answerCallbackQuery();
  });

  b.on("message:text", async (ctx) => {
    if (!(await isOwner(ctx))) return;
    const text = ctx.message.text.trim();
    await q("INSERT INTO telegram_messages (direction, text) VALUES ('in', $1)", [text.slice(0, 4000)]);
    let reply: string | void = undefined;
    try {
      if (text.startsWith("/")) {
        const [cmd, ...rest] = text.slice(1).split(" ");
        const name = cmd.split("@")[0].toLowerCase();
        if (name === "help") reply = helpText();
        else {
          const c = commands.get(name);
          reply = c ? await c.handler(rest.join(" "), ctx) : `I don't know /${esc(name)}. Send /help.`;
        }
      } else if (textHandler) {
        reply = await textHandler(text, ctx);
      }
    } catch (e) {
      reply = `Sorry, something went wrong: ${esc((e as Error).message)}`;
      await logActivity({ sectorId: "pa", level: "error", message: `Telegram handler error: ${(e as Error).message}` });
    }
    if (reply) {
      await ctx.reply(reply, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      await q("INSERT INTO telegram_messages (direction, text) VALUES ('out', $1)", [reply.slice(0, 4000)]);
    }
  });

  b.catch((err) => console.error("[bot] error", err.message));
  return b;
}

const callbackHandlers: { prefix: string; fn: (data: string, ctx: Context) => Promise<string | void> }[] = [];
export function registerCallback(prefix: string, fn: (data: string, ctx: Context) => Promise<string | void>) {
  callbackHandlers.push({ prefix, fn });
}

function helpText(): string {
  const lines = [...commands.entries()].map(([n, c]) => `/${n} — ${esc(c.description)}`);
  return `<b>Bilal OS</b>\nYou can just talk to me normally, e.g. "remind me to email my tutor at 4pm" or "what's on tomorrow?".\n\n${lines.join("\n")}`;
}

async function syncCommands(b: Bot) {
  await b.api.setMyCommands([{ command: "help", description: "What I can do" }, ...[...commands.entries()].map(([n, c]) => ({ command: n, description: c.description.slice(0, 250) }))]).catch(() => {});
}

async function startWith(token: string) {
  bot = build(token);
  currentToken = token;
  await bot.init();
  await syncCommands(bot);
  void bot.start({ drop_pending_updates: false, onStart: (me) => console.log(`[bot] polling as @${me.username}`) }).catch((e) => {
    console.error("[bot] polling stopped:", e.message);
    bot = null;
    currentToken = null;
  });
}

/** Starts the bot and restarts it whenever the token on the Setup page changes. */
export async function startBot() {
  await import("./telegram-handlers"); // registers PA commands + text handler
  const check = async () => {
    const token = await getSecret("telegram_bot_token");
    if (token === currentToken && bot) return;
    if (bot) await bot.stop().catch(() => {});
    bot = null;
    currentToken = null;
    if (token) await startWith(token).catch((e) => console.error("[bot] start failed:", e.message));
  };
  await check();
  watcher = setInterval(() => void check(), 60_000);
}

export async function stopBot() {
  if (watcher) clearInterval(watcher);
  if (bot) await bot.stop();
}

export async function botUsername(token: string): Promise<string | null> {
  try {
    const b = new Bot(token);
    await b.init();
    return b.botInfo.username;
  } catch {
    return null;
  }
}
