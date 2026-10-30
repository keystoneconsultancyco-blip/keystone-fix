import fs from "node:fs/promises";
import { q, one } from "./db";
import { dataPath } from "./browser";

export async function putBlob(key: string, filename: string, mime: string, data: Buffer) {
  await q(
    `INSERT INTO blobs (key, filename, mime, data) VALUES ($1,$2,$3,$4)
     ON CONFLICT (key) DO UPDATE SET filename = EXCLUDED.filename, mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`,
    [key, filename, mime, data],
  );
}

export async function hasBlob(key: string): Promise<boolean> {
  return Boolean(await one("SELECT 1 FROM blobs WHERE key = $1", [key]));
}

/** Write a blob to the local data folder (for Playwright uploads etc.) and return its path. */
export async function blobToFile(key: string): Promise<string | null> {
  const row = await one<{ filename: string; data: Buffer }>("SELECT filename, data FROM blobs WHERE key = $1", [key]);
  if (!row) return null;
  const p = dataPath("blobs", row.filename);
  await fs.writeFile(p, row.data);
  return p;
}
