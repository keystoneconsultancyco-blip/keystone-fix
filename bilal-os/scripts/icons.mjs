// Renders public/icon.svg to the PNG sizes phones need. Run once: node scripts/icons.mjs
import { chromium } from "playwright";
import fs from "node:fs";
const svg = fs.readFileSync("public/icon.svg", "utf8");
const browser = await chromium.launch();
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>body{margin:0}</style>${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}`);
  await page.screenshot({ path: `public/${name}` });
}
await browser.close();
