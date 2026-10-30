import { describe, it, expect, beforeAll } from "vitest";
import { parseWhen } from "@/lib/when";
import { fromLondon, inQuietHours, londonDayBounds } from "@/lib/time";
import { splitMessage } from "@/lib/telegram";
import { redact } from "@/lib/activity";

beforeAll(() => { process.env.MASTER_KEY = Buffer.alloc(32, 7).toString("base64"); });

describe("time", () => {
  it("handles BST and GMT", () => {
    expect(fromLondon(2026, 7, 1, 9, 0).toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(fromLondon(2026, 12, 1, 9, 0).toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
  it("quiet hours wrap midnight", () => {
    expect(inQuietHours("22:30", "07:30", new Date("2026-12-01T23:00:00Z"))).toBe(true);
    expect(inQuietHours("22:30", "07:30", new Date("2026-12-01T12:00:00Z"))).toBe(false);
  });
  it("day bounds are London days", () => {
    const { start } = londonDayBounds(0, new Date("2026-07-01T23:30:00Z"));
    expect(start.toISOString()).toBe("2026-07-01T23:00:00.000Z");
  });
});

describe("parseWhen", () => {
  const now = new Date("2026-10-30T10:00:00Z"); // Fri 30 Oct 2026, 10:00 GMT
  it("parses times", () => {
    expect(parseWhen("4pm", now)?.toISOString()).toBe("2026-10-30T16:00:00.000Z");
    expect(parseWhen("9am", now)?.toISOString()).toBe("2026-10-31T09:00:00.000Z"); // already passed → tomorrow
    expect(parseWhen("tomorrow 9:30am", now)?.toISOString()).toBe("2026-10-31T09:30:00.000Z");
    expect(parseWhen("mon 14:00", now)?.toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(parseWhen("in 2 hours", now)?.toISOString()).toBe("2026-10-30T12:00:00.000Z");
    expect(parseWhen("3 nov 10am", now)?.toISOString()).toBe("2026-11-03T10:00:00.000Z");
    expect(parseWhen("5/11 13:15", now)?.toISOString()).toBe("2026-11-05T13:15:00.000Z");
  });
  it("rejects junk", () => {
    expect(parseWhen("whenever really", now)).toBeNull();
  });
});

describe("crypto", () => {
  it("round-trips and detects tampering", async () => {
    const { encrypt, decrypt, hashPassword, verifyPassword } = await import("@/lib/crypto");
    const c = encrypt("secret-value");
    expect(c).not.toContain("secret-value");
    expect(decrypt(c)).toBe("secret-value");
    const parts = c.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(parts.join("."))).toThrow();
    const h = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});

describe("helpers", () => {
  it("splits long telegram messages", () => {
    const parts = splitMessage("a\n".repeat(5000), 3900);
    expect(parts.every((p) => p.length <= 3900)).toBe(true);
  });
  it("redacts secrets in logs", () => {
    const r = redact({ password: "x", nested: { apiKey: "y" }, note: "key sk-ant-abc123 here" });
    expect(JSON.stringify(r)).not.toMatch(/"x"|"y"|abc123/);
  });
});

describe("telegram quick parse", async () => {
  it("parses simple reminders without AI", async () => {
    const { quickParse } = await import("@/agents/pa/telegram-handlers");
    const r = quickParse("remind me to call mum at 4pm");
    expect(r?.title).toBe("call mum");
    expect(r?.when).toBeInstanceOf(Date);
    expect(quickParse("remind me to buy milk")).toEqual({ title: "buy milk", when: null });
    expect(quickParse("what's the weather")).toBeNull();
  });
});

describe("uni helpers", () => {
  it("parses ICS feeds", async () => {
    const { parseIcs } = await import("@/lib/ics");
    const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc\r\nSUMMARY:EC1101 Lecture\\, Microeconomics\r\nLOCATION:Windsor Building 0-03\r\nDTSTART;TZID=Europe/London:20261102T100000\r\nDTEND;TZID=Europe/London:20261102T110000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:def\r\nSUMMARY:Cancelled\r\nSTATUS:CANCELLED\r\nDTSTART:20261103T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const ev = parseIcs(ics);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toBe("EC1101 Lecture, Microeconomics");
    expect(ev[0].start.toISOString()).toBe("2026-11-02T10:00:00.000Z");
  });
  it("chunks text", async () => {
    const { chunkText } = await import("@/lib/embeddings");
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about elasticity of demand.`).join(" ");
    const chunks = chunkText(text, 500, 50);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 520)).toBe(true);
  });
});

describe("uni naming", async () => {
  const h = await import("@/agents/uni/helpers");
  it("finds module codes and weeks", () => {
    expect(h.moduleCodeFrom("EC1101_2026-27", "Principles")).toBe("EC1101");
    expect(h.moduleCodeFrom("Intro to Economics", "EC 1102 Macro")).toBe("EC1102");
    expect(h.weekFrom("Week 3: Elasticity")).toBe(3);
    expect(h.weekFrom("General")).toBeNull();
    expect(h.kindFrom("Lecture 3 slides.pdf")).toBe("lecture");
    expect(h.kindFrom("Problem set 2.pdf")).toBe("seminar");
    expect(h.sectionFolder("Week 3: Elasticity", 3)).toBe("Week 03 — Elasticity");
    expect(h.sectionFolder("Week 3", 3)).toBe("Week 03");
  });
});
