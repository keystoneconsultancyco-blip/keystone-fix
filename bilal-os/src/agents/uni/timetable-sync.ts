import type { AgentDefinition } from "@/lib/agent/types";
import { q } from "@/lib/db";
import { parseIcs } from "@/lib/ics";
import { setSetting } from "@/lib/settings";
import { isGoogleConnected } from "@/lib/google";
import { BROWSER_PROFILE, openMoodle } from "./moodle";

/**
 * Keeps the uni timetable in the dashboard (and optionally Google Calendar).
 * Best source is the personal iCal link from the RHUL timetable site; if it isn't
 * set, the agent logs in to the timetable site and looks for the link itself.
 */
export const timetableSync: AgentDefinition = {
  id: "uni.timetable-sync",
  sector: "uni",
  name: "Timetable sync",
  description: "Copies your RHUL timetable into the dashboard and your Google Calendar.",
  schedule: "30 5,12 * * *",
  permissions: ["browser", "secrets:moodle", "calendar", "telegram"],
  settings: [
    { key: "pushToGoogle", label: "Also add timetable to Google Calendar", type: "boolean", default: true },
  ],
  async run(ctx) {
    let icsUrl = (await ctx.setting("uni.timetableIcsUrl")).trim();
    if (!icsUrl) {
      icsUrl = (await discoverIcsUrl(ctx)) ?? "";
      if (!icsUrl) {
        await ctx.alert("important", "Timetable link needed",
          "I couldn't find your timetable's calendar (iCal) link automatically. On the RHUL timetable site, look for 'Subscribe', 'iCal' or 'Add to calendar', copy the link and paste it in Settings → Uni → Timetable iCal link.",
          { dedupeKey: "timetable-ics-missing" });
        return { summary: "No timetable iCal link yet", skipped: true };
      }
      await setSetting("uni.timetableIcsUrl", icsUrl);
      await ctx.log("Found and saved the timetable iCal link");
    }

    const res = await fetch(icsUrl.replace(/^webcal:/, "https:"), { headers: { "User-Agent": "BilalOS/1.0" } });
    if (!res.ok) throw new Error(`Timetable feed returned HTTP ${res.status}`);
    const events = parseIcs(await res.text()).filter((e) => e.end.getTime() > Date.now() - 7 * 86400_000);

    const ids: string[] = [];
    for (const e of events) {
      const id = `timetable:${e.uid}`;
      ids.push(id);
      await q(
        `INSERT INTO calendar_events (id, source, title, location, start_at, end_at, all_day, data, updated_at)
         VALUES ($1,'timetable',$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, location = EXCLUDED.location, start_at = EXCLUDED.start_at,
           end_at = EXCLUDED.end_at, all_day = EXCLUDED.all_day, data = calendar_events.data || EXCLUDED.data, updated_at = now()`,
        [id, e.summary, e.location, e.start, e.end, e.allDay, JSON.stringify({ description: e.description })],
      );
    }
    const removed = await q<{ id: string; data: any }>(
      "DELETE FROM calendar_events WHERE source = 'timetable' AND start_at > now() AND NOT (id = ANY($1::text[])) RETURNING id, data",
      [ids],
    );

    let pushed = 0;
    if ((await ctx.config<boolean>("pushToGoogle")) && (await isGoogleConnected())) pushed = await pushToGoogle(ctx, removed);
    return { summary: `${events.length} timetable events${removed.length ? `, ${removed.length} removed` : ""}${pushed ? `, ${pushed} sent to Google Calendar` : ""}` };
  },
};

async function discoverIcsUrl(ctx: Parameters<AgentDefinition["run"]>[0]): Promise<string | null> {
  const url = await ctx.setting("uni.timetableUrl");
  if (!url) return null;
  return ctx.browser(BROWSER_PROFILE, async (browser) => {
    // The timetable uses the same RHUL single sign-on as Moodle.
    const page = await openMoodle(ctx, browser, (await ctx.setting("uni.moodleUrl")).replace(/\/$/, "")).catch(() => browser.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);
    const find = () => page.evaluate(() => {
      const links = [...document.querySelectorAll<HTMLAnchorElement | HTMLInputElement>("a[href], input[value]")];
      for (const el of links) {
        const v = (el as HTMLAnchorElement).href || (el as HTMLInputElement).value || "";
        if (/^(webcal|https?):\/\/.*(\.ics|ical|icalendar|calendar\/feed)/i.test(v)) return v;
      }
      return null;
    });
    let found = await find();
    if (!found) {
      const btn = page.locator('a:has-text("Subscribe"), button:has-text("Subscribe"), a:has-text("iCal"), button:has-text("iCal"), a:has-text("Add to calendar"), button:has-text("Export")').first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(2000);
        found = await find();
      }
    }
    return found;
  });
}

async function pushToGoogle(ctx: Parameters<AgentDefinition["run"]>[0], removed: { id: string; data: any }[]): Promise<number> {
  const cal = await ctx.calendar();
  let n = 0;
  for (const r of removed) {
    if (r.data?.googleId) await cal.events.delete({ calendarId: "primary", eventId: r.data.googleId }).catch(() => {});
  }
  const rows = await q<{ id: string; title: string; location: string | null; start_at: Date; end_at: Date; data: any; updated_at: Date }>(
    "SELECT id, title, location, start_at, end_at, data, updated_at FROM calendar_events WHERE source = 'timetable' AND start_at > now() - interval '1 day' AND start_at < now() + interval '60 days'",
  );
  for (const r of rows) {
    const body = {
      summary: r.title, location: r.location ?? undefined,
      start: { dateTime: new Date(r.start_at).toISOString() }, end: { dateTime: new Date(r.end_at).toISOString() },
      colorId: "9",
      extendedProperties: { private: { bilalos: "timetable" } },
    };
    const sig = `${body.summary}|${body.location}|${body.start.dateTime}|${body.end.dateTime}`;
    if (r.data?.googleId && r.data?.googleSig === sig) continue;
    let googleId = r.data?.googleId as string | undefined;
    if (googleId) await cal.events.update({ calendarId: "primary", eventId: googleId, requestBody: body }).catch(async () => { googleId = undefined; });
    if (!googleId) googleId = (await cal.events.insert({ calendarId: "primary", requestBody: body })).data.id ?? undefined;
    await q("UPDATE calendar_events SET data = coalesce(data, '{}'::jsonb) || $2 WHERE id = $1", [r.id, JSON.stringify({ googleId, googleSig: sig })]);
    n++;
  }
  return n;
}
