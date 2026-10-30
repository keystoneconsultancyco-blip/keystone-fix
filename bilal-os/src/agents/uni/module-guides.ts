import crypto from "node:crypto";
import type { AgentContext, AgentDefinition } from "@/lib/agent/types";
import { q, one } from "@/lib/db";
import { extractText } from "@/lib/extract";
import { ensureFolder, isGoogleConnected, upsertDoc } from "@/lib/google";
import { costStatus } from "@/lib/cost";
import { fmtDateTime } from "@/lib/time";
import { HOW_TO_USE } from "./drive-organiser";

const MAX_CHARS_PER_SECTION = 60_000; // ~15k tokens of source material per week

const TEACHER = `You write study guides for Bilal, a first-year BSc Economics student at Royal Holloway who did NOT take A-level Maths.
Rules:
- UK English. Plain, friendly language. Short paragraphs.
- Explain every idea step by step, from the ground up. Define each technical term the first time it appears.
- Whenever there is a formula, graph or calculation: say in words what it means, then give a fully worked numerical example with every arithmetic step shown, then a one-line intuition.
- Never skip algebra steps. Explain any symbol (Δ, Σ, subscripts, derivatives) in words the first time.
- Stick to what the lecture materials cover. If the materials are thin or unclear, say so rather than inventing content.
- Output GitHub-flavoured Markdown only (headings, lists, tables, bold). No preamble.`;

function sectionKey(week: number | null, section: string | null) {
  return week !== null ? `week-${String(week).padStart(2, "0")}` : `section-${(section ?? "general").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
}

export const moduleGuides: AgentDefinition = {
  id: "uni.module-guides",
  sector: "uni",
  name: "Module guide builder",
  description: "Writes a plain-English guide for each module (week-by-week explanations with worked examples) into Google Drive. Only rebuilds weeks with new material.",
  schedule: "0 17 * * 0",
  permissions: ["llm", "drive", "telegram"],
  timeoutSeconds: 3600,
  settings: [
    { key: "maxSectionsPerRun", label: "Max weeks to (re)write per run", type: "number", default: 6, help: "Keeps each run's AI cost predictable." },
  ],
  async run(ctx) {
    const modules = await q<{ code: string; name: string; drive_folder_id: string | null; guide_doc_id: string | null }>(
      "SELECT code, name, drive_folder_id, guide_doc_id FROM modules WHERE active ORDER BY code",
    );
    const maxSections = Number(await ctx.config("maxSectionsPerRun")) || 6;
    let written = 0;
    const changedModules: string[] = [];

    for (const m of modules) {
      const files = await q<{ id: number; name: string; section: string | null; week: number | null; kind: string; local_path: string; sha256: string }>(
        "SELECT id, name, section, week, kind, local_path, sha256 FROM course_files WHERE module_code = $1 AND local_path IS NOT NULL AND coalesce(text_chars, 1) > 0 ORDER BY week NULLS LAST, name",
        [m.code],
      );
      if (!files.length) continue;
      const groups = new Map<string, { title: string; files: typeof files }>();
      for (const f of files) {
        const key = sectionKey(f.week, f.section);
        const title = f.week !== null ? `Week ${f.week}${f.section && !/^week\s*\d+$/i.test(f.section) ? `: ${f.section.replace(/^week\s*\d+\s*[:\-–—]?\s*/i, "")}` : ""}` : f.section ?? "General";
        if (!groups.has(key)) groups.set(key, { title, files: [] });
        groups.get(key)!.files.push(f);
      }

      let moduleChanged = false;
      for (const [key, g] of groups) {
        if (written >= maxSections) break;
        const hash = crypto.createHash("sha256").update(g.files.map((f) => f.sha256).sort().join(",")).digest("hex");
        const existing = await one<{ source_hash: string }>("SELECT source_hash FROM module_guide_sections WHERE module_code = $1 AND section_key = $2", [m.code, key]);
        if (existing?.source_hash === hash) continue;
        if (!(await budgetAllows(0.6))) { await ctx.log("Stopping: not enough AI budget left this month for another guide section", undefined, "warn"); break; }

        const source = await gatherText(g.files);
        if (source.trim().length < 300) continue;
        const r = await ctx.llm({
          tier: "strong", system: TEACHER, maxTokens: 12000, purpose: `guide ${m.code} ${key}`,
          prompt: `Module: ${m.code} — ${m.name}\nSection: ${g.title}\n\nWrite the guide section for "${g.title}" using the lecture materials below. Structure:\n## ${g.title}\n### In one minute (3–5 bullet summary)\n### The ideas, step by step\n### Worked examples (numbers, every step shown)\n### Key terms (table: term | plain-English meaning)\n### Check yourself (4 short questions, answers at the end under "Answers")\n\nMaterials:\n${source}`,
        });
        await q(
          `INSERT INTO module_guide_sections (module_code, section_key, title, content, source_hash) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (module_code, section_key) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, source_hash = EXCLUDED.source_hash, updated_at = now()`,
          [m.code, key, g.title, r.text, hash],
        );
        written++;
        moduleChanged = true;
        await ctx.log(`Wrote guide section ${m.code} ${g.title} (£${r.costGbp.toFixed(3)})`);
      }

      if (moduleChanged || !m.guide_doc_id) {
        if (moduleChanged && (await budgetAllows(0.2))) await writeOverview(ctx, m.code, m.name);
        if (await publish(ctx, m)) changedModules.push(m.code);
      }
    }
    if (changedModules.length) {
      await ctx.alert("info", `Module guides updated: ${changedModules.join(", ")}`, "Open '00 Module Guide' in each module's Drive folder, or ask Claude to use it.");
    }
    return { summary: written ? `Wrote ${written} guide section${written > 1 ? "s" : ""}; updated ${changedModules.join(", ") || "no docs"}` : "All guides up to date", skipped: !written && !changedModules.length };
  },
  async kpis() {
    const r = await one<{ guides: number; sections: number }>("SELECT count(DISTINCT module_code)::int AS guides, count(*)::int AS sections FROM module_guide_sections");
    return [{ label: "Module guides", value: r?.guides ?? 0, hint: `${r?.sections ?? 0} sections written` }];
  },
};

async function budgetAllows(gbp: number) {
  const c = await costStatus();
  return c.cap - c.spent > gbp;
}

async function gatherText(files: { name: string; local_path: string; kind: string }[]): Promise<string> {
  // Lectures first, then seminars, readings, other — so the most useful material fits in the budget.
  const order = ["lecture", "seminar", "assessment", "reading", "other"];
  const sorted = [...files].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  let out = "";
  for (const f of sorted) {
    const text = await extractText(f.local_path).catch(() => "");
    if (!text.trim()) continue;
    const room = MAX_CHARS_PER_SECTION - out.length;
    if (room < 500) break;
    out += `\n\n===== FILE: ${f.name} (${f.kind}) =====\n${text.slice(0, room)}`;
  }
  return out;
}

async function writeOverview(ctx: AgentContext, code: string, name: string) {
  const sections = await q<{ title: string; content: string }>("SELECT title, content FROM module_guide_sections WHERE module_code = $1 AND section_key <> 'overview' ORDER BY section_key", [code]);
  const digest = sections.map((s) => `## ${s.title}\n${(s.content.split("###")[1] ?? s.content).slice(0, 1500)}`).join("\n\n");
  const deadlines = await q<{ title: string; due_at: Date }>("SELECT title, due_at FROM deadlines WHERE NOT done AND title LIKE $1 ORDER BY due_at", [`${code}%`]);
  const r = await ctx.llm({
    tier: "strong", system: TEACHER, maxTokens: 5000, purpose: `guide ${code} overview`,
    prompt: `Module: ${code} — ${name}\nWrite the opening of the module guide:\n## What this module is about (plain English, 1 paragraph)\n## The big picture so far (how the weeks connect, as a short numbered story)\n## Maths you need for this module (each tool explained from scratch with a tiny example)\n## Assessments and deadlines\n\nDeadlines: ${deadlines.map((d) => `${d.title} — ${fmtDateTime(d.due_at)}`).join("; ") || "none listed yet"}\n\nWeek summaries:\n${digest}`,
  });
  await q(
    `INSERT INTO module_guide_sections (module_code, section_key, title, content, source_hash) VALUES ($1,'overview','Overview',$2,'')
     ON CONFLICT (module_code, section_key) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [code, r.text],
  );
}

async function publish(ctx: AgentContext, m: { code: string; name: string; drive_folder_id: string | null; guide_doc_id: string | null }): Promise<boolean> {
  if (!(await isGoogleConnected())) return false;
  const sections = await q<{ section_key: string; content: string }>("SELECT section_key, content FROM module_guide_sections WHERE module_code = $1 ORDER BY (section_key = 'overview') DESC, section_key", [m.code]);
  if (!sections.length) return false;
  const drive = await ctx.drive();
  let folder = m.drive_folder_id;
  if (!folder) {
    const root = await ensureFolder(drive, await ctx.setting("uni.driveRootName"));
    folder = await ensureFolder(drive, `${m.code} — ${m.name}`, root);
    await q("UPDATE modules SET drive_folder_id = $2 WHERE code = $1", [m.code, folder]);
  }
  const md = [`# ${m.code} — ${m.name}: Module Guide`, `_Written by Bilal OS from your Moodle materials. Updated ${fmtDateTime(new Date())}._`, "", ...sections.map((s) => s.content), "", "---", HOW_TO_USE.replace(/^# /m, "## ")].join("\n\n");
  const id = await upsertDoc(drive, { name: "00 Module Guide", parentId: folder, markdown: md, existingId: m.guide_doc_id });
  await q("UPDATE modules SET guide_doc_id = $2, guide_updated_at = now() WHERE code = $1", [m.code, id]);
  return true;
}
