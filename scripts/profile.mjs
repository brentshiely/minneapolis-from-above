#!/usr/bin/env node
// CPU-profiles the running app for six seconds at downtown zoom and prints
// self time by function, inclusive time for the deck.gl phases, and (with
// extra arguments) the call chains leading into the named functions.
//
//   node scripts/profile.mjs [url] [functionName ...]
import puppeteer from "puppeteer-core";
const url = process.argv[2] ?? "http://localhost:5173";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--window-size=1440,900"], defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 } });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.fromAbove?.fleet?.vehicles.size > 0, { timeout: 30000 });
await new Promise(r => setTimeout(r, 12000));
await page.evaluate(() => window.fromAbove.map.jumpTo({ center: [-93.26, 44.974], zoom: 13.6 }));
await new Promise(r => setTimeout(r, 3000));
const c = await page.createCDPSession();
await c.send("Profiler.enable"); await c.send("Profiler.setSamplingInterval", { interval: 200 });
await c.send("Profiler.start");
await new Promise(r => setTimeout(r, 6000));
const { profile } = await c.send("Profiler.stop");
const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
const dt = profile.timeDeltas; 
profile.samples.forEach((id, i) => { const n = byId.get(id); const cf = n.callFrame; const k = `${cf.functionName || "(anon)"} ${cf.url.split("/").slice(-2).join("/")}:${cf.lineNumber}`; self.set(k, (self.get(k) ?? 0) + dt[i]); });
const total = dt.reduce((a, b) => a + b, 0);
console.log("total ms", total / 1000);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log((v / 1000).toFixed(0).padStart(6), "ms", k);

const parent = new Map(); profile.nodes.forEach(n => (n.children ?? []).forEach(c => parent.set(c, n.id)));
const want = process.argv.slice(3);
{ const incl = new Map(); profile.samples.forEach((id, i) => { const seen = new Set(); let cur = id; while (cur) { const cf = byId.get(cur).callFrame; const k = cf.functionName || "(anon)"; if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dt[i]); } cur = parent.get(cur); } });
  for (const k of ["frame","setProps","_updateAttributes","_render","_drawLayers","_updateLayers","layerManager.setLayers","setLayers","_update","updateLayers","_matchSublayers","render","draw","onRender","renderLayer","_renderLayer","_shouldDrawLayer","tick","(anon)","fleet.advance","advance","drawables","vehicleLayers","trailLayers","pickLayers","hoverFrame","frame"]) if (incl.has(k)) console.log("incl", (incl.get(k)/1000).toFixed(0).padStart(6), k); }
for (const fn of want) {
  const chains = new Map();
  profile.samples.forEach((id, i) => { const n = byId.get(id); if (n.callFrame.functionName !== fn) return; const chain = []; let cur = id; for (let k = 0; k < 6 && cur; k++) { const cf = byId.get(cur).callFrame; chain.push(cf.functionName || "(anon)"); cur = parent.get(cur); } const key = chain.join(" < "); chains.set(key, (chains.get(key) ?? 0) + dt[i]); });
  console.log("== callers of", fn);
  for (const [k, v] of [...chains].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log((v / 1000).toFixed(0).padStart(5), k);
}
await browser.close();
