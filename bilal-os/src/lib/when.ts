import { fromLondon, londonParts } from "./time";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Parse simple UK-style times without AI: "4pm", "16:30", "tomorrow 9am",
 * "fri 2pm", "in 2 hours", "in 30 mins", "31/10 09:00", "3 nov 10am",
 * "tonight", "this evening". Returns null if it can't be understood.
 */
export function parseWhen(input: string, now = new Date()): Date | null {
  let s = input.toLowerCase().trim().replace(/\s+/g, " ").replace(/^(at|on|by) /, "");
  if (!s) return null;

  const rel = /^in (\d+(?:\.\d+)?) ?(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2][0];
    const ms = unit === "m" ? n * 60_000 : unit === "h" ? n * 3600_000 : n * 86400_000;
    return new Date(now.getTime() + ms);
  }

  const p = londonParts(now);
  let y = p.year, mo = p.month, d = p.day;
  let dateGiven = false;
  let hour: number | null = null, minute = 0;

  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(s);
    if (m) { fn(m); s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim(); }
    return Boolean(m);
  };

  take(/\b(today|tonight|this evening|this afternoon|this morning)\b/, (m) => {
    dateGiven = true;
    if (m[1] === "tonight" || m[1] === "this evening") hour = 19;
    if (m[1] === "this afternoon") hour = 14;
    if (m[1] === "this morning") hour = 9;
  });
  take(/\btomorrow\b|\btmrw\b|\btmr\b/, () => { const t = addDays(y, mo, d, 1); [y, mo, d] = t; dateGiven = true; });
  take(/\b(next )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/, (m) => {
    const target = DAYS.indexOf(m[2]);
    const today = DAYS.indexOf(p.weekday.toLowerCase().slice(0, 3));
    let diff = (target - today + 7) % 7;
    if (diff === 0) diff = 7;
    if (m[1]) diff += diff < 7 ? 7 : 0;
    [y, mo, d] = addDays(y, mo, d, diff);
    dateGiven = true;
  });
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
    d = Number(m[1]); mo = Number(m[2]);
    if (m[3]) y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    dateGiven = true;
  });
  take(/\b(\d{1,2})(?:st|nd|rd|th)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/, (m) => {
    d = Number(m[1]); mo = MONTHS.indexOf(m[2]) + 1; dateGiven = true;
  });
  take(/\b(\d{1,2})(?:[:.](\d{2}))? ?(am|pm)\b/, (m) => {
    hour = Number(m[1]) % 12 + (m[3] === "pm" ? 12 : 0);
    minute = m[2] ? Number(m[2]) : 0;
  }) ||
    take(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/, (m) => { hour = Number(m[1]); minute = Number(m[2]); }) ||
    take(/\bnoon\b|\bmidday\b/, () => { hour = 12; }) ||
    take(/\bmorning\b/, () => { hour = 9; }) ||
    take(/\b(evening|night)\b/, () => { hour = 19; }) ||
    take(/\bafternoon\b/, () => { hour = 14; });

  if (s.replace(/[,]/g, "").trim()) return null; // leftover words we didn't understand
  if (hour === null && !dateGiven) return null;
  if (hour === null) hour = 9;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  let out = fromLondon(y, mo, d, hour, minute);
  if (!dateGiven && out.getTime() <= now.getTime()) {
    const t = addDays(y, mo, d, 1);
    out = fromLondon(t[0], t[1], t[2], hour, minute);
  } else if (dateGiven && out.getTime() < now.getTime() - 86400_000 && !/\d{4}/.test(input)) {
    out = fromLondon(y + 1, mo, d, hour, minute); // "3/1" in December means next year
  }
  return out;
}

function addDays(y: number, m: number, d: number, n: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}
