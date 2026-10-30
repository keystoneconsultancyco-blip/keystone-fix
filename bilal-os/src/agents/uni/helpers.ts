// Pure helpers for the Uni Tutor sector (unit-tested).

/** "EC1101_2026-27 Principles of Economics" → "EC1101". */
export function moduleCodeFrom(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = t && /(?<![A-Za-z0-9])([A-Z]{2,4}\s?\d{3,4}[A-Z]?)(?![A-Za-z0-9])/.exec(t);
    if (m) return m[1].replace(/\s/g, "");
  }
  return null;
}

/** "Week 3: Elasticity" → 3. Also handles "Wk 3", "W3", "Lecture 3". */
export function weekFrom(...texts: (string | null | undefined)[]): number | null {
  for (const t of texts) {
    const m = t && /\b(?:week|wk|w|teaching week)\s?(\d{1,2})\b/i.exec(t);
    if (m) return Number(m[1]);
  }
  return null;
}

export function kindFrom(name: string, section = ""): string {
  const s = `${name} ${section}`.toLowerCase();
  if (/assess|coursework|exam|essay|assignment|submission|mock|past paper/.test(s)) return "assessment";
  if (/seminar|tutorial|problem set|exercise|worksheet|workshop|class/.test(s)) return "seminar";
  if (/reading|chapter|article|paper|textbook/.test(s)) return "reading";
  if (/lecture|slides|lec\b|notes|handout/.test(s)) return "lecture";
  return "other";
}

export function safeName(s: string, max = 120): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, max) || "untitled";
}

/** Folder name for a section inside a module's Drive folder: "Week 03 — Elasticity" or the section title. */
export function sectionFolder(section: string | null, week: number | null): string {
  if (week !== null) return `Week ${String(week).padStart(2, "0")}${section && !/^\s*(week|wk)\s*\d+\s*$/i.test(section) ? ` — ${safeName(section.replace(/^(week|wk)\s*\d+\s*[:\-–—]?\s*/i, ""), 60)}` : ""}`;
  return safeName(section || "General", 80);
}
