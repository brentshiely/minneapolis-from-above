#!/usr/bin/env node
// End-to-end checks against the running app in headless Chrome (GPU).
//
//   node scripts/e2e.mjs [url]
//
// Exits non-zero if any check fails.
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:5173";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ ok: true, name, detail });
    console.log(`  ok  ${name}${detail ? ` (${detail})` : ""}`);
  } catch (err) {
    results.push({ ok: false, name });
    console.log(`FAIL  ${name}: ${err.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  defaultViewport: { width: 1280, height: 800 },
});

async function openApp({ reduced = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  // Count vehicle fetches, and let tests fake the page being hidden.
  await page.evaluateOnNewDocument(() => {
    window.__vehicleFetches = 0;
    const real = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).includes("/api/vehicles")) window.__vehicleFetches++;
      return real(input, init);
    };
    let hidden = false;
    Object.defineProperty(document, "visibilityState", { get: () => (hidden ? "hidden" : "visible") });
    window.__setHidden = (h) => { hidden = h; document.dispatchEvent(new Event("visibilitychange")); };
  });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.godmode?.fleet?.vehicles.size > 50, { timeout: 30_000 });
  return { page, errors };
}

try {
  const { page, errors } = await openApp();
  await sleep(3000);

  await check("vehicles load and fade in", async () => {
    const r = await page.evaluate(() => {
      const vs = window.godmode.fleet.list();
      return { n: vs.length, visible: vs.filter((v) => v.alpha > 0.99).length };
    });
    assert(r.n > 100, `only ${r.n} vehicles`);
    assert(r.visible / r.n > 0.95, `${r.visible}/${r.n} fully visible after 3 s`);
    return `${r.n} vehicles`;
  });

  await check("status line shows live counts", async () => {
    const text = await page.$eval("#status", (el) => el.textContent);
    assert(/^\d+ buses · \d+ trains · live from Metro Transit$/.test(text), `got "${text}"`);
    return text;
  });

  await check("status line warns when live data stalls", async () => {
    await page.evaluate(() => { window.godmode.feed.status.lastOk = performance.now() - 125_000; });
    await sleep(1300);
    const r = await page.$eval("#status", (el) => ({ text: el.textContent, stalled: el.classList.contains("stalled") }));
    assert(r.stalled && /paused 2 min ago/.test(r.text), `got "${r.text}"`);
    await page.evaluate(() => { window.godmode.feed.status.lastOk = performance.now(); });
    return r.text;
  });

  await check("polling stops while hidden and catches up on return", async () => {
    await page.evaluate(() => window.__setHidden(true));
    const before = await page.evaluate(() => window.__vehicleFetches);
    await sleep(32_000); // two poll intervals
    const during = await page.evaluate(() => window.__vehicleFetches);
    assert(during === before, `${during - before} fetches while hidden`);
    await page.evaluate(() => window.__setHidden(false));
    await sleep(500);
    const after = await page.evaluate(() => window.__vehicleFetches);
    assert(after === before + 1, `expected one immediate fetch on return, got ${after - before}`);
    return "0 fetches in 32 s hidden, 1 on return";
  });

  await check("vehicles unheard from for 2.5 minutes are half faded", async () => {
    const alpha = await page.evaluate(async () => {
      const f = window.godmode.fleet;
      f.update(f.feedTime - 150, [["e2e-stale", "", "21", 44.95, -93.2, f.feedTime - 150, null]], 0);
      await new Promise((r) => setTimeout(r, 200));
      const a = f.vehicles.get("e2e-stale").alpha;
      f.vehicles.delete("e2e-stale");
      return a;
    });
    assert(Math.abs(alpha - 0.5) < 0.05, `alpha ${alpha}`);
    return `alpha ${alpha.toFixed(2)}`;
  });

  await check("a teleport crossfades: ghost fades out, vehicle fades in", async () => {
    const r = await page.evaluate(async () => {
      const f = window.godmode.fleet;
      const v = f.list().find((x) => x.alpha === 1);
      const ghostsBefore = f.drawables().length - f.vehicles.size;
      const [lon, lat] = v.position;
      const now = performance.now() / 1000;
      f.update(f.feedTime, [[v.id, "", v.routeId, lat, lon + 0.1, v.fixTime + 30, null]], now); // ~8 km east
      const ghosts = f.drawables().length - f.vehicles.size - ghostsBefore;
      await new Promise((r) => setTimeout(r, 600));
      const mid = { vehicle: v.alpha, drawn: f.drawables().length };
      await new Promise((r) => setTimeout(r, 1000));
      return { ghosts, mid, after: { vehicle: v.alpha, ghostGone: !f.drawables().some((d) => d !== v && d.position === v.position) } };
    });
    assert(r.ghosts === 1, `expected 1 ghost, got ${r.ghosts}`);
    assert(r.mid.vehicle > 0.2 && r.mid.vehicle < 0.8, `vehicle alpha mid-fade ${r.mid.vehicle}`);
    assert(r.after.vehicle === 1, "fade-in didn't complete");
    return `mid-fade alpha ${r.mid.vehicle.toFixed(2)}`;
  });

  await check("no console errors", async () => {
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();

  const reduced = await openApp({ reduced: true });
  await sleep(2000);
  await check("reduced motion: no trails, vehicles sit at their latest fix", async () => {
    const r = await reduced.page.evaluate(() => {
      const g = window.godmode;
      const ids = g.overlay._props?.layers?.map((l) => l.id) ?? g.overlay._deck.props.layers.map((l) => l.id);
      const gliding = g.fleet.list().filter((v) => v.motion.onShape && v.motion.dist !== v.motion.target).length;
      return { trails: ids.filter((id) => id.startsWith("trails")).length, gliding };
    });
    assert(r.trails === 0, `${r.trails} trail layers`);
    assert(r.gliding === 0, `${r.gliding} vehicles mid-glide`);
    return "0 trail layers, 0 gliding";
  });
  await check("reduced motion: no console errors", async () => {
    assert(reduced.errors.length === 0, reduced.errors.join(" | "));
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
