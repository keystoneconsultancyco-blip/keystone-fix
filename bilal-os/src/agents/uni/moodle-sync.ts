import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { AgentDefinition } from "@/lib/agent/types";
import { q, one } from "@/lib/db";
import { dataPath } from "@/lib/browser";
import { BROWSER_PROFILE, courseActivities, filesForActivity, listCourses, openMoodle, upcomingDeadlines } from "./moodle";
import { kindFrom, moduleCodeFrom, safeName, sectionFolder, weekFrom } from "./helpers";

const MAX_FILE_BYTES = 80 * 1024 * 1024;
const SKIP_EXT = /\.(mp4|mov|avi|mkv|mp3|wav|zip|rar|7z|exe|dmg|iso)$/i;

/**
 * Logs in to Moodle, downloads new/changed course files, saves activity pages
 * and assignment briefs, and records assignment deadlines.
 */
export const moodleSync: AgentDefinition = {
  id: "uni.moodle-sync",
  sector: "uni",
  name: "Moodle sync",
  description: "Downloads new lecture slides, readings and assignment briefs from Moodle and records due dates.",
  schedule: "15 6,13,19 * * *",
  permissions: ["browser", "secrets:moodle", "telegram"],
  timeoutSeconds: 1800,
  retries: 1,
  settings: [
    { key: "ignoreCourses", label: "Ignore courses containing (comma-separated)", type: "string", default: "Induction,Skills,Library,Careers", help: "Courses on Moodle whose names contain these words are skipped." },
  ],
  async run(ctx) {
    const base = (await ctx.setting("uni.moodleUrl")).replace(/\/$/, "");
    const ignore = String(await ctx.config("ignoreCourses")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    let newFiles = 0, updated = 0, newDeadlines = 0, courses = 0;

    await ctx.browser(BROWSER_PROFILE, async (browser) => {
      const page = await openMoodle(ctx, browser, base);
      const list = (await listCourses(page, base)).filter((c) => !ignore.some((w) => c.fullname.toLowerCase().includes(w)));
      await ctx.log(`Logged in to Moodle, ${list.length} current courses`);

      for (const c of list) {
        const code = moduleCodeFrom(c.shortname, c.fullname) ?? `C${c.id}`;
        const name = c.fullname.replace(code, "").replace(/^[\s_\-–—:]+/, "").replace(/_?\d{4}-\d{2,4}/, "").trim() || c.fullname;
        await q(
          `INSERT INTO modules (code, name, moodle_course_id, moodle_url) VALUES ($1,$2,$3,$4)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, moodle_course_id = EXCLUDED.moodle_course_id, moodle_url = EXCLUDED.moodle_url`,
          [code, name, String(c.id), c.viewurl],
        );
        const mod = await one<{ active: boolean }>("SELECT active FROM modules WHERE code = $1", [code]);
        if (!mod?.active) continue;
        courses++;

        const acts = await courseActivities(page, base, c.id);
        for (const act of acts) {
          if (!["resource", "folder", "page", "assign"].includes(act.modtype)) continue;
          const week = weekFrom(act.section, act.name);
          const folder = sectionFolder(act.section, week);
          let res: Awaited<ReturnType<typeof filesForActivity>>;
          try { res = await filesForActivity(page, act); }
          catch (e) { await ctx.log(`Skipped ${act.name}: ${(e as Error).message}`, undefined, "warn"); continue; }

          if (res.html && res.html.length > 200) {
            const fname = `${safeName(act.name)}.html`;
            const r = await saveFile({ code, folder, fname, sourceKey: `moodle:cm:${act.cmid}:page`, remoteUrl: act.url, body: Buffer.from(res.html), act, week });
            if (r === "new") newFiles++; else if (r === "updated") updated++;
          }
          for (const f of res.files) {
            if (SKIP_EXT.test(f.filename)) continue;
            const key = `moodle:cm:${act.cmid}:${f.filename}`;
            const existing = await one<{ remote_url: string | null }>("SELECT remote_url FROM course_files WHERE source_url = $1", [key]);
            if (existing?.remote_url === f.url) continue; // unchanged since last time
            const resp = await page.context().request.get(f.url, { timeout: 120_000 });
            if (!resp.ok()) { await ctx.log(`Download failed (${resp.status()}): ${f.filename}`, undefined, "warn"); continue; }
            const body = await resp.body();
            if (body.length > MAX_FILE_BYTES) continue;
            const r = await saveFile({ code, folder, fname: safeName(f.filename), sourceKey: key, remoteUrl: f.url, body, act, week, mime: resp.headers()["content-type"] });
            if (r === "new") newFiles++; else if (r === "updated") updated++;
          }
        }
      }

      // Assignment and quiz deadlines.
      for (const ev of await upcomingDeadlines(page, base)) {
        const code = moduleCodeFrom(ev.course?.shortname, ev.course?.fullname);
        const title = `${code ? `${code}: ` : ""}${ev.name.replace(/ (is due|closes|opens)$/i, "")}`;
        const row = await one<{ inserted: boolean }>(
          `INSERT INTO deadlines (title, due_at, sector_id, source, source_ref, url, detail)
           VALUES ($1, to_timestamp($2), 'uni', 'moodle', $3, $4, $5)
           ON CONFLICT (source, source_ref) DO UPDATE SET title = EXCLUDED.title, due_at = EXCLUDED.due_at, url = EXCLUDED.url
           RETURNING (xmax = 0) AS inserted`,
          [title, ev.timesort, String(ev.id), ev.url, ev.course?.fullname ?? null],
        );
        if (row?.inserted) {
          newDeadlines++;
          await ctx.alert("important", `New deadline: ${title}`, `Due ${new Date(ev.timesort * 1000).toLocaleString("en-GB", { timeZone: "Europe/London" })}`, { url: ev.url, dedupeKey: `moodle-deadline-${ev.id}` });
        }
      }
    });

    if (newFiles || updated) await ctx.runAgent("uni.drive-organiser");
    if (newFiles || updated) await ctx.runAgent("uni.indexer");
    if (newFiles) await ctx.alert("info", `${newFiles} new file${newFiles > 1 ? "s" : ""} on Moodle`, "They're being organised into your Drive now.");
    return { summary: `${courses} modules · ${newFiles} new, ${updated} updated files · ${newDeadlines} new deadlines` };
  },
  async kpis() {
    const r = await one<{ modules: number; files: number; week: number }>(
      `SELECT (SELECT count(*)::int FROM modules WHERE active) AS modules, count(*)::int AS files,
              count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week FROM course_files`,
    );
    const d = await one<{ n: number }>("SELECT count(*)::int AS n FROM deadlines WHERE sector_id = 'uni' AND NOT done AND due_at > now()");
    return [
      { label: "Modules", value: r?.modules ?? 0 },
      { label: "Course files", value: r?.files ?? 0, hint: `${r?.week ?? 0} new this week` },
      { label: "Upcoming uni deadlines", value: d?.n ?? 0, tone: (d?.n ?? 0) > 0 ? "warn" : "good" },
    ];
  },
};

async function saveFile(o: {
  code: string; folder: string; fname: string; sourceKey: string; remoteUrl: string; body: Buffer;
  act: { name: string; section: string }; week: number | null; mime?: string;
}): Promise<"new" | "updated" | "same"> {
  const hash = crypto.createHash("sha256").update(o.body).digest("hex");
  const prev = await one<{ sha256: string | null }>("SELECT sha256 FROM course_files WHERE source_url = $1", [o.sourceKey]);
  if (prev?.sha256 === hash) {
    await q("UPDATE course_files SET remote_url = $2 WHERE source_url = $1", [o.sourceKey, o.remoteUrl]);
    return "same";
  }
  const local = dataPath("uni", safeName(o.code), safeName(o.folder), o.fname);
  await fs.writeFile(local, o.body);
  await q(
    `INSERT INTO course_files (module_code, source_url, remote_url, name, section, week, kind, mime, local_path, sha256, size_bytes, downloaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     ON CONFLICT (source_url) DO UPDATE SET remote_url = EXCLUDED.remote_url, name = EXCLUDED.name, section = EXCLUDED.section, week = EXCLUDED.week,
       kind = EXCLUDED.kind, mime = EXCLUDED.mime, local_path = EXCLUDED.local_path, sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes,
       downloaded_at = now(), drive_synced_at = NULL, indexed_at = NULL`,
    [o.code, o.sourceKey, o.remoteUrl, o.fname, o.act.section, o.week, kindFrom(o.fname, o.act.section), o.mime ?? null, local, hash, o.body.length],
  );
  return prev ? "updated" : "new";
}

