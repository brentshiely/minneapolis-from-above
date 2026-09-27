import "./style.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { createBaseMap, paintSky } from "./basemap.ts";
import { skyAt, skyClock } from "./sky.ts";
import { mixColor } from "./color.ts";
import { loadTransit } from "./transit/data.ts";
import { alertRouteLayers, routeLayers } from "./layers/routes.ts";
import { AlertsWatch, previewAlert, startAlertsFeed } from "./transit/alerts.ts";
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
import type { CameraInfo, CamerasFile } from "./traffic/cameras.ts";
import { cameraLayers } from "./layers/cameras.ts";
import { Satellites } from "./sky/satellites.ts";
import { sunPosition } from "./sun.ts";
import { satelliteLayers, type SatFrame } from "./layers/satellites.ts";
import { WeatherFx } from "./weather/effects.ts";
import { previewWeather, type Weather } from "./weather/classify.ts";
import { AirHaze } from "./weather/haze.ts";
import { airPhrase, previewAir, type Air } from "./weather/air.ts";
import { MoonGlow } from "./moonlight.ts";
import { PlanetsGlow } from "./planetlight.ts";
import { showerStatus } from "./meteors.ts";
import { boatsAt, type Passage, type RiverResponse } from "./river/river.ts";
import { riverLayers, type RiverFrame } from "./layers/river.ts";
import { fallsLayers, type FallsFrame } from "./layers/falls.ts";
import { FALLS_GAUGE_LID, flowLevel } from "./water/falls.ts";
import type { Gauge } from "./water/gauges.ts";
import { SnowWatch } from "./snow/watch.ts";
import { previewSnow, type SnowResponse } from "./snow/rules.ts";
import { snowLayers, type SnowFrame } from "./layers/snow.ts";

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
  // Live service alerts: affected routes dash instead of their usual solid
  // line, and a major one (a rail line on shuttle buses, or a detour
  // reaching several routes) gets a caption. ?alert=blueline-detour (or
  // greenline-detour) previews one.
  const alertsPreview = previewAlert(new URLSearchParams(location.search).get("alert") ?? "");
  const alerts = new AlertsWatch(document.getElementById("alerts")!, transit.routes);
  let routes = routeLayers(transit, sky.daylight, anchor, alerts.affected);
  let alertLayers = alertRouteLayers(transit, alerts.affected, sky.daylight, anchor);
  alerts.onChange = () => {
    routes = routeLayers(transit, sky.daylight, anchor, alerts.affected);
    alertLayers = alertRouteLayers(transit, alerts.affected, sky.daylight, anchor);
  };
  if (alertsPreview) alerts.update(alertsPreview);
  const alertsFeed = alertsPreview ? undefined : startAlertsFeed((body) => alerts.update(body));
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
  // Smoke or ozone haze when the air turns bad. ?air=smoke-200 (etc.) previews it.
  const haze = new AirHaze(document.getElementById("haze")!);
  haze.setDaylight(sky.daylight);
  const airPreview = previewAir(new URLSearchParams(location.search).get("air") ?? "");
  const airQualityFeed = airPreview
    ? (haze.set(airPreview), undefined)
    : startPoller<Air>("/api/air", 15 * 60_000, (x) => haze.set(x), { maxMs: 60 * 60_000 });

  // The moon, calculated for the sky clock, glowing at the edge of the map.
  const moon = new MoonGlow(document.getElementById("veil")!);
  moon.update(clock(), sky.sun, sky.daylight);

  // The naked-eye planets, glowing faintly at the map's edge when they're up.
  const planets = new PlanetsGlow(document.getElementById("veil")!);
  planets.update(clock(), sky.daylight);

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
    const t = clock();
    sky = skyAt(t);
    a.sun = sky.sun;
    moon.update(t, sky.sun, sky.daylight);
    planets.update(t, sky.daylight);
    if (Math.abs(sky.daylight - painted) < 0.01 && !(sky.daylight !== painted && (sky.daylight === 0 || sky.daylight === 1))) return;
    painted = sky.daylight;
    f.daylight = a.daylight = tf.daylight = rf.daylight = snowFrame.daylight = sky.daylight;
    paintSky(map, sky.daylight);
    fx.setDaylight(sky.daylight);
    haze.setDaylight(sky.daylight);
    routes = routeLayers(transit, sky.daylight, anchor, alerts.affected);
    alertLayers = alertRouteLayers(transit, alerts.affected, sky.daylight, anchor);
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

  // MnDOT's freeway cameras: baked once, they never move.
  let cameras: CameraInfo[] = [];
  fetch("/data/cameras.json").then((r) => (r.ok ? (r.json() as Promise<CamerasFile>) : undefined)).then((body) => {
    if (!body) return;
    cameras = body.cameras;
    hover.setCameras(cameras);
  }).catch((e) => console.warn(e));

  const hover = new Hover(map, overlay, fleet, air, transit, () => f.daylight);
  hover.setMoon(moon);
  hover.setPlanets(planets);
  hover.setAlerts(() => alerts.affected);

  // Boats through the Mississippi locks, from the Army Corps' lock logs.
  // They're passages, not positions, and real ones: always in real time.
  let passages: Passage[] = [];
  const rf: RiverFrame = { boats: [], version: 0, daylight: sky.daylight };
  const placeBoats = () => { rf.boats = boatsAt(passages, Date.now() / 1000); rf.version++; };
  const riverFeed = startPoller<RiverResponse>("/api/river", 5 * 60_000, (body) => { passages = body.p; placeBoats(); }, { maxMs: 30 * 60_000 });
  // Boats drift a few meters a minute: re-placing them once a second is plenty.
  setInterval(placeBoats, 1000);
  hover.setRiver(() => rf.boats, () => passages);

  // Minnehaha Falls: a fixed landmark whose flow rides on the same gauge
  // list the water-hover system already refreshes every 10 minutes.
  let fallsGauge: Gauge | undefined;
  const fallsFrame: FallsFrame = { level: "dry", daylight: sky.daylight, now: 0 };
  hover.setFalls(() => fallsGauge);
  const loadFallsGauge = () => fetch("/api/water").then((r) => (r.ok ? (r.json() as Promise<{ gauges?: Gauge[] }>) : undefined))
    .then((b?: { gauges?: Gauge[] }) => {
      const g = b?.gauges?.find((x) => x.lid === FALLS_GAUGE_LID);
      if (g) { fallsGauge = g; fallsFrame.level = g.flowKcfs !== null ? flowLevel(g.flowKcfs * 1000) : "dry"; }
    })
    .catch(() => {});
  loadFallsGauge();
  setInterval(loadFallsGauge, 10 * 60_000);

  // Snow emergencies: a quiet caption and the city's snow emergency routes,
  // only while one is declared. ?snow=mpls-2 or ?snow=stp-night previews one.
  const snowPreview = previewSnow(new URLSearchParams(location.search).get("snow") ?? "");
  const snow = new SnowWatch(document.getElementById("snow")!, clock, snowPreview);
  const snowFrame: SnowFrame = { routes: [], daylight: sky.daylight };
  hover.setSnow((city) => snow.stages[city]);
  const snowFeed = snowPreview ? undefined : startPoller<SnowResponse>("/api/snow", 5 * 60_000, (body) => snow.update(body), { maxMs: 30 * 60_000 });
  // Day 2 begins at 8 AM whether or not the city's page has changed.
  setInterval(() => snow.refresh(), 30_000);

  // Every active satellite, animated while it crosses the map.
  const sats = new Satellites(() => {
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  });
  const sf: SatFrame = { sats: [], now: 0, version: 0, daylight: sky.daylight, sunElevation: sky.sun.elevation };
  // Satellites are always shown in real time, so whether one is visible
  // depends on the real sun, even while ?at= previews another time of day.
  const realSunElevation = () => sunPosition(new Date()).elevation;
  hover.setSatellites(() => sats.list, realSunElevation);

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
    sats.frame(now);
    sf.sats = sats.list; sf.now = now; sf.version++; sf.daylight = f.daylight; sf.sunElevation = realSunElevation();
    fx.frame(dt, map.getBearing(), still);
    moon.frame(map.getBearing(), fx.current?.cloudCover ?? 0);
    planets.frame(map.getBearing(), fx.current?.cloudCover ?? 0);
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
    snowFrame.routes = snow.lit;
    fallsFrame.daylight = f.daylight;
    fallsFrame.now = now;
    overlay.setProps({
      // Planes fly above everything on the ground.
      layers: [
        ...(freeways ? [trafficLayer(freeways, tf, anchor)] : []),
        ...cameraLayers(cameras, anchor),
        ...routes,
        ...alertLayers,
        ...snowLayers(snowFrame, anchor),
        ...(still ? [] : trailLayers(transit, f)),
        ...vehicleLayers(transit, f),
        ...riverLayers(rf),
        ...fallsLayers(fallsFrame),
        ...aircraftLayers(a),
        // Satellites fly highest of all.
        ...satelliteLayers(sf),
        ...pickLayers(fleet.list().filter((v) => v.alpha > 0.3), a.planes, f.version, sf.sats),
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
    for (const p of [feed, airFeed, weatherFeed, trafficFeed, airQualityFeed, riverFeed, snowFeed, alertsFeed]) if (!p) continue; else if (hidden) p.pause(); else p.resume();
  });

  startStatus(document.getElementById("status")!, fleet, feed, air, () => [fx.current && `${fx.current.summary} · ${fx.current.wind}`, airPhrase(haze.current), showerStatus(clock())].filter(Boolean).join(" · ") || undefined, airFeed.status, () => sats.aboveHorizon);

  (window as unknown as { fromAbove: unknown }).fromAbove = {
    map, overlay, transit, fleet, feed, trails, air, airFeed, hover, drift, fx, haze, learnedLakes, tf,
    freeways: () => freeways, cameras: () => cameras, sats, sky: () => sky, moon, planets, snow,
    river: { rf, passages: () => passages, setPassages: (p: Passage[]) => { passages = p; placeBoats(); } },
    falls: { frame: fallsFrame, gauge: () => fallsGauge, setGauge: (g: Gauge) => { fallsGauge = g; fallsFrame.level = g.flowKcfs !== null ? flowLevel(g.flowKcfs * 1000) : "dry"; } },
    alerts, alertsFeed,
  };
});

(window as unknown as { fromAbove: unknown }).fromAbove = { map, overlay };
