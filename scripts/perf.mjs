#!/usr/bin/env node
// Measures real frame rate of the running dev server in headless Chrome
// with GPU rendering, after vehicles and trails have had time to build up.
//
//   node scripts/perf.mjs [url] [warmupSeconds]
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:5173";
const warmup = Number(process.argv[3] ?? 45);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.godmode?.fleet?.vehicles.size > 0, { timeout: 30_000 });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  await new Promise((r) => setTimeout(r, warmup * 1000));
  const result = await page.evaluate(async (zooms) => {
    const g = window.godmode;
    const measure = () => new Promise((resolve) => {
      const times = [];
      const tick = (t) => { times.push(t); if (times.length < 241) requestAnimationFrame(tick); else resolve(times); };
      requestAnimationFrame(tick);
    });
    const out = {};
    for (const [name, center, zoom] of zooms) {
      g.map.jumpTo({ center, zoom });
      await new Promise((r) => setTimeout(r, 3000));
      const t = await measure();
      const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
      out[name] = { fps: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1), p95ms: +d[Math.floor(d.length * 0.95)].toFixed(1) };
    }
    out.vehicles = g.fleet.vehicles.size;
    return out;
  }, [["metro", [-93.18, 44.96], 10.3], ["downtown", [-93.26, 44.974], 13.6], ["street", [-93.2745, 44.9765], 17]]);
  console.log(JSON.stringify({ renderer, ...result, errors }, null, 1));
} finally {
  await browser.close();
}
