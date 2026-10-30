import fs from "node:fs";
import path from "node:path";
import type { AgentDefinition } from "@/lib/agent/types";
import { q, one } from "@/lib/db";
import { ensureFolder, isGoogleConnected, upsertDoc } from "@/lib/google";
import { fmtDateTime } from "@/lib/time";
import { env } from "@/lib/env";

// Word/PowerPoint are converted to Google Docs/Slides so the Claude app can read them.
const CONVERT: Record<string, string> = {
  ".docx": "application/vnd.google-apps.document",
  ".doc": "application/vnd.google-apps.document",
  ".pptx": "application/vnd.google-apps.presentation",
  ".ppt": "application/vnd.google-apps.presentation",
  ".html": "application/vnd.google-apps.document",
};
const MIME: Record<string, string> = {
  ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".html": "text/html",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".txt": "text/plain", ".csv": "text/csv",
};

export const HOW_TO_USE = `# How to use this folder with Claude

This folder is kept up to date automatically by Bilal OS. Every module has its own folder:

- **00 Module Guide** — a plain-English guide to the module, built from the lecture materials (updated weekly).
- **00 Index** — every file in the module, organised by week, with deadlines.
- **Week 01, Week 02, …** — slides, readings and seminar sheets for that week, straight from Moodle.
- **Assessments** — coursework briefs and submission pages.

## Good prompts to use in the Claude app

- "Using my Drive folder for EC1101, explain this week's lecture to me step by step, as if I didn't take A-level Maths."
- "Look at the Week 4 seminar sheet for EC1101 and walk me through question 2 with a worked example. Don't just give me the answer."
- "Quiz me on Week 3 of EC1102 — ask me one question at a time and tell me what I got wrong."
- "Read the coursework brief in Assessments and help me plan the essay structure. Check it against the marking criteria."
- "What are the five most important ideas in this module so far? Use the Module Guide."
`;

export const driveOrganiser: AgentDefinition = {
  id: "uni.drive-organiser",
  sector: "uni",
  name: "Drive organiser",
  description: "Files course materials into Google Drive by module and week, with an index per module, for tutoring in the Claude app.",
  schedule: "40 * * * *",
  permissions: ["drive"],
  quietWhenIdle: true,
  async run(ctx) {
    if (!(await isGoogleConnected())) return { summary: "Google not connected", skipped: true };
    const pending = await q<{ id: number; module_code: string; name: string; section: string | null; week: number | null; kind: string; local_path: string; drive_file_id: string | null }>(
      "SELECT id, module_code, name, section, week, kind, local_path, drive_file_id FROM course_files WHERE drive_synced_at IS NULL AND local_path IS NOT NULL ORDER BY module_code, week NULLS LAST LIMIT 200",
    );
    if (!pending.length) return { summary: "Drive up to date", skipped: true };
    const drive = await ctx.drive();
    const rootName = await ctx.setting("uni.driveRootName");
    const root = await ensureFolder(drive, rootName);
    await ctx.state.set("rootFolderId", root);

    // A how-to doc at the top level, written once.
    if (!(await ctx.state.get("howToDocId"))) {
      await ctx.state.set("howToDocId", await upsertDoc(drive, { name: "README — how to use with Claude", parentId: root, markdown: HOW_TO_USE }));
    }

    const folderCache = new Map<string, string>();
    const folderFor = async (parent: string, name: string) => {
      const k = `${parent}/${name}`;
      if (!folderCache.has(k)) folderCache.set(k, await ensureFolder(drive, name, parent));
      return folderCache.get(k)!;
    };

    const touched = new Set<string>();
    let uploaded = 0;
    for (const f of pending) {
      if (!fs.existsSync(f.local_path)) { await q("UPDATE course_files SET drive_synced_at = now() WHERE id = $1", [f.id]); continue; }
      const mod = await one<{ code: string; name: string; drive_folder_id: string | null }>("SELECT code, name, drive_folder_id FROM modules WHERE code = $1", [f.module_code]);
      if (!mod) continue;
      let modFolder = mod.drive_folder_id;
      if (!modFolder) {
        modFolder = await folderFor(root, `${mod.code} — ${mod.name}`);
        await q("UPDATE modules SET drive_folder_id = $2 WHERE code = $1", [mod.code, modFolder]);
      }
      const sub = f.kind === "assessment" && f.week === null ? "Assessments" : path.basename(path.dirname(f.local_path));
      const parent = await folderFor(modFolder, sub);
      const ext = path.extname(f.name).toLowerCase();
      const media = { mimeType: MIME[ext] ?? "application/octet-stream", body: fs.createReadStream(f.local_path) };
      const displayName = CONVERT[ext] ? f.name.replace(/\.[^.]+$/, "") : f.name;
      let id = f.drive_file_id;
      if (id) {
        try { await drive.files.update({ fileId: id, media, fields: "id" }); }
        catch { id = null; }
      }
      if (!id) {
        const res = await drive.files.create({ requestBody: { name: displayName, parents: [parent], mimeType: CONVERT[ext] }, media, fields: "id" });
        id = res.data.id!;
      }
      await q("UPDATE course_files SET drive_file_id = $2, drive_synced_at = now() WHERE id = $1", [f.id, id]);
      touched.add(mod.code);
      uploaded++;
    }

    for (const code of touched) await writeIndex(drive, code);
    return { summary: `Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"} across ${touched.size} module${touched.size === 1 ? "" : "s"}` };
  },
};

/** "00 Index" doc: every file in the module by week, plus deadlines. */
async function writeIndex(drive: Awaited<ReturnType<Parameters<AgentDefinition["run"]>[0]["drive"]>>, code: string) {
  const mod = await one<{ code: string; name: string; drive_folder_id: string }>("SELECT code, name, drive_folder_id FROM modules WHERE code = $1", [code]);
  if (!mod?.drive_folder_id) return;
  const files = await q<{ name: string; section: string | null; week: number | null; kind: string; drive_file_id: string | null }>(
    "SELECT name, section, week, kind, drive_file_id FROM course_files WHERE module_code = $1 ORDER BY week NULLS LAST, section, name",
    [code],
  );
  const deadlines = await q<{ title: string; due_at: Date }>("SELECT title, due_at FROM deadlines WHERE NOT done AND due_at > now() AND title LIKE $1 ORDER BY due_at", [`${code}%`]);
  const groups = new Map<string, typeof files>();
  for (const f of files) {
    const k = f.week !== null ? `Week ${f.week}` : f.section || "General";
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const lines = [`# ${mod.code} — ${mod.name}: index`, "", `_Updated ${fmtDateTime(new Date())} by Bilal OS._`, ""];
  if (deadlines.length) lines.push("## Upcoming deadlines", ...deadlines.map((d) => `- **${d.title}** — ${fmtDateTime(d.due_at)}`), "");
  for (const [k, fs_] of groups) {
    lines.push(`## ${k}`);
    for (const f of fs_) lines.push(`- ${f.drive_file_id ? `[${f.name}](https://drive.google.com/open?id=${f.drive_file_id})` : f.name} _(${f.kind})_`);
    lines.push("");
  }
  lines.push(`Dashboard: ${env.appUrl}/sectors/uni`);
  const stateRow = await one<{ value: string }>("SELECT value FROM agent_state WHERE agent_id = 'uni.drive-organiser' AND key = $1", [`index:${code}`]);
  const id = await upsertDoc(drive, { name: "00 Index", parentId: mod.drive_folder_id, markdown: lines.join("\n"), existingId: stateRow?.value ?? null });
  await q(
    `INSERT INTO agent_state (agent_id, key, value) VALUES ('uni.drive-organiser', $1, $2) ON CONFLICT (agent_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [`index:${code}`, JSON.stringify(id)],
  );
}
