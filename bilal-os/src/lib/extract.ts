// Pull plain text out of course files: PDF, Word, PowerPoint, text/HTML.
import fs from "node:fs/promises";
import path from "node:path";

export async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const buf = await fs.readFile(filePath);
  if (ext === ".pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: false });
    return (text as string[]).map((t, i) => `[page ${i + 1}]\n${t}`).join("\n\n");
  }
  if (ext === ".docx" || ext === ".pptx") return officeText(buf, ext);
  if ([".txt", ".md", ".csv"].includes(ext)) return buf.toString("utf8");
  if ([".html", ".htm"].includes(ext)) return htmlToText(buf.toString("utf8"));
  return "";
}

async function officeText(buf: Buffer, ext: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const files = Object.keys(zip.files)
    .filter((f) => (ext === ".docx" ? /^word\/document\.xml$/.test(f) : /^ppt\/slides\/slide\d+\.xml$/.test(f)))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0));
  const parts: string[] = [];
  for (const f of files) {
    const xml = await zip.file(f)!.async("string");
    const paras = xml.split(/<\/a:p>|<\/w:p>/).map((p) => [...p.matchAll(/<(?:a|w):t[^>]*>([^<]*)<\/(?:a|w):t>/g)].map((m) => m[1]).join("")).filter(Boolean);
    const text = decodeXml(paras.join("\n"));
    parts.push(ext === ".pptx" ? `[slide ${f.match(/(\d+)\.xml$/)?.[1]}]\n${text}` : text);
  }
  return parts.join("\n\n");
}

export function htmlToText(html: string): string {
  return decodeXml(
    html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
}
