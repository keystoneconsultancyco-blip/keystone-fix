// Small iCalendar (.ics) parser — enough for university timetable feeds.
import { fromLondon } from "./time";

export interface IcsEvent {
  uid: string;
  summary: string;
  location: string | null;
  description: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");
}

/** DTSTART values: 20261030T090000Z (UTC), 20261030T090000 with TZID (treated as UK time), or 20261030 (all-day). */
export function parseIcsDate(value: string, params: string): { date: Date; allDay: boolean } {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) throw new Error(`Bad ICS date: ${value}`);
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return { date: new Date(Date.UTC(+y, +mo - 1, +d)), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))), allDay: false };
  // Floating or TZID time: university feeds are UK-based, so read as London time.
  void params;
  return { date: fromLondon(+y, +mo, +d, +h, +mi), allDay: false };
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: Record<string, { value: string; params: string }> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur?.DTSTART && cur.UID) {
        const s = parseIcsDate(cur.DTSTART.value, cur.DTSTART.params);
        const e = cur.DTEND ? parseIcsDate(cur.DTEND.value, cur.DTEND.params) : { date: new Date(s.date.getTime() + (s.allDay ? 86400_000 : 3600_000)) };
        if (cur.STATUS?.value !== "CANCELLED") {
          events.push({
            uid: cur.UID.value + (cur["RECURRENCE-ID"] ? `@${cur["RECURRENCE-ID"].value}` : ""),
            summary: unescape(cur.SUMMARY?.value ?? "(untitled)"),
            location: cur.LOCATION ? unescape(cur.LOCATION.value) : null,
            description: cur.DESCRIPTION ? unescape(cur.DESCRIPTION.value) : null,
            start: s.date, end: e.date, allDay: s.allDay,
          });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const [name, ...params] = line.slice(0, idx).split(";");
    cur[name.toUpperCase()] = { value: line.slice(idx + 1), params: params.join(";") };
  }
  return events;
}
