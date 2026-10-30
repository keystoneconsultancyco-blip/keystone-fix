import type { AgentDefinition } from "@/lib/agent/types";
import { q, one, tx } from "@/lib/db";
import { extractText } from "@/lib/extract";
import { chunkText, embed, toPgVector } from "@/lib/embeddings";

/** Extracts text from course files and builds the local search index (free — no AI API calls). */
export const indexer: AgentDefinition = {
  id: "uni.indexer",
  sector: "uni",
  name: "Search indexer",
  description: "Reads your course files and builds a private search index (runs locally, costs nothing).",
  schedule: "20 2 * * *",
  permissions: [],
  timeoutSeconds: 3600,
  quietWhenIdle: true,
  async run(ctx) {
    const files = await q<{ id: number; module_code: string; name: string; local_path: string }>(
      "SELECT id, module_code, name, local_path FROM course_files WHERE indexed_at IS NULL AND local_path IS NOT NULL ORDER BY id LIMIT 100",
    );
    if (!files.length) return { summary: "Index up to date", skipped: true };
    let chunks = 0, failed = 0;
    for (const f of files) {
      try {
        const text = await extractText(f.local_path);
        const pieces = chunkText(text).slice(0, 400);
        const vectors = await embed(pieces.map((p) => `${f.name}\n${p}`));
        await tx(async (c) => {
          await c.query("DELETE FROM doc_chunks WHERE file_id = $1", [f.id]);
          for (let i = 0; i < pieces.length; i++) {
            await c.query("INSERT INTO doc_chunks (file_id, module_code, chunk_index, content, embedding) VALUES ($1,$2,$3,$4,$5::vector)", [f.id, f.module_code, i, pieces[i], toPgVector(vectors[i])]);
          }
          await c.query("UPDATE course_files SET indexed_at = now(), text_chars = $2 WHERE id = $1", [f.id, text.length]);
        });
        chunks += pieces.length;
      } catch (e) {
        failed++;
        await q("UPDATE course_files SET indexed_at = now(), text_chars = 0 WHERE id = $1", [f.id]);
        await ctx.log(`Couldn't read ${f.name}: ${(e as Error).message}`, undefined, "warn");
      }
    }
    const more = await one<{ n: number }>("SELECT count(*)::int AS n FROM course_files WHERE indexed_at IS NULL");
    if (more?.n) await ctx.runAgent("uni.indexer");
    return { summary: `Indexed ${files.length - failed} files (${chunks} passages)${failed ? `, ${failed} unreadable` : ""}` };
  },
};

/** Semantic search across course materials. */
export async function searchCourse(query: string, moduleCode?: string, limit = 8) {
  const [v] = await embed([query]);
  return q<{ content: string; name: string; module_code: string; week: number | null; drive_file_id: string | null; score: number }>(
    `SELECT c.content, f.name, c.module_code, f.week, f.drive_file_id, 1 - (c.embedding <=> $1::vector) AS score
     FROM doc_chunks c JOIN course_files f ON f.id = c.file_id
     ${moduleCode ? "WHERE c.module_code = $3" : ""}
     ORDER BY c.embedding <=> $1::vector LIMIT $2`,
    moduleCode ? [toPgVector(v), limit, moduleCode] : [toPgVector(v), limit],
  );
}
