#!/usr/bin/env node
// Screenshots the running app in headless Chrome (GPU) at given views.
//
//   node scripts/shot.mjs <outDir> [warmupSeconds] [name:lon,lat,zoom ...]
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [outDir = ".cache/shots", warmupArg = "40", ...viewArgs] = process.argv.slice(2);
const url = process.env.URL ?? "http://localhost:5173";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const views = (viewArgs.length ? viewArgs : ["metro:-93.18,44.96,10.3"]).map((v) => {
  const [name, rest] = v.split(":");
  const [lon, lat, zoom] = rest.split(",").map(Number);
  return { name, center: [lon, lat], zoom };
});

mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.fromAbove?.fleet?.vehicles.size > 0, { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, Number(warmupArg) * 1000));
  for (const v of views) {
    await page.evaluate(({ center, zoom }) => window.fromAbove.map.jumpTo({ center, zoom }), v);
    await new Promise((r) => setTimeout(r, 3000));
    const file = join(outDir, `${v.name}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
} finally {
  await browser.close();
}
