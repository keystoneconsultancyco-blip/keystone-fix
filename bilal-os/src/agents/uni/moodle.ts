// Moodle access through a real (headless) browser session.
// Handles the standard Moodle login form and Microsoft (Entra ID) single sign-on,
// including number-matching / code MFA by asking Bilal on Telegram.
import type { BrowserContext, Page } from "playwright";
import type { AgentContext } from "@/lib/agent/types";
import { q } from "@/lib/db";

export const BROWSER_PROFILE = "rhul";

export class LoginError extends Error {
  constructor(msg: string) { super(msg); this.name = "LoginError"; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function visible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false);
}

/** Wait for Bilal to send a 6-digit code on Telegram after `since`. */
async function waitForTelegramCode(since: Date, timeoutMs: number): Promise<string | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const rows = await q<{ text: string }>("SELECT text FROM telegram_messages WHERE direction = 'in' AND ts > $1 ORDER BY id DESC LIMIT 5", [since]);
    const code = rows.map((r) => r.text.replace(/\s/g, "")).find((t) => /^\d{6,8}$/.test(t));
    if (code) return code;
    await sleep(3000);
  }
  return null;
}

/** Complete a Microsoft sign-in page if we land on one. */
async function microsoftLogin(page: Page, ctx: AgentContext, username: string, password: string) {
  const deadline = Date.now() + 4 * 60_000;
  let mfaNotified = false;
  while (Date.now() < deadline) {
    const host = new URL(page.url()).host;
    if (!/login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com|adfs|sso|idp|shibboleth/i.test(host)) return;

    if (await visible(page, "input[name=loginfmt]")) {
      await page.fill("input[name=loginfmt]", username);
      await page.click("#idSIButton9, input[type=submit]");
      await sleep(2500);
      continue;
    }
    if (await visible(page, "input[name=passwd]")) {
      await page.fill("input[name=passwd]", password);
      await page.click("#idSIButton9, input[type=submit]");
      await sleep(3000);
      if (await visible(page, "#passwordError, #usernameError")) {
        throw new LoginError("Microsoft rejected the RHUL username or password. Update them on the Setup page.");
      }
      continue;
    }
    if (await visible(page, "#idRichContext_DisplaySign")) {
      if (!mfaNotified) {
        const num = (await page.locator("#idRichContext_DisplaySign").innerText()).trim();
        await ctx.alert("crucial", `Approve your RHUL sign-in: enter ${num} in Microsoft Authenticator`, "Bilal OS is logging in to Moodle. You have about 3 minutes.");
        mfaNotified = true;
      }
      await sleep(4000);
      continue;
    }
    if (await visible(page, "input[name=otc]")) {
      const asked = new Date();
      await ctx.alert("crucial", "RHUL sign-in needs your 6-digit code", "Reply to this chat with the code from your authenticator app (just the digits).");
      const code = await waitForTelegramCode(asked, 3 * 60_000);
      if (!code) throw new LoginError("No sign-in code received on Telegram in time.");
      await page.fill("input[name=otc]", code);
      await page.click("#idSubmit_SAOTCC_Continue, input[type=submit]");
      await sleep(3000);
      continue;
    }
    if (await visible(page, "#KmsiCheckboxField, #idBtn_Back")) {
      // "Stay signed in?" → Yes, so future runs rarely need MFA.
      await page.locator("#KmsiCheckboxField").check().catch(() => {});
      await page.click("#idSIButton9").catch(() => {});
      await sleep(2500);
      continue;
    }
    // Pick-an-account screen.
    if (await visible(page, "#tilesHolder .table, [data-test-id]")) {
      await page.locator("#tilesHolder .table, [data-test-id]").first().click().catch(() => {});
      await sleep(2000);
      continue;
    }
    await sleep(2000);
  }
  throw new LoginError("Timed out on the Microsoft sign-in page (MFA not approved?).");
}

function isMoodleLoggedIn(url: string, base: string): boolean {
  return url.startsWith(base) && !/\/login\/|\/auth\//.test(url);
}

/** Opens Moodle's dashboard, logging in if needed. Returns a page on the dashboard. */
export async function openMoodle(ctx: AgentContext, browser: BrowserContext, base: string): Promise<Page> {
  const username = await ctx.secret("moodle_username");
  const password = await ctx.secret("moodle_password");
  if (!username || !password) throw new LoginError("Add your RHUL username and password on the Setup page.");
  const page = await browser.newPage();
  await page.goto(`${base}/my/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  for (let attempt = 0; attempt < 3 && !isMoodleLoggedIn(page.url(), base); attempt++) {
    // Moodle login page: either a direct form or an SSO button.
    if (page.url().startsWith(base)) {
      const sso = page.locator('a[href*="auth/oauth2"], a[href*="auth/saml"], a[href*="auth/shibboleth"], a:has-text("Microsoft"), a:has-text("Single Sign"), a:has-text("Royal Holloway login")').first();
      if (await sso.isVisible().catch(() => false)) {
        await sso.click();
        await page.waitForLoadState("domcontentloaded");
      } else if (await visible(page, "#username")) {
        await page.fill("#username", username);
        await page.fill("#password", password);
        await page.click("#loginbtn, button[type=submit]");
        await page.waitForLoadState("domcontentloaded");
        if (await visible(page, ".loginerrors, #loginerrormessage, .alert-danger")) throw new LoginError("Moodle rejected the username or password.");
      }
    }
    await sleep(1500);
    await microsoftLogin(page, ctx, username, password);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    if (!page.url().startsWith(base)) await page.goto(`${base}/my/`, { waitUntil: "domcontentloaded" });
  }
  if (!isMoodleLoggedIn(page.url(), base)) throw new LoginError(`Couldn't get past the login page (ended on ${new URL(page.url()).host}).`);
  return page;
}

/** Call a Moodle AJAX web-service function using the logged-in session. */
export async function moodleAjax<T = any>(page: Page, base: string, methodname: string, args: Record<string, unknown>): Promise<T> {
  const res = await page.evaluate(
    async ({ base, methodname, args }) => {
      const sesskey = (window as any).M?.cfg?.sesskey;
      if (!sesskey) return { error: "No sesskey on page" };
      const r = await fetch(`${base}/lib/ajax/service.php?sesskey=${sesskey}&info=${methodname}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify([{ index: 0, methodname, args }]),
      });
      return r.json();
    },
    { base, methodname, args },
  );
  const first = Array.isArray(res) ? res[0] : res;
  if (first?.error) throw new Error(`Moodle ${methodname}: ${typeof first.exception === "object" ? first.exception.message : first.error}`);
  return first.data as T;
}

export interface MoodleCourse { id: number; fullname: string; shortname: string; viewurl: string }

export async function listCourses(page: Page, base: string): Promise<MoodleCourse[]> {
  const data = await moodleAjax<{ courses: MoodleCourse[] }>(page, base, "core_course_get_enrolled_courses_by_timeline_classification", {
    offset: 0, limit: 0, classification: "inprogress", sort: "fullname",
  });
  return data.courses;
}

export interface MoodleActivity { cmid: string; modtype: string; name: string; url: string; section: string }

/** Read the sections and activities on a course page. */
export async function courseActivities(page: Page, base: string, courseId: number): Promise<MoodleActivity[]> {
  await page.goto(`${base}/course/view.php?id=${courseId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  return page.evaluate(() => {
    const out: { cmid: string; modtype: string; name: string; url: string; section: string }[] = [];
    const sections = document.querySelectorAll("li.section, [data-for='section']");
    const scan = (root: Element | Document, sectionName: string) => {
      root.querySelectorAll("li.activity").forEach((li) => {
        const modtype = (li.className.match(/modtype_(\w+)/) || [])[1] || "";
        const a = li.querySelector<HTMLAnchorElement>("a.aalink, a[href*='/mod/']");
        if (!a) return;
        const nameEl = li.querySelector(".instancename") || a;
        const clone = nameEl.cloneNode(true) as Element;
        clone.querySelectorAll(".accesshide").forEach((x) => x.remove());
        const cmid = (li.id.match(/module-(\d+)/) || [])[1] || li.getAttribute("data-id") || new URL(a.href).searchParams.get("id") || a.href;
        out.push({ cmid, modtype, name: (clone.textContent || "").trim(), url: a.href, section: sectionName });
      });
    };
    if (sections.length) {
      sections.forEach((s) => {
        const title = s.querySelector("[data-for='section_title'], .sectionname, h3")?.textContent?.trim() || s.getAttribute("aria-label") || "General";
        scan(s, title);
      });
    } else scan(document, "General");
    // De-duplicate (nested section markup can list an activity twice).
    const seen = new Set<string>();
    return out.filter((x) => (seen.has(x.cmid) ? false : (seen.add(x.cmid), true)));
  });
}

export interface RemoteFile { url: string; filename: string }

/** Turn an activity into downloadable files (resource → 1 file, folder → many, page/assign → saved HTML). */
export async function filesForActivity(page: Page, act: MoodleActivity): Promise<{ files: RemoteFile[]; html?: string }> {
  if (act.modtype === "resource") {
    const url = act.url.includes("redirect=1") ? act.url : `${act.url}${act.url.includes("?") ? "&" : "?"}redirect=1`;
    const res = await page.context().request.get(url, { maxRedirects: 5 });
    const ctype = res.headers()["content-type"] ?? "";
    if (!ctype.includes("text/html")) return { files: [{ url: res.url(), filename: filenameFrom(res.url(), res.headers()["content-disposition"]) }] };
    const html = await res.text();
    const m = /href="([^"]*pluginfile\.php[^"]+)"/.exec(html);
    return { files: m ? [{ url: m[1].replace(/&amp;/g, "&"), filename: filenameFrom(m[1]) }] : [] };
  }
  if (act.modtype === "folder" || act.modtype === "page" || act.modtype === "assign") {
    await page.goto(act.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const data = await page.evaluate(() => {
      const links = [...document.querySelectorAll<HTMLAnchorElement>("#region-main a[href*='pluginfile.php']")].map((a) => a.href);
      const main = document.querySelector("#region-main .box.generalbox, #region-main .activity-description, #intro, #region-main [role='main']") as HTMLElement | null;
      const dates = document.querySelector("[data-region='activity-dates'], .activity-dates")?.textContent ?? "";
      return { links: [...new Set(links)], html: main ? `<h1>${document.title}</h1><p>${dates}</p>${main.innerHTML}` : "" };
    });
    return {
      files: data.links.filter((u) => !/forcedownload=1.*\.zip/.test(u)).map((u) => ({ url: u, filename: filenameFrom(u) })),
      html: act.modtype === "folder" ? undefined : data.html,
    };
  }
  return { files: [] };
}

export function filenameFrom(url: string, disposition?: string): string {
  const d = disposition && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (d) return decodeURIComponent(d[1]);
  const path = new URL(url).pathname;
  return decodeURIComponent(path.split("/").pop() || "file");
}

export interface MoodleDeadline { id: number; name: string; timesort: number; url: string; course: { id: number; fullname: string; shortname?: string } | null; modulename?: string }

/** Upcoming assignment/quiz due dates (the same data as Moodle's Timeline block). */
export async function upcomingDeadlines(page: Page, base: string): Promise<MoodleDeadline[]> {
  const now = Math.floor(Date.now() / 1000) - 86400;
  const data = await moodleAjax<{ events: MoodleDeadline[] }>(page, base, "core_calendar_get_action_events_by_timesort", {
    limitnum: 50, timesortfrom: now, timesortto: now + 120 * 86400, limittononsuspendedevents: true,
  });
  return data.events;
}
