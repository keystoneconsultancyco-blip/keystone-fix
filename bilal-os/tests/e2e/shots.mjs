// Logs in (using SECRET for TOTP) and screenshots the given pages. BASE, OUT, SECRET env vars.
import { chromium } from "playwright";
import { generate } from "otplib";
const base = process.env.BASE ?? "http://localhost:3101";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(process.env.W ?? 1280), height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", page.url(), e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", page.url(), m.text().slice(0, 200)); });
await page.goto(base + "/login");
await page.fill("input[name=password]", "test-password-123");
await page.click("button.btn.primary");
await page.waitForURL(/2fa/);
await page.fill("input[name=code]", await generate({ secret: process.env.SECRET }));
await page.click("button.btn.primary");
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
for (const p of process.argv.slice(2)) {
  const r = await page.goto(base + p);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${process.env.OUT}/${(process.env.W ?? "")}${p.replace(/[^a-z0-9]+/gi, "_")}.png`, fullPage: true });
  console.log(p, r.status());
}
await browser.close();
