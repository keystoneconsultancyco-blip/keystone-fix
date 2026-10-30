import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { generateSecret, generateURI, verify } from "otplib";
import { q, one } from "./db";
import { encrypt, decrypt, hashPassword, verifyPassword, randomToken, sha256 } from "./crypto";
import { env } from "./env";

export const SESSION_COOKIE = "bos_session";
const SESSION_DAYS = 180; // long-lived on your own devices

export async function userExists(): Promise<boolean> {
  return Boolean(await one("SELECT 1 FROM auth_user WHERE id = 1"));
}

export async function createUser(password: string) {
  if (await userExists()) throw new Error("Account already exists");
  if (password.length < 12) throw new Error("Use at least 12 characters");
  await q("INSERT INTO auth_user (id, password_hash) VALUES (1, $1)", [await hashPassword(password)]);
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/** 5 failed logins in 15 minutes locks the login form for 15 minutes. */
export async function loginLocked(): Promise<boolean> {
  const row = await one<{ n: number }>("SELECT count(*)::int AS n FROM login_attempts WHERE success = false AND ts > now() - interval '15 minutes'");
  return (row?.n ?? 0) >= 5;
}

export async function checkPassword(password: string): Promise<boolean> {
  const user = await one<{ password_hash: string }>("SELECT password_hash FROM auth_user WHERE id = 1");
  const ok = Boolean(user && (await verifyPassword(password, user.password_hash)));
  await q("INSERT INTO login_attempts (ip, success) VALUES ($1, $2)", [await clientIp(), ok]);
  return ok;
}

export async function totpEnabled(): Promise<boolean> {
  return Boolean((await one<{ totp_enabled: boolean }>("SELECT totp_enabled FROM auth_user WHERE id = 1"))?.totp_enabled);
}

export async function checkTotp(token: string): Promise<boolean> {
  const row = await one<{ totp_secret_enc: string | null }>("SELECT totp_secret_enc FROM auth_user WHERE id = 1");
  if (!row?.totp_secret_enc) return false;
  const ok = (await verify({ secret: decrypt(row.totp_secret_enc), token: token.replace(/\s/g, ""), epochTolerance: 30 } as any)).valid;
  if (!ok) await q("INSERT INTO login_attempts (ip, success) VALUES ($1, false)", [await clientIp()]);
  return ok;
}

/** Start TOTP enrolment: store a new (not yet enabled) secret, return the otpauth URI for the QR code. */
export async function beginTotpEnrolment(): Promise<string> {
  // Reuse a pending (unconfirmed) secret so refreshing the page doesn't change the QR code.
  const row = await one<{ totp_secret_enc: string | null; totp_enabled: boolean }>("SELECT totp_secret_enc, totp_enabled FROM auth_user WHERE id = 1");
  let secret = row?.totp_secret_enc && !row.totp_enabled ? decrypt(row.totp_secret_enc) : null;
  if (!secret) {
    secret = generateSecret();
    await q("UPDATE auth_user SET totp_secret_enc = $1, totp_enabled = false WHERE id = 1", [encrypt(secret)]);
  }
  return generateURI({ issuer: "Bilal OS", label: "Bilal", secret });
}

export async function confirmTotpEnrolment(token: string): Promise<boolean> {
  const ok = await checkTotp(token);
  if (ok) await q("UPDATE auth_user SET totp_enabled = true WHERE id = 1");
  return ok;
}

export async function createSession(mfaPassed: boolean): Promise<void> {
  const token = randomToken();
  const h = await headers();
  await q("INSERT INTO sessions (id, expires_at, user_agent, mfa_passed) VALUES ($1, now() + ($2 || ' days')::interval, $3, $4)", [
    sha256(token), String(SESSION_DAYS), (h.get("user-agent") ?? "").slice(0, 300), mfaPassed,
  ]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400,
  });
}

export async function markSessionMfa(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await q("UPDATE sessions SET mfa_passed = true WHERE id = $1", [sha256(token)]);
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await q("DELETE FROM sessions WHERE id = $1", [sha256(token)]);
  jar.delete(SESSION_COOKIE);
}

export type SessionState = "none" | "needs-mfa" | "needs-enrol" | "ok";

export async function sessionState(): Promise<SessionState> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return "none";
  const s = await one<{ mfa_passed: boolean; last_seen: Date }>("SELECT mfa_passed, last_seen FROM sessions WHERE id = $1 AND expires_at > now()", [sha256(token)]);
  if (!s) return "none";
  if (Date.now() - new Date(s.last_seen).getTime() > 3600_000) await q("UPDATE sessions SET last_seen = now() WHERE id = $1", [sha256(token)]);
  if (!(await totpEnabled())) return "needs-enrol";
  return s.mfa_passed ? "ok" : "needs-mfa";
}

/** Use at the top of every protected page. */
export async function requireUser(): Promise<void> {
  if (!(await userExists())) redirect("/login");
  const st = await sessionState();
  if (st === "none") redirect("/login");
  if (st === "needs-mfa") redirect("/login/2fa");
  if (st === "needs-enrol") redirect("/login/enrol");
}

/** Use at the top of every protected API route. Returns a Response to send if not authorised. */
export async function apiGuard(): Promise<Response | null> {
  const st = await sessionState();
  if (st !== "ok") return Response.json({ error: "Not signed in" }, { status: 401 });
  return null;
}
