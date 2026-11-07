'use strict';
// Timezone-safe helpers. All "local" times are computed with Intl in the client's
// IANA zone, never by adding a fixed offset. That was the root cause of the old
// send-window bug, which was off by the UTC offset.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function localParts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hourCycle: 'h23',
  });
  const p = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour, minute: +p.minute, second: +p.second,
    weekday: p.weekday.slice(0, 3).toLowerCase(),
    dateStr: `${p.year}-${p.month}-${p.day}`,
    timeStr: `${p.hour}:${p.minute}`,
  };
}

function toMinutes(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hhmm.trim())) return null;
  const [h, m] = hhmm.trim().split(':').map(Number);
  if (h > 24 || m > 59) return null;
  return h * 60 + m;
}

// Offset in minutes of tz at the given instant (local - UTC).
function tzOffsetMinutes(date, tz) {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// Convert a local wall-clock time in tz to a UTC Date (DST-safe).
function zonedToUtc(dateStr, hhmm, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const mins = toMinutes(hhmm);
  const guess = new Date(Date.UTC(y, mo - 1, d, Math.floor(mins / 60), mins % 60));
  const off1 = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(first, tz);
  return off1 === off2 ? first : new Date(guess.getTime() - off2 * 60000);
}

function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// Send window. If start/end are missing, the window is always open.
// Supports overnight windows, e.g. 20:00-06:00.
function inSendWindow(now, start, end, tz) {
  const s = toMinutes(start), e = toMinutes(end);
  if (s === null || e === null) return true;
  const p = localParts(now, tz);
  const cur = p.hour * 60 + p.minute;
  if (s === e) return true;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

// Next instant (UTC Date) when the send window opens.
function nextWindowOpen(now, start, end, tz) {
  if (inSendWindow(now, start, end, tz)) return now;
  const p = localParts(now, tz);
  const s = toMinutes(start);
  const cur = p.hour * 60 + p.minute;
  const day = cur < s ? p.dateStr : addDaysStr(p.dateStr, 1);
  return zonedToUtc(day, start, tz);
}

module.exports = { DAYS, localParts, toMinutes, tzOffsetMinutes, zonedToUtc, addDaysStr, weekdayOf, inSendWindow, nextWindowOpen };
