import path from "node:path";
import fs from "node:fs";
import type { BrowserContext } from "playwright";
import { env } from "./env";

const locks = new Map<string, Promise<unknown>>();

/**
 * Run `fn` with a persistent Chromium profile (cookies survive between runs, so
 * we rarely have to log in again). One run per profile at a time.
 */
export async function withBrowser<T>(profile: string, fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const prev = locks.get(profile) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  locks.set(profile, prev.then(() => mine));
  await prev.catch(() => {});
  const dir = path.join(env.dataDir, "browser", profile);
  fs.mkdirSync(dir, { recursive: true });
  const { chromium } = await import("playwright");
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    acceptDownloads: true,
    locale: "en-GB",
    timezoneId: "Europe/London",
    viewport: { width: 1280, height: 900 },
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close().catch(() => {});
    release();
  }
}

export function dataPath(...parts: string[]): string {
  const p = path.join(env.dataDir, ...parts);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}
