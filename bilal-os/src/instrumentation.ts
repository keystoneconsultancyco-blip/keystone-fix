// Runs once when the dashboard server starts. Saves the dashboard's public
// address so the worker can put correct links in Telegram messages.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  if (!url || !process.env.DATABASE_URL) return;
  try {
    const { q } = await import("./lib/db");
    await q(
      `INSERT INTO settings (key, value) VALUES ('system.appUrl', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(url.replace(/\/$/, ""))],
    );
  } catch (e) {
    console.error("[web] couldn't save app URL:", (e as Error).message);
  }
}
