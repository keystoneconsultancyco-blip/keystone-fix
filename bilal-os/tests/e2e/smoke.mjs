import { chromium } from "playwright";
import { generate } from "otplib";
const base = process.env.BASE ?? "http://localhost:3100";
const out = process.env.OUT;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(base + "/login");
if (await page.locator("input[name=confirm]").count()) {
  await page.fill("input[name=password]", "test-password-123");
  await page.fill("input[name=confirm]", "test-password-123");
  await page.click("button.btn.primary");
} else {
  await page.fill("input[name=password]", "test-password-123");
  await page.click("button.btn.primary");
}
await page.waitForURL(/enrol|2fa/);
let secret = process.env.SECRET;
if (page.url().includes("enrol")) {
  secret = await page.locator("code").innerText();
  console.log("SECRET", secret);
}
await page.fill("input[name=code]", await generate({ secret }));
await page.click("button.btn.primary");
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
console.log("after login:", page.url());
for (const p of ["/", "/setup", "/settings", "/system", "/sectors/pa", "/sectors/pa?tab=agents", "/sectors/keystone?tab=settings", "/approvals", "/alerts", "/activity", "/sectors"]) {
  const r = await page.goto(base + p);
  const name = p.replace(/[^a-z0-9]+/gi, "_") || "home";
  await page.screenshot({ path: `${out}/desk${name}.png`, fullPage: true });
  console.log(p, r.status());
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/");
await page.screenshot({ path: `${out}/mobile_home.png`, fullPage: true });
await browser.close();
