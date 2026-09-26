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

async function openApp({ reduced = false, query = "" } = {}) {
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
  await page.goto(url + query, { waitUntil: "load" });
  await page.waitForFunction(() => window.fromAbove?.fleet?.vehicles.size > 50, { timeout: 30_000 });
  return { page, errors };
}

try {
  const { page, errors } = await openApp();
  await sleep(3000);

  await check("vehicles load and fade in", async () => {
    const r = await page.evaluate(() => {
      const vs = window.fromAbove.fleet.list();
      return { n: vs.length, visible: vs.filter((v) => v.alpha > 0.99).length };
    });
    assert(r.n > 100, `only ${r.n} vehicles`);
    assert(r.visible / r.n > 0.95, `${r.visible}/${r.n} fully visible after 3 s`);
    return `${r.n} vehicles`;
  });

  await check("status line shows live counts", async () => {
    const text = await page.$eval("#status", (el) => el.textContent);
    assert(/^\d+ buses · \d+ trains · \d+ planes( · -?\d+°F, [a-z ]+ · (calm|([NESW]{1,2} )?wind \d+ mph(, gusting to \d+)?))? · live$/.test(text), `got "${text}"`);
    return text;
  });

  await check("status line warns when live data stalls", async () => {
    await page.evaluate(() => { window.fromAbove.feed.status.lastOk = performance.now() - 125_000; });
    await sleep(1300);
    const r = await page.$eval("#status", (el) => ({ text: el.textContent, stalled: el.classList.contains("stalled") }));
    assert(r.stalled && /paused 2 min ago/.test(r.text), `got "${r.text}"`);
    await page.evaluate(() => { window.fromAbove.feed.status.lastOk = performance.now(); });
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
      const f = window.fromAbove.fleet;
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
      const f = window.fromAbove.fleet;
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

  await check("planes are in the sky and moving continuously", async () => {
    const r = await page.evaluate(async () => {
      const air = window.fromAbove.air;
      const flying = () => [...air.planes.values()].filter((p) => !p.onGround && p.alpha > 0.9 && (p.speedKt ?? 0) > 80);
      const before = new Map(flying().map((p) => [p.id, [...p.position]]));
      await new Promise((r) => setTimeout(r, 1000));
      const moved = flying().filter((p) => { const b = before.get(p.id); return b && (b[0] !== p.position[0] || b[1] !== p.position[1]); });
      return { flying: before.size, moved: moved.length };
    });
    assert(r.flying > 0, "no planes airborne");
    assert(r.moved === r.flying, `${r.moved}/${r.flying} moved within 1 s`);
    return `${r.flying} flying, all moved within 1 s`;
  });

  // Point the real mouse at something and read the tooltip.
  async function hoverOn(pickFn) {
    const target = await page.evaluate(pickFn);
    if (!target) return null;
    await page.evaluate(({ center }) => window.fromAbove.map.jumpTo({ center, zoom: 13 }), target);
    await sleep(600);
    const pt = await page.evaluate((id, kind) => {
      const g = window.fromAbove;
      const o = kind === "plane" ? g.air.planes.get(id) : g.fleet.vehicles.get(id);
      const p = g.map.project(o.position);
      return { x: p.x, y: p.y };
    }, target.id, target.kind);
    await page.mouse.move(pt.x, pt.y);
    await sleep(2500); // flight lookups take a moment
    const tip = await page.$eval("#tip", (el) => ({ hidden: el.hidden, text: el.innerText }));
    await page.mouse.move(5, 5);
    await sleep(300);
    const after = await page.$eval("#tip", (el) => el.hidden);
    return { ...target, tip, hiddenAfter: after };
  }

  await check("hovering a bus shows its icon and a plain-language tooltip", async () => {
    const r = await hoverOn(() => {
      const v = window.fromAbove.fleet.list().find((x) => x.mode === "bus" && x.alpha === 1 && x.motion.onShape);
      return v && { id: v.id, kind: "vehicle", center: v.position };
    });
    assert(r, "no bus to hover");
    assert(!r.tip.hidden, "tooltip hidden");
    assert(/^Route \S+.* bus/.test(r.tip.text), `got "${r.tip.text}"`);
    assert(/Bus \S+ · updated/.test(r.tip.text), `got "${r.tip.text}"`);
    assert(r.hiddenAfter, "tooltip stayed after mouse left");
    return r.tip.text.replace(/\n/g, " | ");
  });

  await check("hovering a train names its line", async () => {
    const r = await hoverOn(() => {
      const v = window.fromAbove.fleet.list().find((x) => x.mode === "rail" && x.alpha === 1);
      return v && { id: v.id, kind: "vehicle", center: v.position };
    });
    if (!r) return "no trains running right now (skipped)";
    assert(/^METRO .+ train/.test(r.tip.text), `got "${r.tip.text}"`);
    return r.tip.text.replace(/\n/g, " | ");
  });

  await check("hovering a plane describes it in plain language", async () => {
    const r = await hoverOn(() => {
      // Only planes inside the map's pan limits can be centered on.
      const inView = ([lon, lat]) => lon > -94.0 && lon < -92.7 && lat > 44.65 && lat < 45.25;
      const planes = [...window.fromAbove.air.planes.values()].filter((p) => !p.onGround && p.alpha === 1 && inView(p.position));
      const p = planes.find((x) => /^[A-Z]{3}\d/.test(x.callsign)) ?? planes[0];
      return p && { id: p.id, kind: "plane", center: p.position };
    });
    assert(r, "no plane to hover");
    assert(!r.tip.hidden, "tooltip hidden");
    const title = r.tip.text.split("\n")[0];
    assert(/^(.+ flight \d+|An? .+)[^.]*\.$/.test(title), `got "${title}"`);
    assert(/(climbing|descending|cruising|flying|taxiing|ground)/i.test(r.tip.text), `got "${r.tip.text}"`);
    return r.tip.text.replace(/\n/g, " | ");
  });

  await check("tapping pins the tooltip until tapping elsewhere", async () => {
    const t = await page.evaluate(() => {
      const v = window.fromAbove.fleet.list().find((x) => x.alpha === 1);
      window.fromAbove.map.jumpTo({ center: v.position, zoom: 13 });
      return v.id;
    });
    await sleep(500);
    const pt = await page.evaluate((id) => { const g = window.fromAbove; const p = g.map.project(g.fleet.vehicles.get(id).position); return { x: p.x, y: p.y }; }, t);
    await page.mouse.click(pt.x, pt.y);
    await page.mouse.move(pt.x + 200, pt.y + 200);
    await sleep(400);
    const pinned = await page.$eval("#tip", (el) => !el.hidden);
    await page.mouse.click(pt.x + 200, pt.y + 200);
    await sleep(300);
    const cleared = await page.$eval("#tip", (el) => el.hidden);
    assert(pinned, "tooltip not pinned after tap");
    assert(cleared, "tooltip not cleared by tapping elsewhere");
  });

  await check("no console errors", async () => {
    assert(errors.length === 0, errors.join(" | "));
  });
  await page.close();

  {
    const idle = await openApp({ query: "?idle=3" });
    await check("after sitting idle, the camera drifts and captions the view", async () => {
      const start = await idle.page.evaluate(() => window.fromAbove.map.getCenter().toArray());
      await sleep(6000);
      const r = await idle.page.evaluate(() => ({
        drifting: window.fromAbove.drift.drifting,
        center: window.fromAbove.map.getCenter().toArray(),
        caption: document.getElementById("caption").textContent,
        shown: document.getElementById("caption").classList.contains("shown"),
      }));
      assert(r.drifting, "not drifting");
      assert(r.center[0] !== start[0] || r.center[1] !== start[1], "camera didn't move");
      assert(r.shown && r.caption.length > 0, "no caption");
      return r.caption;
    });
    await check("moving the mouse stops the drift at once", async () => {
      await idle.page.mouse.move(400, 300);
      await idle.page.mouse.move(420, 320);
      await sleep(200);
      const a = await idle.page.evaluate(() => ({
        drifting: window.fromAbove.drift.drifting,
        moving: window.fromAbove.map.isMoving(),
        center: window.fromAbove.map.getCenter().toArray(),
        shown: document.getElementById("caption").classList.contains("shown"),
      }));
      await sleep(1000);
      const b = await idle.page.evaluate(() => window.fromAbove.map.getCenter().toArray());
      assert(!a.drifting && !a.moving, "still drifting");
      assert(!a.shown, "caption still shown");
      assert(a.center[0] === b[0] && a.center[1] === b[1], "camera kept moving");
    });
    await check("drifting: no console errors", async () => {
      assert(idle.errors.length === 0, idle.errors.join(" | "));
    });
    await idle.page.close();
  }

  {
    const snow = await openApp({ query: "?weather=heavy-snow" });
    await sleep(1500);
    await check("heavy snow falls, and the status line says so", async () => {
      const r = await snow.page.evaluate(() => {
        const c = document.getElementById("fx");
        const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let lit = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
        return { lit, status: document.getElementById("status").textContent };
      });
      assert(r.lit > 1000, `only ${r.lit} snow pixels`);
      assert(/heavy snow/.test(r.status), `status "${r.status}"`);
      return `${r.lit} snow pixels`;
    });
    await snow.page.close();

    const breeze = await openApp({ query: "?weather=breezy" });
    await sleep(1500);
    await check("wind threads drift the way the wind blows, at a pace proportional to it", async () => {
      const r = await breeze.page.evaluate(async () => {
        const fx = window.fromAbove.fx;
        const snap = () => new Map(fx.threads.map((t) => [t, [t.x, t.y, t.age]]));
        const a = snap();
        await new Promise((r) => setTimeout(r, 1000));
        let vx = 0, vy = 0, n = 0;
        for (const t of fx.threads) {
          const p = a.get(t);
          if (!p || t.age < p[2]) continue; // respawned meanwhile
          vx += t.x - p[0]; vy += t.y - p[1]; n++;
        }
        return { vx: vx / n, vy: vy / n, n, wind: fx.current.wind, toward: fx.current.windToward, mph: fx.current.windMph };
      });
      // Breezy preview: NW wind 12 mph, blowing toward the southeast (135°): down and right on screen.
      const angle = (Math.atan2(r.vx, -r.vy) * 180 / Math.PI + 360) % 360;
      const speed = Math.hypot(r.vx, r.vy);
      assert(r.n > 10, `only ${r.n} threads measured`);
      assert(Math.abs(angle - r.toward) < 12, `drifting toward ${angle.toFixed(0)}°, wind toward ${r.toward}°`);
      assert(Math.abs(speed - r.mph * 6) / (r.mph * 6) < 0.15, `${speed.toFixed(0)} px/s for ${r.mph} mph`);
      return `${r.wind}: drifting toward ${angle.toFixed(0)}° at ${speed.toFixed(0)} px/s`;
    });
    await breeze.page.close();

    const storm = await openApp({ query: "?weather=storm" });
    await check("thunderstorms flicker with lightning now and then", async () => {
      const flashed = await storm.page.evaluate(async () => {
        const t0 = performance.now();
        while (performance.now() - t0 < 16_000) {
          if (window.fromAbove.fx.flash > 0) return true;
          await new Promise((r) => setTimeout(r, 50));
        }
        return false;
      });
      assert(flashed, "no lightning in 16 s");
    });
    await storm.page.close();

    const still = await openApp({ reduced: true, query: "?weather=heavy-snow" });
    await sleep(1000);
    await check("reduced motion: no falling snow", async () => {
      const lit = await still.page.evaluate(() => {
        const c = document.getElementById("fx");
        const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) n++;
        return n;
      });
      assert(lit === 0, `${lit} particle pixels drawn`);
    });
    await still.page.close();
  }

  for (const [at, expect] of [["13:00", "day"], ["22:00", "night"]]) {
    const sky = await openApp({ query: `?at=${at}` });
    await sleep(1500);
    await check(`at ${at} the map shows ${expect}`, async () => {
      const r = await sky.page.evaluate(() => ({
        mark: document.documentElement.dataset.sky,
        bg: window.fromAbove.map.getPaintProperty("background", "background-color"),
        daylight: window.fromAbove.sky().daylight,
      }));
      assert(r.mark === expect, `page marked ${r.mark}`);
      const n = parseInt(String(r.bg).slice(1), 16);
      const lum = (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 765;
      assert(expect === "day" ? lum > 0.8 : lum < 0.1, `background ${r.bg}`);
      assert(sky.errors.length === 0, sky.errors.join(" | "));
      return `background ${r.bg}, daylight ${r.daylight.toFixed(2)}`;
    });
    await sky.page.close();
  }

  const reduced = await openApp({ reduced: true });
  await sleep(2000);
  await check("reduced motion: no trails, vehicles sit at their latest fix", async () => {
    const r = await reduced.page.evaluate(() => {
      const g = window.fromAbove;
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
