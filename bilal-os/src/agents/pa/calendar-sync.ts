import type { AgentDefinition } from "@/lib/agent/types";
import { q } from "@/lib/db";
import { isGoogleConnected } from "@/lib/google";

/** Copies the next 21 days of Google Calendar into the dashboard every 15 minutes. */
export const calendarSync: AgentDefinition = {
  id: "pa.calendar-sync",
  sector: "pa",
  name: "Calendar sync",
  description: "Pulls your Google Calendar into the dashboard every 15 minutes.",
  schedule: "*/15 * * * *",
  permissions: ["calendar"],
  quietWhenIdle: true,
  settings: [
    { key: "calendarIds", label: "Calendars to read (comma-separated IDs)", type: "string", default: "primary", help: "Usually just 'primary'. Find other IDs in Google Calendar → Settings → Integrate calendar." },
  ],
  async run(ctx) {
    if (!(await isGoogleConnected())) return { summary: "Google not connected", skipped: true };
    const cal = await ctx.calendar();
    const ids = String(await ctx.config("calendarIds")).split(",").map((s) => s.trim()).filter(Boolean);
    const timeMin = new Date(Date.now() - 86400_000);
    const timeMax = new Date(Date.now() + 21 * 86400_000);
    const seen: string[] = [];
    for (const calendarId of ids) {
      let pageToken: string | undefined;
      do {
        const res = await cal.events.list({ calendarId, timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 250, pageToken });
        for (const ev of res.data.items ?? []) {
          if (ev.status === "cancelled" || !ev.id) continue;
          // Skip events Bilal OS itself wrote from the uni timetable (they're stored separately).
          if (ev.extendedProperties?.private?.bilalos === "timetable") continue;
          const allDay = Boolean(ev.start?.date);
          const start = new Date(ev.start?.dateTime ?? `${ev.start?.date}T00:00:00Z`);
          const end = new Date(ev.end?.dateTime ?? `${ev.end?.date}T00:00:00Z`);
          const id = `google:${calendarId}:${ev.id}`;
          seen.push(id);
          await q(
            `INSERT INTO calendar_events (id, source, title, location, start_at, end_at, all_day, data, updated_at)
             VALUES ($1,'google',$2,$3,$4,$5,$6,$7, now())
             ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, location = EXCLUDED.location, start_at = EXCLUDED.start_at,
               end_at = EXCLUDED.end_at, all_day = EXCLUDED.all_day, data = EXCLUDED.data, updated_at = now()`,
            [id, ev.summary ?? "(no title)", ev.location ?? null, start, end, allDay, JSON.stringify({ htmlLink: ev.htmlLink, calendarId })],
          );
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    }
    // Remove events deleted in Google.
    const del = await q<{ id: string }>(
      "DELETE FROM calendar_events WHERE source = 'google' AND start_at >= $1 AND start_at <= $2 AND NOT (id = ANY($3::text[])) RETURNING id",
      [timeMin, timeMax, seen],
    );
    return { summary: `Synced ${seen.length} events${del.length ? `, removed ${del.length}` : ""}`, skipped: true };
  },
  async kpis() {
    const r = await q<{ n: number }>("SELECT count(*)::int AS n FROM calendar_events WHERE start_at > now() AND start_at < now() + interval '7 days'");
    return [{ label: "Events next 7 days", value: r[0].n }];
  },
};
