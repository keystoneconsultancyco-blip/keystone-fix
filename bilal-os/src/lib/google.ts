import { google, calendar_v3, drive_v3 } from "googleapis";
import { getSecret, setSecret } from "./settings";
import { env } from "./env";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",      // read your calendar, add events/reminders
  "https://www.googleapis.com/auth/drive.file",    // only files/folders Bilal OS creates
];

export class GoogleNotConnectedError extends Error {
  constructor() { super("Google isn't connected yet. Use Setup → Connect Google."); this.name = "GoogleNotConnectedError"; }
}

export function redirectUri() {
  return `${env.appUrl}/api/google/callback`;
}

export async function oauthClient() {
  const [id, secret] = await Promise.all([getSecret("google_client_id"), getSecret("google_client_secret")]);
  if (!id || !secret) return null;
  return new google.auth.OAuth2(id, secret, redirectUri());
}

export async function authUrl(state: string): Promise<string | null> {
  const c = await oauthClient();
  if (!c) return null;
  return c.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES, state });
}

export async function exchangeCode(code: string) {
  const c = await oauthClient();
  if (!c) throw new Error("Google client ID/secret missing");
  const { tokens } = await c.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Remove Bilal OS from your Google account permissions and try again.");
  await setSecret("google_refresh_token", tokens.refresh_token);
}

async function authed() {
  const c = await oauthClient();
  const refresh = await getSecret("google_refresh_token");
  if (!c || !refresh) throw new GoogleNotConnectedError();
  c.setCredentials({ refresh_token: refresh });
  return c;
}

export async function isGoogleConnected(): Promise<boolean> {
  return Boolean((await getSecret("google_refresh_token")) && (await getSecret("google_client_id")));
}

export async function calendarApi(): Promise<calendar_v3.Calendar> {
  return google.calendar({ version: "v3", auth: await authed() });
}

export async function driveApi(): Promise<drive_v3.Drive> {
  return google.drive({ version: "v3", auth: await authed() });
}

/** Find or create a Drive folder by name under a parent (root if none). */
export async function ensureFolder(drive: drive_v3.Drive, name: string, parentId?: string): Promise<string> {
  const safe = name.replace(/'/g, "\\'");
  const parent = parentId ? `'${parentId}' in parents and ` : "'root' in parents and ";
  const found = await drive.files.list({
    q: `${parent}name = '${safe}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)", spaces: "drive",
  });
  const existing = found.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined },
    fields: "id",
  });
  return created.data.id!;
}

/** Create or overwrite a Google Doc from Markdown/plain text (Drive converts it). */
export async function upsertDoc(drive: drive_v3.Drive, opts: { name: string; parentId: string; markdown: string; existingId?: string | null }): Promise<string> {
  const media = { mimeType: "text/markdown", body: opts.markdown };
  if (opts.existingId) {
    try {
      await drive.files.update({ fileId: opts.existingId, media, fields: "id" });
      return opts.existingId;
    } catch { /* deleted by user: recreate below */ }
  }
  const res = await drive.files.create({
    requestBody: { name: opts.name, parents: [opts.parentId], mimeType: "application/vnd.google-apps.document" },
    media, fields: "id",
  });
  return res.data.id!;
}
