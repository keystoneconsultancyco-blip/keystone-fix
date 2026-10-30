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
