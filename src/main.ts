import "./style.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { createBaseMap, paintSky } from "./basemap.ts";
import { skyAt, skyClock } from "./sky.ts";
import { mixColor } from "./color.ts";
import { loadTransit } from "./transit/data.ts";
import { routeLayers } from "./layers/routes.ts";
import { trailLayers, vehicleLayers, type VehicleFrame } from "./layers/vehicles.ts";
import { Fleet, type Vehicle } from "./live/fleet.ts";
import type { Plane } from "./live/aircraft.ts";
import { startFeed, startPoller } from "./live/feed.ts";
import { AirFleet } from "./live/aircraft.ts";
import { aircraftLayers, type AircraftFrame } from "./layers/aircraft.ts";
import type { AircraftResponse } from "../functions/api/aircraft.ts";
import { Trails } from "./live/trails.ts";
import { startStatus } from "./status.ts";
import { Hover } from "./hover.ts";
import { pickLayers } from "./layers/hover.ts";

const clock = skyClock();
let sky = skyAt(clock());
/** Tell the page chrome (status line, tooltip, credits) which look to use. */
const markSky = (d: number) => {
  document.documentElement.dataset.sky = d >= 0.5 ? "day" : "night";
  document.documentElement.style.setProperty("--daylight", d.toFixed(3));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mixColor("#070b10", "#eceee9", d));
};
markSky(sky.daylight);

const map = createBaseMap(document.getElementById("map")!, sky.daylight);
const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
map.addControl(overlay);

/**
 * Route lines sit above roads but beneath street and place names, so labels
 * stay legible. That's the first label after the last road or rail layer;
 * the style's water labels come earlier and would bury routes under roads.
 */
function labelsAnchor(): string | undefined {
  const layers = map.getStyle().layers;
  let lastRoad = -1;
  layers.forEach((l, i) => { if (l.type === "line" && /^(highway|railway|road|aeroway)/.test(l.id)) lastRoad = i; });
  return layers.slice(lastRoad + 1).find((l) => l.type === "symbol")?.id;
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const transitReady = loadTransit();
const mapReady = new Promise<void>((resolve) => map.once("load", () => resolve()));

Promise.all([transitReady, mapReady]).then(([transit]) => {
  const fleet = new Fleet(transit);
  const trails = new Trails<Vehicle>();
  const anchor = labelsAnchor();
  let routes = routeLayers(transit, sky.daylight, anchor);
  const f: VehicleFrame = { vehicles: [], trails: [], now: 0, version: 0, trailsVersion: 0, daylight: sky.daylight };
  const air = new AirFleet();
  const airTrails = new Trails<Plane>(45);
  const a: AircraftFrame = { planes: [], trails: [], now: 0, version: 0, trailsVersion: 0, daylight: sky.daylight, sun: sky.sun };

  // Follow the sun: check once a second and repaint when daylight shifts.
  // Dawn and dusk each take about an hour, so steps of 0.01 are invisible.
  let painted = sky.daylight;
  const followSun = () => {
    sky = skyAt(clock());
    a.sun = sky.sun;
    if (Math.abs(sky.daylight - painted) < 0.01 && !(sky.daylight !== painted && (sky.daylight === 0 || sky.daylight === 1))) return;
    painted = sky.daylight;
    f.daylight = a.daylight = sky.daylight;
    paintSky(map, sky.daylight);
    routes = routeLayers(transit, sky.daylight, anchor);
    markSky(sky.daylight);
  };
  setInterval(followSun, 1000);
  const hover = new Hover(map, overlay, fleet, air, transit, () => f.daylight);

  /** Trail geometry is rebuilt a few times a second; the fade animates every frame. */
  const TRAIL_REBUILD_S = 0.25;
  let lastTrailBuild = -Infinity;

  // Each frame glides every vehicle along its route and redraws.
  let last = performance.now();
  const frame = (nowMs: number) => {
    // Clamp so a long pause (backgrounded tab) doesn't lurch everything at once.
    const dt = Math.min(0.25, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    // Reduced motion: vehicles step to each new fix, with no glide or trails.
    const still = reducedMotion.matches;
    fleet.advance(dt, now, still);
    air.advance(dt, now);
    if (!still) {
      trails.record(fleet.vehicles, now);
      airTrails.record(air.planes, now);
      if (now - lastTrailBuild >= TRAIL_REBUILD_S) {
        lastTrailBuild = now;
        f.trails = trails.snapshot(now);
        f.trailsVersion++;
        a.trails = airTrails.snapshot(now);
        a.trailsVersion++;
      }
    }
    a.planes = air.list().filter((p) => p.alpha > 0);
    a.now = now;
    a.version++;
    f.vehicles = fleet.drawables();
    f.now = now;
    f.version++;
    overlay.setProps({
      // Planes fly above everything on the ground.
      layers: [
        ...routes,
        ...(still ? [] : trailLayers(transit, f)),
        ...vehicleLayers(transit, f),
        ...aircraftLayers(a),
        ...pickLayers(fleet.list().filter((v) => v.alpha > 0.3), a.planes, f.version),
        ...hover.frame(now, f.version),
      ],
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const feed = startFeed((feedTime, rows) => {
    fleet.update(feedTime, rows, performance.now() / 1000);
    fleet.prune(feedTime);
  });

  const airFeed = startPoller<AircraftResponse>("/api/aircraft", 5_000, (body) => {
    const now = performance.now() / 1000;
    air.update(body.a, now);
    air.prune(now);
  });

  // Nobody is watching a hidden tab: stop polling, and catch up on return.
  document.addEventListener("visibilitychange", () => {
    const hidden = document.visibilityState === "hidden";
    for (const p of [feed, airFeed]) if (hidden) p.pause(); else p.resume();
  });

  startStatus(document.getElementById("status")!, fleet, feed, air);

  (window as unknown as { fromAbove: unknown }).fromAbove = { map, overlay, transit, fleet, feed, trails, air, airFeed, hover, sky: () => sky };
});

(window as unknown as { fromAbove: unknown }).fromAbove = { map, overlay };
