// Local sentence embeddings (free, runs on the server). 384-dimensional vectors.
import path from "node:path";
import { env as appEnv } from "./env";

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIM = 384;

let extractor: Promise<any> | null = null;

async function getExtractor() {
  if (!extractor) {
    extractor = (async () => {
      const t = await import("@huggingface/transformers");
      t.env.cacheDir = path.join(appEnv.dataDir, "models");
      return t.pipeline("feature-extraction", EMBED_MODEL, { dtype: "fp32" } as any);
    })();
    extractor.catch(() => { extractor = null; });
  }
  return extractor;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const fe = await getExtractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16);
    const t = await fe(batch, { pooling: "mean", normalize: true });
    const data = t.data as Float32Array;
    for (let j = 0; j < batch.length; j++) out.push(Array.from(data.slice(j * EMBED_DIM, (j + 1) * EMBED_DIM)));
  }
  return out;
}

export function toPgVector(v: number[]): string {
  return `[${v.map((x) => x.toFixed(6)).join(",")}]`;
}

/** Split text into ~1,000-character chunks on paragraph/sentence boundaries with a little overlap. */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const window = clean.slice(start + size * 0.6, end);
      const para = window.lastIndexOf("\n\n");
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"));
      const cut = para >= 0 ? para : sentence;
      if (cut >= 0) end = start + Math.floor(size * 0.6) + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece.length > 40) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
