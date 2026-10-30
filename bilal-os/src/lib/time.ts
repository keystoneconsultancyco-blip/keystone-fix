// Small date helpers that always work in UK time, regardless of server timezone.
export const TZ = "Europe/London";

/** Parts of a date as seen on a London wall clock. */
export function londonParts(d: Date = new Date()) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: p.weekday as string };
}

/** Offset of London from UTC in minutes at a given instant (0 in winter, 60 in summer). */
export function londonOffsetMinutes(d: Date): number {
  const p = londonParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** The instant a London wall-clock time occurs. */
export function fromLondon(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const off = londonOffsetMinutes(guess);
  const d = new Date(guess.getTime() - off * 60000);
  // Re-check across a DST boundary.
  const off2 = londonOffsetMinutes(d);
  return off2 === off ? d : new Date(guess.getTime() - off2 * 60000);
}

/** Start and end of a London calendar day (offset in days from today). */
export function londonDayBounds(offsetDays = 0, now = new Date()): { start: Date; end: Date } {
  const p = londonParts(now);
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + offsetDays));
  const start = fromLondon(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
  const nb = new Date(Date.UTC(p.year, p.month - 1, p.day + offsetDays + 1));
  const end = fromLondon(nb.getUTCFullYear(), nb.getUTCMonth() + 1, nb.getUTCDate());
  return { start, end };
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(d));
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return `${fmtDate(d)}, ${fmtTime(d)}`;
}

export function relative(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const ms = new Date(d).getTime() - now.getTime();
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  const str = mins < 1 ? "now" : mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  if (str === "now") return "just now";
  return ms >= 0 ? `in ${str}` : `${str} ago`;
}

/** Is "HH:MM" London time inside the quiet window [start, end) which may wrap midnight? */
export function inQuietHours(start: string, end: string, now = new Date()): boolean {
  const p = londonParts(now);
  const cur = p.hour * 60 + p.minute;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** Convert "HH:MM" to a daily cron expression. */
export function dailyCron(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${m} ${h} * * *`;
}
