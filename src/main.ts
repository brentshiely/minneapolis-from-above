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
import { Drift, IDLE_S, LANDMARKS, type Scene } from "./drift.ts";
import { AIRLINES, kmBetween } from "./describe.ts";
import { learnedLakes } from "./water/match.ts";
import { loadFreeways, type Freeways } from "./traffic/freeways.ts";
import type { TrafficResponse } from "./traffic/traffic.ts";
import { trafficLayer, type TrafficFrame } from "./layers/traffic.ts";
import { WeatherFx } from "./weather/effects.ts";
import { previewWeather, type Weather } from "./weather/classify.ts";

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
// On small screens the credits start collapsed behind their (i) button.
if (matchMedia("(max-width: 640px)").matches) {
  map.once("load", () => document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
}
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

  // Weather at MSP, drawn over the map. ?weather=snow (etc.) previews it.
  const fx = new WeatherFx(document.getElementById("fx") as HTMLCanvasElement, document.getElementById("veil")!);
  fx.setDaylight(sky.daylight);
  const weatherPreview = previewWeather(new URLSearchParams(location.search).get("weather") ?? "");
  const weatherFeed = weatherPreview
    ? (fx.set(weatherPreview), undefined)
    : startPoller<Weather>("/api/weather", 5 * 60_000, (w) => fx.set(w));

  // When nobody's touching the map, tour it slowly.
  const idleParam = Number(new URLSearchParams(location.search).get("idle"));
  const trainScene: Scene = {
    kind: "follow", zoom: 14.6, pitch: 40,
    find() {
      const trains = fleet.list().filter((v) => v.mode === "rail" && v.alpha === 1 && v.motion.onShape && v.motion.speed > 0);
      const v = trains[Math.floor(Math.random() * trains.length)];
      if (!v) return undefined;
      const name = transit.routes[v.routeId]?.name ?? "light rail";
      return { name: `Riding along with a METRO ${name} train`, position: () => { const x = fleet.vehicles.get(v.id); return x && x.alpha > 0 ? x.position : undefined; } };
    },
  };
  const MSP: [number, number] = [-93.2218, 44.882];
  const landingScene: Scene = {
    kind: "follow", zoom: 12.8, pitch: 35,
    find() {
      const p = air.list().find((x) => !x.onGround && x.alpha === 1 && (x.verticalFpm ?? 0) < -300 && (x.altFt ?? 99999) < 8000
        && kmBetween(x.position[1], x.position[0], MSP[1], MSP[0]) < 30);
      if (!p) return undefined;
      const airline = AIRLINES[p.callsign.slice(0, 3)];
      const flight = p.callsign.replace(/^[A-Z]{3}(?=\d)/, "");
      const name = airline ? `Following ${airline} flight ${flight} into MSP` : "Following a plane into MSP";
      return { name, position: () => { const x = air.planes.get(p.id); return x && !x.onGround && x.alpha > 0 ? x.position : undefined; } };
    },
  };
  const [overview, mpls, uofm, stpaul, univ, lakes, approach, lake] = LANDMARKS;
  const drift = new Drift(map, [overview, mpls, trainScene, uofm, stpaul, landingScene, lakes, univ, approach, trainScene, lake],
    performance.now() / 1000, idleParam > 0 ? idleParam : IDLE_S);
  drift.holdStill = () => reducedMotion.matches || hover.pinnedOpen;
  const caption = document.getElementById("caption")!;
  drift.onCaption = (text) => {
    caption.classList.toggle("shown", !!text);
    if (text) caption.textContent = text;
  };
  // Any real input hands control back. Tiny pointer jitter doesn't count.
  let lastPointer: [number, number] | undefined;
  const wake = () => drift.wake(performance.now() / 1000);
  addEventListener("pointermove", (e) => {
    const p: [number, number] = [e.clientX, e.clientY];
    if (lastPointer && Math.hypot(p[0] - lastPointer[0], p[1] - lastPointer[1]) > 3) wake();
    lastPointer = p;
  }, { passive: true });
  for (const type of ["pointerdown", "wheel", "keydown", "touchstart"]) addEventListener(type, wake, { passive: true });

  // Follow the sun: check once a second and repaint when daylight shifts.
  // Dawn and dusk each take about an hour, so steps of 0.01 are invisible.
  let painted = sky.daylight;
  const followSun = () => {
    sky = skyAt(clock());
    a.sun = sky.sun;
    if (Math.abs(sky.daylight - painted) < 0.01 && !(sky.daylight !== painted && (sky.daylight === 0 || sky.daylight === 1))) return;
    painted = sky.daylight;
    f.daylight = a.daylight = tf.daylight = sky.daylight;
    paintSky(map, sky.daylight);
    fx.setDaylight(sky.daylight);
    routes = routeLayers(transit, sky.daylight, anchor);
    markSky(sky.daylight);
  };
  setInterval(followSun, 1000);
  // Freeway speeds from MnDOT's road sensors, every 30 seconds.
  let freeways: Freeways | undefined;
  const tf: TrafficFrame = { readings: {}, version: 0, daylight: sky.daylight };
  loadFreeways().then((fw) => { freeways = fw; hover.setFreeways(fw, () => tf.readings, () => trafficAge); }).catch((e) => console.warn(e));
  let trafficAge = 0;
  const trafficFeed = startPoller<TrafficResponse>("/api/traffic", 30_000, (body) => {
    tf.readings = body.s;
    trafficAge = body.t;
    tf.version++;
  }, { maxMs: 5 * 60_000 });

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
    drift.tick(now);
    fx.frame(dt, map.getBearing(), still);
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
        ...(freeways ? [trafficLayer(freeways, tf, anchor)] : []),
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

  // Aircraft feeds can refuse the live site's servers entirely; back off
  // to one check every 5 minutes rather than asking every 5 seconds.
  const airFeed = startPoller<AircraftResponse>("/api/aircraft", 5_000, (body) => {
    const now = performance.now() / 1000;
    air.update(body.a, now);
    air.prune(now);
  }, { maxMs: 5 * 60_000 });

  // Nobody is watching a hidden tab: stop polling, and catch up on return.
  document.addEventListener("visibilitychange", () => {
    const hidden = document.visibilityState === "hidden";
    for (const p of [feed, airFeed, weatherFeed, trafficFeed]) if (!p) continue; else if (hidden) p.pause(); else p.resume();
  });

  startStatus(document.getElementById("status")!, fleet, feed, air, () => fx.current && `${fx.current.summary} · ${fx.current.wind}`, airFeed.status);

  (window as unknown as { fromAbove: unknown }).fromAbove = { map, overlay, transit, fleet, feed, trails, air, airFeed, hover, drift, fx, learnedLakes, tf, freeways: () => freeways, sky: () => sky };
});

(window as unknown as { fromAbove: unknown }).fromAbove = { map, overlay };
