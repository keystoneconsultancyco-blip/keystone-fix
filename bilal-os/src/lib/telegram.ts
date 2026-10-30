import { Api } from "grammy";
import { getSecret } from "./settings";
import { q } from "./db";

let cached: { token: string; api: Api } | null = null;

/** TELEGRAM_API_ROOT lets tests point the bot at a fake Telegram server. */
export function telegramClientOptions() {
  return process.env.TELEGRAM_API_ROOT ? { apiRoot: process.env.TELEGRAM_API_ROOT } : undefined;
}

async function api(): Promise<Api | null> {
  const token = await getSecret("telegram_bot_token");
  if (!token) return null;
  if (!cached || cached.token !== token) cached = { token, api: new Api(token, telegramClientOptions()) };
  return cached.api;
}

/** Escape text for Telegram's HTML parse mode. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type InlineButton = { text: string; data?: string; url?: string };

/**
 * Send a message to Bilal. Returns false (never throws) if Telegram isn't set up,
 * so agents keep working before Telegram is linked.
 */
export async function sendTelegram(html: string, opts: { buttons?: InlineButton[][]; silent?: boolean } = {}): Promise<boolean> {
  const a = await api();
  const chatId = await getSecret("telegram_chat_id");
  if (!a || !chatId) return false;
  const chunks = splitMessage(html, 3900);
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    await a.sendMessage(chatId, chunks[i], {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      disable_notification: opts.silent,
      reply_markup: last && opts.buttons
        ? { inline_keyboard: opts.buttons.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? b.text }))) }
        : undefined,
    });
  }
  await q("INSERT INTO telegram_messages (direction, text) VALUES ('out', $1)", [html.slice(0, 4000)]);
  return true;
}

export function splitMessage(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}
