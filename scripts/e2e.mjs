#!/usr/bin/env node
// End-to-end checks against the running app in headless Chrome (GPU).
//
//   node scripts/e2e.mjs [url]
//
// Exits non-zero if any check fails.
import puppeteer, { KnownDevices } from "puppeteer-core";

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

async function openApp({ reduced = false, query = "", phone = false } = {}) {
  const page = await browser.newPage();
  if (phone) await page.emulate(KnownDevices["iPhone 13"]);
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
    assert(/^\d+ buses · \d+ trains · \d+ planes( · [\d,]+ satellites up)?( · -?\d+°F, [a-z ]+ · (calm|([NESW]{1,2} )?wind \d+ mph(, gusting to \d+)?)( · AQI \d+, [a-z ]+( \([a-z ]+\))?)?)? · live$/.test(text), `got "${text}"`);
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
      // Hold the live feed still, so a real update can't jump this vehicle mid-check.
      window.fromAbove.feed.pause();
      const v = f.list().find((x) => x.alpha === 1);
      const ghostsBefore = f.drawables().length - f.vehicles.size;
      const [lon, lat] = v.position;
      const now = performance.now() / 1000;
      f.update(f.feedTime, [[v.id, "", v.routeId, lat, lon + 0.1, v.fixTime + 30, null]], now); // ~8 km east
      const ghosts = f.drawables().length - f.vehicles.size - ghostsBefore;
      await new Promise((r) => setTimeout(r, 600));
      const mid = { vehicle: v.alpha, drawn: f.drawables().length };
      await new Promise((r) => setTimeout(r, 1000));
      window.fromAbove.feed.resume();
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
      // A train with no other vehicle close enough to share the cursor.
      const all = window.fromAbove.fleet.list().filter((x) => x.alpha === 1);
      const clear = (v) => all.every((o) => o === v || Math.hypot((o.position[0] - v.position[0]) * 70_000, (o.position[1] - v.position[1]) * 111_000) > 150);
      const v = all.find((x) => x.mode === "rail" && clear(x));
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

  // Water: point the mouse at a river or lake and read its gauge.
  async function hoverWater(center, zoom = 13.5) {
    await page.evaluate(({ center, zoom }) => window.fromAbove.map.jumpTo({ center, zoom }), { center, zoom });
    await sleep(3500);
    await page.mouse.move(5, 5);
    const pt = await page.evaluate((c) => window.fromAbove.map.project(c), center);
    await page.mouse.move(pt.x, pt.y);
    await sleep(2500);
    const text = await page.$eval("#tip", (el) => (el.hidden ? "" : el.innerText));
    await page.mouse.move(5, 5);
    await sleep(200);
    return text;
  }
  for (const [name, center, expect] of [
    ["the Mississippi in Saint Paul", [-93.1, 44.938], /^Mississippi River at/],
    ["the St. Croix at Stillwater", [-92.795, 45.05], /^St\. Croix River|^Saint Croix River/],
    ["Lake Minnetonka", [-93.56, 44.935], /^Lake Minnetonka/],
  ]) {
    await check(`hovering ${name} shows its water level`, async () => {
      const text = await hoverWater(center);
      assert(expect.test(text), `got "${text}"`);
      assert(/feet/.test(text), `no level in "${text}"`);
      return text.replace(/\n/g, " | ");
    });
  }
  await check("hovering a lake without a gauge, or dry land, shows nothing", async () => {
    const harriet = await hoverWater([-93.306, 44.922]);
    const land = await hoverWater([-93.25, 44.95]);
    assert(harriet === "", `Lake Harriet showed "${harriet}"`);
    assert(land === "", `dry land showed "${land}"`);
  });

  await check("hovering a freeway shows its live speed in plain words", async () => {
    // A stretch of I-94 with a current reading, near its middle.
    const target = await page.evaluate(() => {
      const g = window.fromAbove, fw = g.freeways();
      // In the core metro, where the camera can go (the map's pan limits stop short of Monticello).
      const core = ([lon, lat]) => lon > -93.4 && lon < -93.0 && lat > 44.9 && lat < 45.05;
      const s = fw.stretches.find((x) => fw.stations[x.station]?.route === "I-94" && g.tf.readings[x.station]?.[0] != null
        && x.path.length >= 3 && core(x.path[Math.floor(x.path.length / 2)]));
      return s && { at: s.path[Math.floor(s.path.length / 2)], station: s.station };
    });
    assert(target, "no I-94 stretch with a reading");
    await page.evaluate((c) => window.fromAbove.map.jumpTo({ center: c, zoom: 15 }), target.at);
    await sleep(2500);
    await page.mouse.move(5, 5);
    const pt = await page.evaluate((c) => window.fromAbove.map.project(c), target.at);
    await page.mouse.move(pt.x, pt.y);
    await sleep(800);
    const tip = await page.$eval("#tip", (el) => (el.hidden ? "" : el.innerText));
    await page.mouse.move(5, 5);
    assert(/^I-94 (east|west)bound/.test(tip), `got "${tip}"`);
    assert(/\d+ mph, (moving freely|slowing|heavy traffic|stop and go)\. The limit is \d+\./.test(tip), `got "${tip}"`);
    return tip.replace(/\n/g, " | ");
  });

  await check("hovering a freeway camera shows its location and live snapshot", async () => {
    const target = await page.evaluate(() => {
      const g = window.fromAbove;
      const core = (lon, lat) => lon > -93.4 && lon < -93.0 && lat > 44.9 && lat < 45.05;
      return g.cameras().find((c) => core(c.lon, c.lat));
    });
    assert(target, "no camera in the core metro");
    await page.evaluate((c) => window.fromAbove.map.jumpTo({ center: c, zoom: 17 }), [target.lon, target.lat]);
    await sleep(2500);
    await page.mouse.move(5, 5);
    const pt = await page.evaluate((c) => window.fromAbove.map.project(c), [target.lon, target.lat]);
    await page.mouse.move(pt.x, pt.y);
    await sleep(800);
    const tip = await page.$eval("#tip", (el) => (el.hidden ? "" : el.innerText));
    const hasImage = await page.$eval("#tip img.tip-image", (el) => el.naturalWidth > 0).catch(() => false);
    await page.mouse.move(5, 5);
    assert(/^(I-\d|US \d|Highway \d)/.test(tip), `got "${tip}"`);
    assert(/MnDOT traffic camera/.test(tip), `got "${tip}"`);
    return `${tip.replace(/\n/g, " | ")} | image loaded: ${hasImage}`;
  });

  await check("river: hovering Lock and Dam 1 names it, and a boat that just locked through reads plainly", async () => {
    // The lock logs come every 5 minutes and boats are rare, so add one that just went through.
    const real = await page.evaluate(() => window.fromAbove.river.passages().length);
    await page.evaluate(() => {
      const now = Date.now() / 1000;
      const g = window.fromAbove.river;
      g.setPassages([{ lock: "01", vessel: "MARGARET D", up: true, barges: 2, arrived: now - 1800, done: now - 60, rec: false }, ...g.passages()]);
      window.fromAbove.map.jumpTo({ center: [-93.2021, 44.9148], zoom: 15 });
    });
    await sleep(2500);
    const hoverAt = async (lngLat, dx = 0, dy = 0) => {
      await page.mouse.move(5, 5);
      const pt = await page.evaluate((c) => window.fromAbove.map.project(c), lngLat);
      await page.mouse.move(pt.x + dx, pt.y + dy);
      await sleep(600);
      return page.$eval("#tip", (el) => (el.hidden ? "" : el.innerText));
    };
    const boatAt = await page.evaluate(() => window.fromAbove.river.rf.boats.find((b) => b.p.vessel === "MARGARET D").position);
    const boat = await hoverAt(boatAt);
    assert(/^Towboat Margaret D heading upstream with 2 barges, through Lock and Dam 1 at \d+:\d\d [AP]M\./.test(boat), `got "${boat}"`);
    // Beside the lock mark, clear of the boat sitting on it.
    const lock = await hoverAt([-93.2021, 44.9148], -10, 8);
    await page.mouse.move(5, 5);
    assert(/^Lock and Dam 1\./.test(lock) && /Last through: Margaret D, heading upstream with 2 barges/.test(lock), `got "${lock}"`);
    return `${real} passages from the Corps; ${boat.split("\n")[0]}`;
  });

  await check("satellites: all loaded, hundreds above the horizon, and one crossing the map can be hovered", async () => {
    await page.waitForFunction(() => window.fromAbove.sats.ready, { timeout: 60_000 });
    await page.evaluate(() => window.fromAbove.map.jumpTo({ center: [-93.2, 44.95], zoom: 9 }));
    let tip = "", info;
    for (let i = 0; i < 30 && !tip; i++) {
      await sleep(3000);
      info = await page.evaluate(() => {
        const g = window.fromAbove, b = g.map.getBounds();
        const inner = (p) => p[0] > b.getWest() + 0.2 && p[0] < b.getEast() - 0.2 && p[1] > b.getSouth() + 0.15 && p[1] < b.getNorth() - 0.15;
        const s = g.sats.list.find((x) => inner(x.position));
        return { total: g.sats.total, up: g.sats.aboveHorizon, id: s?.id };
      });
      if (!info.id) continue;
      for (let k = 0; k < 3; k++) {
        const pt = await page.evaluate((id) => { const g = window.fromAbove; const s = g.sats.list.find((x) => x.id === id); return s && g.map.project(s.position); }, info.id);
        if (!pt) break;
        await page.mouse.move(pt.x, pt.y);
        await sleep(600);
      }
      tip = await page.$eval("#tip", (el) => (el.hidden ? "" : el.innerText));
    }
    await page.mouse.move(5, 5);
    assert(info.total > 10_000, `only ${info.total} satellites loaded`);
    assert(info.up > 200, `only ${info.up} above the horizon`);
    assert(/Now [\d,]+ miles up, moving at [\d,]+ mph\./.test(tip), `got "${tip}"`);
    assert(/(visible|shadow|too bright|Too low)/i.test(tip), `no visibility in "${tip}"`);
    return `${info.total.toLocaleString()} loaded, ${info.up} up; ${tip.split("\n")[0]}`;
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

  await check("with no snow emergency declared, nothing about one shows", async () => {
    const r = await page.evaluate(() => ({ shown: document.getElementById("snow").classList.contains("shown"), lit: window.fromAbove.snow.lit.length }));
    assert(!r.shown && r.lit === 0, JSON.stringify(r));
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

    const smoke = await openApp({ query: "?air=smoke-160" });
    await sleep(5000);
    await check("wildfire smoke hazes the map, and the status line names it", async () => {
      const r = await smoke.page.evaluate(() => ({
        opacity: Number(getComputedStyle(document.getElementById("haze")).opacity),
        status: document.getElementById("status").textContent,
      }));
      assert(r.opacity > 0.2 && r.opacity < 0.6, `haze opacity ${r.opacity}`);
      assert(/AQI 160, unhealthy \(smoke\)/.test(r.status), `status "${r.status}"`);
      return `haze ${r.opacity.toFixed(2)}`;
    });
    await smoke.page.close();

    const breeze = await openApp({ query: "?weather=breezy" });
    await sleep(1500);
    await check("wind threads drift the way the wind blows, at a pace proportional to it", async () => {
      const r = await breeze.page.evaluate(async () => {
        const fx = window.fromAbove.fx;
        const snap = () => new Map(fx.threads.map((t) => [t, [t.x, t.y, t.age]]));
        // Measure against the threads' own clock (their age), not a timer
        // that can fire late under load.
        const a = snap();
        await new Promise((r) => setTimeout(r, 1000));
        let vx = 0, vy = 0, n = 0;
        for (const t of fx.threads) {
          const p = a.get(t);
          if (!p || t.age < p[2]) continue; // respawned meanwhile
          const elapsed = t.age - p[2];
          vx += (t.x - p[0]) / elapsed; vy += (t.y - p[1]) / elapsed; n++;
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

    const emergency = await openApp({ query: "?snow=mpls-2&at=13:00" });
    await check("a snow emergency: a quiet caption, lit routes, and hovering one gives today's rule", async () => {
      await emergency.page.waitForFunction(() => window.fromAbove.snow.lit.length > 0, { timeout: 10_000 });
      await emergency.page.evaluate(() => window.fromAbove.map.jumpTo({ center: [-93.285, 44.945], zoom: 13.2 }));
      await sleep(2500);
      const caption = await emergency.page.$eval("#snow", (el) => el.classList.contains("shown") && el.textContent);
      assert(/^Minneapolis snow emergency, day 2: no parking on the even side/.test(caption || ""), `caption "${caption}"`);
      const hit = await emergency.page.evaluate(() => {
        for (let y = 250; y < 550; y += 3) for (let x = 400; x < 900; x += 2) {
          if (window.fromAbove.overlay.pickObject({ x, y, radius: 0, layerIds: ["snow-halo"] })) return [x, y];
        }
      });
      assert(hit, "no lit route on screen");
      await emergency.page.mouse.move(hit[0] - 20, hit[1] - 20);
      await emergency.page.mouse.move(hit[0], hit[1], { steps: 4 });
      await sleep(800);
      const tip = await emergency.page.$eval("#tip", (el) => (el.hidden ? "" : el.textContent));
      assert(/snow emergency route\..*Parking is allowed on both sides today/.test(tip), `tooltip "${tip}"`);
      return caption;
    });
    await emergency.page.close();

    const still =await openApp({ reduced: true, query: "?weather=heavy-snow" });
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

  {
    // The full moon of Sept 26, 2026, high in the southeast late that evening.
    const night = await openApp({ query: "?date=2026-09-26&at=23:00&weather=clear" });
    await sleep(1500);
    await check("the moon glows at the edge of the map and describes itself on hover", async () => {
      const [x, y] = await night.page.evaluate(() => window.fromAbove.moon.anchor());
      assert(x > 640 && y > 400, `moon at ${Math.round(x)}, ${Math.round(y)}, expected to the southeast`);
      await night.page.mouse.move(x - 30, y - 30);
      await night.page.mouse.move(x, y, { steps: 4 });
      await sleep(400);
      const tip = await night.page.$eval("#tip", (t) => (t.hidden ? "" : t.innerText));
      assert(/The moon/.test(tip) && /Full moon, 100% lit\. Up now in the southeast/.test(tip), `tooltip: ${tip}`);
      return tip.split("\n")[1];
    });
    await night.page.close();
    const day = await openApp({ query: "?date=2026-09-26&at=13:00" });
    await sleep(1500);
    await check("no moon by day", async () => {
      const shown = await day.page.evaluate(() => ["moon-glow", "moon-disc", "moon-light"].map((id) => Number(getComputedStyle(document.getElementById(id)).opacity)));
      assert(shown.every((o) => o === 0), `opacities ${shown}`);
    });
    await day.page.close();
  }

  {
    const phone = await openApp({ phone: true, query: "?idle=4" });
    const p = phone.page;
    await sleep(2500);
    const fits = () => p.evaluate(() => {
      const box = (el) => el && !el.hidden ? el.getBoundingClientRect() : null;
      const out = [];
      for (const id of ["status", "tip", "caption"]) {
        const b = box(document.getElementById(id));
        if (b && b.width && (b.left < 0 || b.right > innerWidth || b.bottom > innerHeight)) out.push(`${id} ${Math.round(b.left)}..${Math.round(b.right)}`);
      }
      if (document.documentElement.scrollWidth > innerWidth) out.push("page scrolls sideways");
      return out;
    });
    await check("phone: nothing spills off a 390 px screen", async () => {
      const bad = await fits();
      assert(bad.length === 0, bad.join(", "));
      const both = await p.evaluate(() => {
        const b = window.fromAbove.map.getBounds();
        return b.contains([-93.268, 44.976]) && b.contains([-93.094, 44.948]);
      });
      assert(both, "both downtowns aren't in the first view");
    });
    await check("phone: tapping a bus shows its tooltip, on screen; tapping elsewhere dismisses it", async () => {
      const id = await p.evaluate(() => {
        const all = window.fromAbove.fleet.list().filter((x) => x.alpha === 1);
        const clear = (v) => all.every((o) => o === v || Math.hypot((o.position[0] - v.position[0]) * 70_000, (o.position[1] - v.position[1]) * 111_000) > 250);
        const v = all.find((x) => x.mode === "bus" && clear(x));
        window.fromAbove.map.jumpTo({ center: v.position, zoom: 13 });
        return v.id;
      });
      await sleep(800);
      const pt = await p.evaluate((id) => { const g = window.fromAbove; return g.map.project(g.fleet.vehicles.get(id).position); }, id);
      await p.touchscreen.tap(pt.x + 6, pt.y + 5); // a fingertip, not a pixel-perfect hit
      await sleep(600);
      const tip = await p.$eval("#tip", (el) => (el.hidden ? "" : el.innerText));
      const bad = await fits();
      await p.touchscreen.tap(30, 120);
      await sleep(400);
      const gone = await p.$eval("#tip", (el) => el.hidden);
      assert(/bus/.test(tip), `got "${tip}"`);
      assert(bad.length === 0, bad.join(", "));
      assert(gone, "tooltip stayed after tapping elsewhere");
      return tip.split("\n")[0];
    });
    await check("phone: tapping the Mississippi shows its level", async () => {
      await p.evaluate(() => window.fromAbove.map.jumpTo({ center: [-93.1, 44.938], zoom: 13.5 }));
      await sleep(3500);
      const pt = await p.evaluate(() => window.fromAbove.map.project([-93.1, 44.938]));
      await p.touchscreen.tap(pt.x, pt.y);
      await sleep(2500);
      const tip = await p.$eval("#tip", (el) => (el.hidden ? "" : el.innerText));
      const bad = await fits();
      assert(/^Mississippi River/.test(tip), `got "${tip}"`);
      assert(bad.length === 0, bad.join(", "));
      await p.touchscreen.tap(30, 120);
    });
    await check("phone: touching the screen stops the drift", async () => {
      // A tap can land on a freeway and pin its tooltip, which (rightly) holds
      // the drift still; start from a clear screen.
      await p.evaluate(() => window.fromAbove.hover.clear());
      await sleep(6000);
      const before = await p.evaluate(() => window.fromAbove.drift.drifting);
      await p.touchscreen.tap(200, 300);
      await sleep(300);
      const after = await p.evaluate(() => window.fromAbove.drift.drifting);
      assert(before, "never started drifting");
      assert(!after, "still drifting after a touch");
    });
    await check("phone: no console errors", async () => {
      assert(phone.errors.length === 0, phone.errors.join(" | "));
    });
    await p.close();
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
