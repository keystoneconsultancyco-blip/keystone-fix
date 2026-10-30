import { q, one } from "./db";
import { encrypt, decrypt, maskHint } from "./crypto";

/**
 * Every editable setting with its default. Agents read these via getSetting();
 * the Settings pages edit them. Add new keys here so they get a default.
 */
export const SETTING_DEFAULTS = {
  "general.timezone": "Europe/London",
  "general.name": "Bilal",
  "general.quietHoursStart": "22:30",
  "general.quietHoursEnd": "07:30",

  "llm.fastModel": "claude-haiku-5-5",
  "llm.strongModel": "claude-opus-5-5",
  // Prices in US dollars per million tokens: [input, output, cacheRead, cacheWrite].
  "llm.prices": {
    "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
    "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
    "claude-opus-5-5": [4, 20, 0.2, 5],
  } as Record<string, number[]>,
  "llm.usdToGbp": 0.79,
  "cost.monthlyCapGbp": 10,
  "cost.warnAtPercent": 80,

  "pa.briefingTime": "07:00",
  "pa.wrapupTime": "21:30",

  "uni.moodleUrl": "https://moodle.royalholloway.ac.uk",
  "uni.timetableIcsUrl": "",
  "uni.timetableUrl": "https://timetable.royalholloway.ac.uk",
  "uni.driveRootName": "Bilal OS — Uni",
  "uni.termStart": "2026-09-28",

  "workexp.minScoreToAlert": 70,
  "workexp.autoSubmit": false,
  "workexp.sources": [
    { id: "brightnetwork", name: "Bright Network", url: "https://www.brightnetwork.co.uk/search/?content_types=jobs&career_path_sectors=investment-banking-investment-management&job_types=insight-programme", enabled: true },
    { id: "ratemyplacement", name: "RateMyPlacement (spring weeks)", url: "https://www.ratemyplacement.co.uk/search?jobType=insight", enabled: true },
    { id: "gradcracker-free", name: "TARGETjobs insight days", url: "https://targetjobs.co.uk/internships?type=insight", enabled: true },
  ] as { id: string; name: string; url: string; enabled: boolean }[],
  "workexp.profile": {
    summary:
      "First-year BSc Economics student at Royal Holloway, University of London. Runs Keystone, a finance-operations consultancy, and a property-sourcing side business. Interested in private equity and investment.",
    cvText: "",
    targets: ["private equity", "investment management", "investment banking", "asset management"],
  } as { summary: string; cvText: string; targets: string[] },
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
type Widen<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T;
export type SettingValue<K extends SettingKey> = Widen<(typeof SETTING_DEFAULTS)[K]>;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await one<{ value: any }>("SELECT value FROM settings WHERE key = $1", [key]);
  return (row ? row.value : SETTING_DEFAULTS[key]) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
  await q(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const rows = await q<{ key: string; value: unknown }>("SELECT key, value FROM settings");
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** Secrets that can be entered on the Setup page. */
export const SECRET_DEFS = {
  anthropic_api_key: { label: "Anthropic API key", help: "From console.anthropic.com → API keys. Starts with sk-ant-." },
  telegram_bot_token: { label: "Telegram bot token", help: "From @BotFather after /newbot." },
  google_client_id: { label: "Google OAuth client ID", help: "Google Cloud Console → Credentials." },
  google_client_secret: { label: "Google OAuth client secret", help: "Shown next to the client ID." },
  moodle_username: { label: "RHUL username / email", help: "What you type to log in to Moodle." },
  moodle_password: { label: "RHUL password", help: "Stored encrypted. Used only by the Moodle and timetable agents." },
  google_refresh_token: { label: "Google refresh token", help: "Filled in automatically when you click Connect Google.", internal: true },
  telegram_chat_id: { label: "Telegram chat ID", help: "Filled in automatically when you link Telegram.", internal: true },
} as const;
export type SecretKey = keyof typeof SECRET_DEFS;

export async function getSecret(key: SecretKey): Promise<string | null> {
  const row = await one<{ ciphertext: string }>("SELECT ciphertext FROM secrets WHERE key = $1", [key]);
  return row ? decrypt(row.ciphertext) : null;
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  const v = value.trim();
  await q(
    `INSERT INTO secrets (key, ciphertext, hint) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, hint = EXCLUDED.hint, updated_at = now()`,
    [key, encrypt(v), maskHint(v)],
  );
}

export async function deleteSecret(key: SecretKey): Promise<void> {
  await q("DELETE FROM secrets WHERE key = $1", [key]);
}

/** Safe for the browser: only which secrets exist and a masked hint. */
export async function secretStatus(): Promise<Record<string, { set: boolean; hint: string | null; updatedAt: string | null }>> {
  const rows = await q<{ key: string; hint: string; updated_at: Date }>("SELECT key, hint, updated_at FROM secrets");
  const out: Record<string, { set: boolean; hint: string | null; updatedAt: string | null }> = {};
  for (const k of Object.keys(SECRET_DEFS)) out[k] = { set: false, hint: null, updatedAt: null };
  for (const r of rows) out[r.key] = { set: true, hint: r.hint, updatedAt: r.updated_at.toISOString() };
  return out;
}
