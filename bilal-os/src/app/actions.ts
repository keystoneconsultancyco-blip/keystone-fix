"use server";
// All dashboard mutations. Each action checks the session first.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  apiGuard, checkPassword, checkTotp, confirmTotpEnrolment, createSession, createUser, destroySession,
  loginLocked, markSessionMfa, totpEnabled, userExists, sessionState, beginTotpEnrolment,
} from "@/lib/auth";
import { q, one } from "@/lib/db";
import { SECRET_DEFS, SETTING_DEFAULTS, setSecret, deleteSecret, setSetting, getSecret, type SecretKey, type SettingKey } from "@/lib/settings";
import { sendCommand } from "@/lib/commands";
import { decideApproval } from "@/lib/approvals";
import { markAlertRead } from "@/lib/alerts";
import { randomToken } from "@/lib/crypto";
import { sendTelegram } from "@/lib/telegram";
import { testAnthropic } from "@/lib/llm";
import { botUsername } from "@/agents/pa/bot";
import { getAgent } from "@/agents";
import { logActivity } from "@/lib/activity";
import { parseWhen } from "@/lib/when";

type Result = { ok: boolean; message?: string; data?: any };

async function guard() {
  if (await apiGuard()) throw new Error("Not signed in");
}

// ---------- Auth ----------
export async function signupAction(_: Result | null, form: FormData): Promise<Result> {
  if (await userExists()) return { ok: false, message: "Account already exists" };
  const pw = String(form.get("password") ?? "");
  if (pw !== String(form.get("confirm") ?? "")) return { ok: false, message: "Passwords don't match" };
  try { await createUser(pw); } catch (e) { return { ok: false, message: (e as Error).message }; }
  await createSession(false);
  redirect("/login/enrol");
}

export async function loginAction(_: Result | null, form: FormData): Promise<Result> {
  if (await loginLocked()) return { ok: false, message: "Too many attempts. Wait 15 minutes and try again." };
  if (!(await checkPassword(String(form.get("password") ?? "")))) return { ok: false, message: "Wrong password" };
  await createSession(false);
  redirect((await totpEnabled()) ? "/login/2fa" : "/login/enrol");
}

export async function totpAction(_: Result | null, form: FormData): Promise<Result> {
  if ((await sessionState()) === "none") redirect("/login");
  if (await loginLocked()) return { ok: false, message: "Too many attempts. Wait 15 minutes and try again." };
  if (!(await checkTotp(String(form.get("code") ?? "")))) return { ok: false, message: "That code didn't match. Check your phone's clock is right." };
  await markSessionMfa();
  redirect("/");
}

export async function enrolStartAction(): Promise<string> {
  const st = await sessionState();
  if (st !== "needs-enrol") throw new Error("Not allowed");
  return beginTotpEnrolment();
}

export async function enrolConfirmAction(_: Result | null, form: FormData): Promise<Result> {
  if ((await sessionState()) !== "needs-enrol") redirect("/login");
  if (!(await confirmTotpEnrolment(String(form.get("code") ?? "")))) return { ok: false, message: "Code didn't match — try the next one." };
  await markSessionMfa();
  redirect("/setup");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

// ---------- Secrets & settings ----------
export async function saveSecretAction(key: string, value: string): Promise<Result> {
  await guard();
  if (!(key in SECRET_DEFS) || (SECRET_DEFS as any)[key].internal) return { ok: false, message: "Unknown secret" };
  if (!value.trim()) return { ok: false, message: "Value is empty" };
  await setSecret(key as SecretKey, value);
  await logActivity({ sectorId: "pa", message: `Credential updated: ${SECRET_DEFS[key as SecretKey].label}` });
  revalidatePath("/setup");
  return { ok: true, message: "Saved (encrypted)" };
}

export async function deleteSecretAction(key: string): Promise<Result> {
  await guard();
  if (!(key in SECRET_DEFS)) return { ok: false, message: "Unknown secret" };
  await deleteSecret(key as SecretKey);
  revalidatePath("/setup");
  return { ok: true, message: "Removed" };
}

export async function saveSettingAction(key: string, value: unknown): Promise<Result> {
  await guard();
  if (!(key in SETTING_DEFAULTS)) return { ok: false, message: "Unknown setting" };
  const def = (SETTING_DEFAULTS as any)[key];
  if (typeof def === "number") value = Number(value);
  if (typeof def === "boolean") value = Boolean(value);
  if (typeof def === "number" && !Number.isFinite(value as number)) return { ok: false, message: "Must be a number" };
  await setSetting(key as SettingKey, value as any);
  // Schedules may depend on settings (e.g. briefing time), so let the worker re-sync.
  await sendCommand("registry.sync");
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved" };
}

export async function testAnthropicAction(): Promise<Result> {
  await guard();
  try { return { ok: true, message: `Anthropic replied: "${await testAnthropic()}"` }; }
  catch (e) { return { ok: false, message: (e as Error).message }; }
}

export async function telegramPairAction(): Promise<Result> {
  await guard();
  const token = await getSecret("telegram_bot_token");
  if (!token) return { ok: false, message: "Save the bot token first." };
  const username = await botUsername(token);
  if (!username) return { ok: false, message: "Telegram rejected that token. Check it with @BotFather." };
  const code = randomToken(6).replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  await q(
    `INSERT INTO agent_state (agent_id, key, value) VALUES ('system', 'telegram_pair', $1)
     ON CONFLICT (agent_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ code, expires: Date.now() + 15 * 60_000 })],
  );
  return { ok: true, data: { code, username, link: `https://t.me/${username}?start=${code}` } };
}

export async function testTelegramAction(): Promise<Result> {
  await guard();
  const ok = await sendTelegram("👋 Test message from Bilal OS. Telegram is working.").catch((e) => { throw e; });
  return ok ? { ok: true, message: "Sent — check Telegram." } : { ok: false, message: "Telegram isn't linked yet." };
}

// ---------- Agents ----------
export async function toggleAgentAction(id: string, enabled: boolean): Promise<Result> {
  await guard();
  await q("UPDATE agents SET enabled = $2 WHERE id = $1", [id, enabled]);
  await logActivity({ agentId: id, sectorId: getAgent(id)?.sector, message: `Agent ${enabled ? "switched on" : "switched off"}` });
  await sendCommand("registry.sync");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function runAgentAction(id: string): Promise<Result> {
  await guard();
  if (!getAgent(id)) return { ok: false, message: "Unknown agent" };
  await sendCommand("agent.run", { agentId: id, trigger: "manual" });
  return { ok: true, message: "Queued — refresh in a moment to see the result." };
}

export async function saveAgentConfigAction(id: string, key: string, value: unknown): Promise<Result> {
  await guard();
  const def = getAgent(id)?.settings?.find((s) => s.key === key);
  if (!def) return { ok: false, message: "Unknown setting" };
  const v = def.type === "number" ? Number(value) : def.type === "boolean" ? Boolean(value) : String(value);
  await q("UPDATE agents SET config = config || jsonb_build_object($2::text, $3::jsonb) WHERE id = $1", [id, key, JSON.stringify(v)]);
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved" };
}

// ---------- Alerts, approvals, sectors, tasks ----------
export async function readAlertAction(id: number): Promise<Result> {
  await guard();
  await markAlertRead(id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function readAllAlertsAction(sectorId?: string): Promise<Result> {
  await guard();
  await q(`UPDATE alerts SET read_at = now() WHERE read_at IS NULL ${sectorId ? "AND sector_id = $1" : ""}`, sectorId ? [sectorId] : []);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function decideApprovalAction(id: number, decision: "approve" | "reject", note?: string): Promise<Result> {
  await guard();
  const r = await decideApproval(id, decision, note);
  revalidatePath("/", "layout");
  return r ? { ok: true, message: decision === "approve" ? "Approved — the agent will carry it out." : "Rejected" } : { ok: false, message: "Already decided" };
}

export async function addSectorAction(_: Result | null, form: FormData): Promise<Result> {
  await guard();
  const name = String(form.get("name") ?? "").trim();
  const icon = String(form.get("icon") ?? "").trim() || "◆";
  if (!name) return { ok: false, message: "Give it a name" };
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  if (!id) return { ok: false, message: "Name needs letters or numbers" };
  if (await one("SELECT 1 FROM sectors WHERE id = $1", [id])) return { ok: false, message: "A sector with that name exists" };
  await q("INSERT INTO sectors (id, name, icon, builtin, sort) VALUES ($1,$2,$3,false,200)", [id, name, icon]);
  revalidatePath("/", "layout");
  return { ok: true, message: `Created ${name}. Ask Claude Code to add agents to sector id "${id}".` };
}

export async function deleteSectorAction(id: string): Promise<Result> {
  await guard();
  await q("DELETE FROM sectors WHERE id = $1 AND builtin = false AND NOT EXISTS (SELECT 1 FROM agents WHERE sector_id = $1 AND registered)", [id]);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function addTaskAction(_: Result | null, form: FormData): Promise<Result> {
  await guard();
  const title = String(form.get("title") ?? "").trim();
  if (!title) return { ok: false, message: "Add a title" };
  const whenText = String(form.get("when") ?? "").trim();
  const when = whenText ? parseWhen(whenText) : null;
  if (whenText && !when) return { ok: false, message: `Couldn't understand "${whenText}". Try "tomorrow 9am" or "fri 14:00".` };
  await q("INSERT INTO tasks (title, due_at, remind_at, source) VALUES ($1, $2, $2, 'dashboard')", [title, when]);
  revalidatePath("/");
  return { ok: true, message: "Added" };
}

export async function completeTaskAction(id: number): Promise<Result> {
  await guard();
  await q("UPDATE tasks SET done_at = now() WHERE id = $1", [id]);
  revalidatePath("/");
  return { ok: true };
}

export async function completeDeadlineAction(id: number): Promise<Result> {
  await guard();
  await q("UPDATE deadlines SET done = true WHERE id = $1", [id]);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signOutEverywhereAction(): Promise<Result> {
  await guard();
  await q("DELETE FROM sessions");
  redirect("/login");
}

// ---------- Uni ----------
export async function searchCourseAction(query: string, moduleCode?: string): Promise<Result> {
  await guard();
  if (query.trim().length < 3) return { ok: false, message: "Type a few more words" };
  const { searchCourse } = await import("@/agents/uni/indexer");
  const rows = await searchCourse(query.trim(), moduleCode || undefined, 8);
  return { ok: true, data: rows.map((r) => ({ ...r, content: r.content.slice(0, 600) })) };
}

export async function toggleModuleAction(code: string, active: boolean): Promise<Result> {
  await guard();
  await q("UPDATE modules SET active = $2 WHERE code = $1", [code, active]);
  revalidatePath("/sectors/uni");
  return { ok: true };
}

// ---------- Work experience ----------
const OPP_STATUSES = ["new", "shortlisted", "ignored", "drafting", "draft_ready", "applied", "interview", "offer", "rejected"];

export async function setOpportunityStatusAction(id: number, status: string): Promise<Result> {
  await guard();
  if (!OPP_STATUSES.includes(status)) return { ok: false, message: "Bad status" };
  await q("UPDATE opportunities SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
  if (status === "drafting") await sendCommand("agent.run", { agentId: "workexp.application-drafter", input: { opportunityId: id }, trigger: "manual" });
  if (["applied", "ignored", "rejected", "offer"].includes(status)) await q("UPDATE deadlines SET done = true WHERE source = 'opportunity' AND source_ref = $1", [String(id)]);
  revalidatePath("/sectors/workexp");
  return { ok: true, message: status === "drafting" ? "Drafting — it will appear in Approvals" : "Updated" };
}

export async function addOpportunityUrlAction(_: Result | null, form: FormData): Promise<Result> {
  await guard();
  const url = String(form.get("url") ?? "").trim();
  if (!/^https?:\/\//.test(url)) return { ok: false, message: "Paste a full link starting with https://" };
  await sendCommand("agent.run", { agentId: "workexp.opportunity-finder", input: { url }, trigger: "manual" });
  return { ok: true, message: "Reading that page — it'll appear here in a minute." };
}

export async function saveProfileAction(_: Result | null, form: FormData): Promise<Result> {
  await guard();
  await setSetting("workexp.profile", {
    summary: String(form.get("summary") ?? "").trim(),
    cvText: String(form.get("cvText") ?? "").trim(),
    targets: String(form.get("targets") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  });
  revalidatePath("/sectors/workexp");
  return { ok: true, message: "Profile saved" };
}

export async function saveSourcesAction(_: Result | null, form: FormData): Promise<Result> {
  await guard();
  try {
    const parsed = JSON.parse(String(form.get("sources") ?? "[]"));
    if (!Array.isArray(parsed) || !parsed.every((s) => s.id && s.name && /^https?:\/\//.test(s.url))) throw new Error("Each source needs id, name and url");
    await setSetting("workexp.sources", parsed.map((s) => ({ id: String(s.id), name: String(s.name), url: String(s.url), enabled: s.enabled !== false })));
    return { ok: true, message: "Sources saved" };
  } catch (e) {
    return { ok: false, message: `Not saved: ${(e as Error).message}` };
  }
}

export async function uploadCvAction(_: Result | null, form: FormData): Promise<Result> {
  await guard();
  const file = form.get("cv");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose a PDF" };
  if (file.size > 5 * 1024 * 1024 || !/pdf/i.test(file.type)) return { ok: false, message: "PDF under 5 MB please" };
  const { dataPath } = await import("@/lib/browser");
  const fsMod = await import("node:fs/promises");
  const buf = Buffer.from(await file.arrayBuffer());
  const p = dataPath("profile", "cv.pdf");
  await fsMod.writeFile(p, buf);
  // Also keep the text, so drafts can quote it.
  const { extractText } = await import("@/lib/extract");
  const text = (await extractText(p).catch(() => "")).replace(/\[page \d+\]\n?/g, "").trim();
  const { getSetting } = await import("@/lib/settings");
  const profile = await getSetting("workexp.profile");
  if (text) await setSetting("workexp.profile", { ...profile, cvText: text.slice(0, 20000) });
  revalidatePath("/sectors/workexp");
  return { ok: true, message: text ? "CV uploaded and text extracted" : "CV uploaded (couldn't read its text — paste it below)" };
}
