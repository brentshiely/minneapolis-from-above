#!/usr/bin/env node
// Retakes the screenshots in docs/screenshots/ (the ones the README shows)
// from the running dev server in headless Chrome.
//
//   npm run dev                                 (in another terminal)
//   node scripts/readme-shots.mjs [outDir]
//
// The two train shots follow whichever freight and Amtrak trains are on
// the map at the moment, with their hover cards open; the Amtrak one is
// skipped when no Amtrak train is near a line (they run a few times a day).
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? "docs/screenshots";
const base = process.env.URL ?? "http://localhost:5173";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WARMUP_S = Number(process.env.WARMUP ?? 25);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});

/** Open the app at a simulated time of day, once the buses are moving. */
async function open(at) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem("mfa-splash-seen", "1"); } catch { /* fine */ } }); // skip the welcome card
  await page.goto(`${base}/?at=${at}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.fromAbove?.fleet?.vehicles.size > 0, { timeout: 60_000 });
  await sleep(WARMUP_S);
  // No ambient tour wandering off mid-shot, and no radar: its blocky returns
  // read as a rendering glitch and hide the vehicles the shots are meant to show.
  await page.evaluate(() => {
    window.fromAbove.drift.idleS = 1e9; window.fromAbove.drift.wake();
    window.fromAbove.map.setLayoutProperty("radar", "visibility", "none");
  });
  return page;
}

async function shot(page, name, center, zoom) {
  await page.evaluate((c, z) => window.fromAbove.map.jumpTo({ center: c, zoom: z }), center, zoom);
  await sleep(3);
  const file = join(outDir, `${name}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 82 });
  console.log(file);
}

try {
  const day = await open("13:00");
  await shot(day, "metro-day", [-93.18, 44.96], 10.3);
  await shot(day, "downtown", [-93.265, 44.975], 13.2);

  // A freight train on the busiest line that has one, with its hover card.
  const freight = await day.evaluate(() => {
    const flow = window.fromAbove.rail.freight();
    const t = [...flow.shapes].sort((a, b) => b.line.trainsPerDay - a.line.trainsPerDay)[0];
    return t ? { id: t.id, head: t.path.at(-1) } : null;
  });
  if (freight) {
    await day.evaluate((f) => window.fromAbove.map.jumpTo({ center: f.head, zoom: 12.2 }), freight);
    await sleep(2);
    await day.evaluate((id) => {
      const fa = window.fromAbove;
      const t = fa.rail.freight().shapes.find((s) => s.id === id);
      const mid = fa.map.project(t.path[Math.floor(t.path.length / 2)]);
      fa.hover.pick(fa.overlay.pickObject({ x: mid.x, y: mid.y, radius: 8 }));
    }, freight.id);
    await sleep(1);
    const file = join(outDir, "freight-train.jpg");
    await day.screenshot({ path: file, type: "jpeg", quality: 82 });
    console.log(file);
  }

  const amtrak = await day.evaluate(() => {
    const t = window.fromAbove.rail.amtrak.trains.find((x) => x.onLine);
    return t ? { id: t.row.id, head: t.path.at(-1) } : null;
  });
  if (amtrak) {
    await day.evaluate((a) => window.fromAbove.map.jumpTo({ center: a.head, zoom: 12.2 }), amtrak);
    await sleep(2);
    await day.evaluate((id) => {
      const fa = window.fromAbove;
      const t = fa.rail.amtrak.trains.find((x) => x.row.id === id);
      const mid = fa.map.project(t.path[Math.floor(t.path.length / 2)]);
      fa.hover.pick(fa.overlay.pickObject({ x: mid.x, y: mid.y, radius: 8 }));
    }, amtrak.id);
    await sleep(1);
    const file = join(outDir, "amtrak-train.jpg");
    await day.screenshot({ path: file, type: "jpeg", quality: 82 });
    console.log(file);
  } else console.log("No Amtrak train near a line right now; skipped amtrak-train.jpg");
  await day.close();

  const night = await open("22:00");
  await shot(night, "metro-night", [-93.18, 44.96], 10.3);
  await shot(night, "downtown-night", [-93.265, 44.975], 13.2);
} finally {
  await browser.close();
}
