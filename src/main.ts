import "./style.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { createBaseMap, paintSky } from "./basemap.ts";
import { addAerialImagery, IMAGERY_LAYER_ID, setImageryOpacity } from "./imagery.ts";
import { addRadarLayer, refreshRadarTile } from "./weather/radar.ts";
import { skyAt, skyClock } from "./sky.ts";
import { mixColor } from "./color.ts";
import { loadTransit } from "./transit/data.ts";
import { AlertsWatch, previewAlert, startAlertsFeed } from "./transit/alerts.ts";
import { trailLayers, vehicleLayers, type VehicleFrame } from "./layers/vehicles.ts";
import { Fleet, type Vehicle } from "./live/fleet.ts";
import type { Plane } from "./live/aircraft.ts";
import { isDown, startDtaFeed, startFeed, startPoller } from "./live/feed.ts";
import { AirFleet } from "./live/aircraft.ts";
import { aircraftLayers, type AircraftFrame } from "./layers/aircraft.ts";
import type { AircraftResponse } from "../functions/api/aircraft.ts";
import { Trails } from "./live/trails.ts";
import { startStatus } from "./status.ts";
import { FrameGovernor } from "./perf/governor.ts";
import { Hover } from "./hover.ts";
import { pickLayers } from "./layers/hover.ts";
import { Drift, IDLE_S, LANDMARKS, type Scene } from "./drift.ts";
import { AIRLINES, kmBetween } from "./describe.ts";
import { learnedLakes } from "./water/match.ts";
import { loadFreeways, type Freeways } from "./traffic/freeways.ts";
import type { Readings, TrafficResponse } from "./traffic/traffic.ts";
import { trafficLayer, type TrafficFrame } from "./layers/traffic.ts";
import { CarFlow } from "./traffic/cars.ts";
import { fillGaps } from "./traffic/gaps.ts";
import { carsLayer } from "./layers/cars.ts";
import { loadRail, TrainFlow, type RailLine } from "./rail/rail.ts";
import { AmtrakFleet, type AmtrakResponse } from "./rail/amtrak.ts";
import { amtrakLayers, trainLayers } from "./layers/trains.ts";
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
import { AuroraGlow } from "./auroralight.ts";
import { auroraPhrase, previewAurora } from "./sky/aurora.ts";
import type { AuroraResponse } from "../functions/api/aurora.ts";
import { showerStatus } from "./meteors.ts";
import { boatsAt, type Passage, type RiverResponse } from "./river/river.ts";
import { riverLayers, type RiverFrame } from "./layers/river.ts";
import { fallsLayers, type FallsFrame } from "./layers/falls.ts";
import { warningLayers, type WarningsFrame } from "./layers/warnings.ts";
import { legend, previewWarning, rgbCss } from "./weather/warnings.ts";
import { gamesLayers, type GamesFrame } from "./layers/games.ts";
import { previewGames } from "./sports/games.ts";
import type { GamesResponse } from "../functions/api/games.ts";
import { incidentsLayers, type IncidentsFrame } from "./layers/incidents.ts";
import { previewIncidents } from "./traffic/incidents.ts";
import type { IncidentsResponse } from "../functions/api/incidents.ts";
import { beachesLayers, type BeachesFrame } from "./layers/beaches.ts";
import { previewBeaches } from "./water/beaches.ts";
import type { BeachesResponse } from "../functions/api/beaches.ts";
import { airportLayers, type AirportFrame } from "./layers/airport.ts";
import { airportPhrase, previewAirport } from "./airport.ts";
import type { AirportResponse } from "../functions/api/airport.ts";
import { wildlifeLayers, type WildlifeFrame } from "./layers/wildlife.ts";
import { previewWildlife } from "./wildlife/sightings.ts";
import type { WildlifeResponse } from "../functions/api/wildlife.ts";
import { crimeLayers, type CrimeFrame, type ResolvedCrime } from "./layers/crime.ts";
import { crimePosition, loadStPaulDistricts, previewCrime, type CrimeIncident, type StPaulDistricts } from "./crime/crime.ts";
import type { CrimeResponse } from "../functions/api/crime.ts";
import { gunfireLayers, type GunfireFrame } from "./layers/gunfire.ts";
import { droneLayers, type DronesFrame } from "./layers/drones.ts";
import type { DronesResponse } from "./drones/drones.ts";
import type { GunfireResponse } from "./gunfire/gunfire.ts";
import { fallColorPhrase, FallColorHaze, previewFallColor } from "./seasons/fallcolor.ts";
import type { FallColorResponse } from "../functions/api/fallcolor.ts";
import { SearchBox, type Place } from "./search.ts";
import { Marker } from "maplibre-gl";
import { TogglePanel } from "./togglepanel.ts";
import type { LayerKey } from "./toggles.ts";
import type { FeedStatus } from "./live/feed.ts";
import type { WarningsResponse } from "../functions/api/warnings.ts";
import { FALLS_GAUGE_LID, flowLevel } from "./water/falls.ts";
import type { Gauge } from "./water/gauges.ts";
import { SnowWatch } from "./snow/watch.ts";
import { previewSnow, type SnowResponse } from "./snow/rules.ts";
import { snowLayers, type SnowFrame } from "./layers/snow.ts";
import { addRelief, setReliefOpacity } from "./relief.ts";
import { dataUrl } from "./dataurl.ts";

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
/** How long a tooltip pinned by a tap holds the ambient tour still. */
const PIN_HOLD_S = 30;

const transitReady = loadTransit();
const mapReady = new Promise<void>((resolve) => map.once("load", () => resolve()));

Promise.all([transitReady, mapReady]).then(([transit]) => {
  const fleet = new Fleet(transit);
  const trails = new Trails<Vehicle>();
  const anchor = labelsAnchor();
  // Which data layers the viewer wants to see; collapsed button, sticks
  // across visits.
  const layersPanel = new TogglePanel(document.body);
  // Search for an address, intersection, street or place: fly there and ring it for a few seconds.
  let searchHoldUntil = 0;
  let pin: Marker | undefined;
  new SearchBox(document.body, (place: Place) => {
    pin?.remove();
    const el = document.createElement("div");
    el.className = "search-pin";
    const marker = pin = new Marker({ element: el }).setLngLat([place.lon, place.lat]).addTo(map);
    setTimeout(() => marker.remove(), 9_500); // its CSS animation fades it out by 8.8 s
    const to = { center: [place.lon, place.lat] as [number, number], zoom: place.zoom };
    if (reducedMotion.matches) map.jumpTo(to); else map.flyTo({ ...to, duration: 2200, essential: true });
    // The ambient tour would carry the view away from where they just asked to look.
    searchHoldUntil = performance.now() + 3 * 60_000;
  });
  // Real aerial photography, up close and by day: sits above the drawn
  // land/water/building fills but below roads, rail and labels, so those
  // stay legible on top of the photo.
  const imageryAnchor = map.getStyle().layers.find((l) => l.type === "line" && /^(highway|railway|road|aeroway)/.test(l.id))?.id;
  // Lidar-derived terrain shading sits beneath the photo and hands over to it by day.
  addRelief(map, imageryAnchor);
  const paintRelief = () => setReliefOpacity(map, sky.daylight, map.getZoom(), layersPanel.shown("relief"));
  paintRelief();
  map.on("zoom", paintRelief);
  layersPanel.onToggle = paintRelief;
  addAerialImagery(map, imageryAnchor);
  setImageryOpacity(map, sky.daylight, map.getZoom());
  map.on("zoom", () => setImageryOpacity(map, sky.daylight, map.getZoom()));
  // Live radar, current picture only (no loop — this is a passive map,
  // not a weather app to watch play out); drawn over the photo (added
  // after it, same anchor) so rain reads even when the imagery is
  // showing. Re-fetched every 5 minutes to match IEM's own refresh.
  addRadarLayer(map, imageryAnchor);
  setInterval(() => refreshRadarTile(map), 5 * 60_000);
  // Live service alerts: an affected route is traced dashed (not solid) when
  // you hover one of its vehicles, and a major one (a rail line on shuttle buses, or a detour
  // reaching several routes) gets a caption. ?alert=blueline-detour (or
  // greenline-detour) previews one.
  const alertsPreview = previewAlert(new URLSearchParams(location.search).get("alert") ?? "");
  const alerts = new AlertsWatch(document.getElementById("alerts")!, transit.routes);
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

  // A faint green wash toward the north when NOAA's forecast says
  // tonight's geomagnetic activity reaches this far south. ?aurora=watch
  // (or quiet, strong) previews a level without waiting for real activity.
  const auroraPreview = previewAurora(new URLSearchParams(location.search).get("aurora") ?? "");
  const aurora = new AuroraGlow(document.getElementById("veil")!);
  aurora.setDaylight(sky.daylight);
  if (auroraPreview) aurora.update(auroraPreview, Math.floor(Date.now() / 1000));
  let auroraKp: AuroraResponse["kp"] = auroraPreview?.kp ?? [];
  const applyAurora = (body: AuroraResponse) => { auroraKp = body.kp; aurora.update(body, Math.floor(Date.now() / 1000)); };
  const auroraFeed = auroraPreview ? undefined : startPoller<AuroraResponse>("/api/aurora", 15 * 60_000, applyAurora, { maxMs: 60 * 60_000 });

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
  // A tooltip pinned by a tap holds the camera still for a while, then lets the tour go on.
  drift.holdStill = () => reducedMotion.matches || (hover.pinnedOpen && hover.pinnedForS < PIN_HOLD_S) || performance.now() < searchHoldUntil;
  // The camera is about to move away from whatever a tooltip was describing.
  drift.onResume = () => hover.clear();
  const caption = document.getElementById("caption")!;
  drift.onCaption = (text) => {
    caption.classList.toggle("shown", !!text);
    if (text) caption.textContent = text;
  };
  // A click, drag, zoom or key press hands control back. Moving the pointer
  // doesn't: hovering over things to read them shouldn't end the tour.
  const wake = () => drift.wake(performance.now() / 1000);
  for (const type of ["pointerdown", "wheel", "keydown", "touchstart"]) addEventListener(type, wake, { passive: true });
  // While someone is using the map it runs at full rate; idle, at half.
  const governor = new FrameGovernor();
  for (const type of ["pointerdown", "pointermove", "wheel", "keydown", "touchstart", "touchmove"]) addEventListener(type, () => governor.poke(performance.now()), { passive: true });

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
    f.daylight = a.daylight = tf.daylight = rf.daylight = snowFrame.daylight = crimeFrame.daylight = gunfireFrame.daylight = dronesFrame.daylight = sky.daylight;
    paintSky(map, sky.daylight);
    fx.setDaylight(sky.daylight);
    haze.setDaylight(sky.daylight);
    aurora.setDaylight(sky.daylight);
    setImageryOpacity(map, sky.daylight, map.getZoom());
    paintRelief();
    markSky(sky.daylight);
  };
  setInterval(followSun, 1000);
  // Freeway speeds from MnDOT's road sensors, every 30 seconds.
  let freeways: Freeways | undefined;
  const tf: TrafficFrame = { readings: {}, estimated: new Set(), version: 0, daylight: sky.daylight };
  // Synthetic cars at the real volume (flow x lanes), moving at the real speed, from the same readings.
  let cars: CarFlow | undefined;
  loadFreeways().then((fw) => {
    freeways = fw;
    cars = new CarFlow(fw);
    hover.setFreeways(fw, () => tf.readings, () => trafficAge, (station) => tf.estimated.has(station));
    refill();
  }).catch((e) => console.warn(e));
  let trafficAge = 0;
  // Synthetic freight trains at the reported trains-a-day on each line.
  let trains: TrainFlow | undefined;
  let railLines: RailLine[] = [];
  loadRail().then((lines) => { railLines = lines; trains = new TrainFlow(lines); }).catch((e) => console.warn(e));
  // Amtrak's real trains, put on those same lines.
  const amtrak = new AmtrakFleet(() => railLines);
  const amtrakFeed = startPoller<AmtrakResponse>("/api/amtrak", 60_000, (body) => amtrak.update(body.trains, Date.now() / 1000), { maxMs: 10 * 60_000 });
  // The sensors' own readings, with holes in coverage filled from neighboring stretches.
  let rawReadings: Readings = {};
  const refill = () => {
    const filled = freeways ? fillGaps(freeways, rawReadings) : { readings: rawReadings, estimated: new Set<string>() };
    tf.readings = filled.readings;
    tf.estimated = filled.estimated;
    tf.version++;
  };
  const trafficFeed = startPoller<TrafficResponse>("/api/traffic", 30_000, (body) => {
    rawReadings = body.s;
    trafficAge = body.t;
    refill();
  }, { maxMs: 5 * 60_000 });

  // MnDOT's freeway cameras: baked once, they never move.
  let cameras: CameraInfo[] = [];
  fetch(dataUrl("cameras.json")).then((r) => (r.ok ? (r.json() as Promise<CamerasFile>) : undefined)).then((body) => {
    if (!body) return;
    cameras = body.cameras;
    hover.setCameras(cameras);
  }).catch((e) => console.warn(e));

  const hover = new Hover(map, overlay, fleet, air, transit, () => f.daylight);
  hover.setFreight(() => trains?.shapes ?? []);
  hover.setAmtrak(() => amtrak.trains);
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

  // NWS watches, warnings and advisories that touch the metro: a very
  // subtle shaded, slowly pulsing area, plus a quiet legend of what's
  // active. ?warning=tornado (or severe, winter) previews one.
  const warningsPreview = previewWarning(new URLSearchParams(location.search).get("warning") ?? "");
  const warningsFrame: WarningsFrame = { active: [], now: 0 };
  const warningsLegendEl = document.getElementById("warnings-legend")!;
  hover.setWarnings(() => warningsFrame.active);
  const renderLegend = () => {
    const items = legend(warningsFrame.active);
    warningsLegendEl.replaceChildren(...items.map(({ event, color }) => {
      const row = document.createElement("div");
      row.className = "item";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = rgbCss(color);
      const label = document.createElement("span");
      label.textContent = event;
      row.replaceChildren(swatch, label);
      return row;
    }));
    warningsLegendEl.classList.toggle("shown", items.length > 0);
  };
  const applyWarnings = (body: WarningsResponse) => { warningsFrame.active = body.w; renderLegend(); };
  if (warningsPreview) applyWarnings(warningsPreview);
  const warningsFeed = warningsPreview ? undefined
    : startPoller<WarningsResponse>("/api/warnings", 2 * 60_000, applyWarnings, { maxMs: 20 * 60_000 });

  // The five Minnesota pro venues, glowing only while their team is
  // actually playing. ?game=twins (or vikings, wolves, wild, united)
  // previews a live score without waiting for a real game.
  const gamesPreview = previewGames(new URLSearchParams(location.search).get("game") ?? "");
  const gamesFrame: GamesFrame = { games: gamesPreview?.games ?? [], now: 0 };
  hover.setGames(() => gamesFrame.games);
  const gamesFeed = gamesPreview ? undefined
    : startPoller<GamesResponse>("/api/games", 30_000, (body) => { gamesFrame.games = body.games; }, { maxMs: 5 * 60_000 });

  // Live freeway incidents: crashes, stalls, hazards and road work,
  // quietly marked. ?incident=crash (or stall, hazard, roadwork) previews one.
  const incidentsPreview = previewIncidents(new URLSearchParams(location.search).get("incident") ?? "");
  const incidentsFrame: IncidentsFrame = { active: incidentsPreview?.incidents ?? [], now: 0 };
  hover.setIncidents(() => incidentsFrame.active);
  const incidentsFeed = incidentsPreview ? undefined
    : startPoller<IncidentsResponse>("/api/incidents", 60_000, (body) => { incidentsFrame.active = body.incidents; }, { maxMs: 10 * 60_000 });

  // Minneapolis Park Board swimming beaches, open or closed for water
  // quality, in season. ?beach=open (or closed) previews a status.
  const beachesPreview = previewBeaches(new URLSearchParams(location.search).get("beach") ?? "");
  const beachesFrame: BeachesFrame = { active: beachesPreview?.beaches ?? [] };
  hover.setBeaches(() => beachesFrame.active);
  const beachesFeed = beachesPreview ? undefined
    : startPoller<BeachesResponse>("/api/beaches", 10 * 60_000, (body) => { beachesFrame.active = body.beaches; }, { maxMs: 60 * 60_000 });

  // MSP's own operating status: quiet on an ordinary day. ?msp=delay (or
  // groundstop, grounddelay, closure) previews one.
  const airportPreview = previewAirport(new URLSearchParams(location.search).get("msp") ?? "");
  const airportFrame: AirportFrame = { status: airportPreview?.status ?? [], now: 0 };
  hover.setAirport(() => airportFrame.status);
  const airportFeed = airportPreview ? undefined
    : startPoller<AirportResponse>("/api/airport", 2 * 60_000, (body) => { airportFrame.status = body.status; }, { maxMs: 20 * 60_000 });

  // Recent, identification-verified wildlife sightings, fading out over
  // a few days. ?wildlife=recent previews one from a few hours ago.
  const wildlifePreview = previewWildlife(new URLSearchParams(location.search).get("wildlife") ?? "");
  const wildlifeFrame: WildlifeFrame = { recent: wildlifePreview?.sightings ?? [], now: 0 };
  hover.setWildlife(() => wildlifeFrame.recent);
  const wildlifeFeed = wildlifePreview ? undefined
    : startPoller<WildlifeResponse>("/api/wildlife", 15 * 60_000, (body) => { wildlifeFrame.recent = body.sightings; }, { maxMs: 60 * 60_000 });

  // Recently reported crime in Minneapolis and Saint Paul, fading out over
  // a couple of days. Saint Paul gives only a district number, not a
  // point, so each of its incidents needs the district boundaries loaded
  // before it can be placed. ?crime=preview previews one from a few hours ago.
  const crimePreview = previewCrime(new URLSearchParams(location.search).get("crime") ?? "");
  let stPaulDistricts: StPaulDistricts = {};
  let crimeIncidents: CrimeIncident[] = crimePreview?.incidents ?? [];
  const crimeFrame: CrimeFrame = { recent: [], now: 0, daylight: sky.daylight };
  const resolveCrime = () => {
    crimeFrame.recent = crimeIncidents
      .map((c) => ({ c, position: crimePosition(c, stPaulDistricts) }))
      .filter((r): r is ResolvedCrime => !!r.position);
  };
  resolveCrime();
  hover.setCrime(() => crimeFrame.recent);
  loadStPaulDistricts().then((d) => { stPaulDistricts = d; resolveCrime(); }).catch((e) => console.warn(e));
  const crimeFeed = crimePreview ? undefined
    : startPoller<CrimeResponse>("/api/crime", 30 * 60_000, (body) => { crimeIncidents = body.incidents; resolveCrime(); }, { maxMs: 2 * 60 * 60_000 });

  // Gunfire calls in Minneapolis (shots fired, ShotSpotter, shootings),
  // fading out over a couple of days.
  const gunfireFrame: GunfireFrame = { recent: [], now: 0, daylight: sky.daylight };
  hover.setGunfire(() => gunfireFrame.recent);
  const gunfireFeed = startPoller<GunfireResponse>("/api/gunfire", 30 * 60_000, (body) => { gunfireFrame.recent = body.events; }, { maxMs: 2 * 60 * 60_000 });

  // Police drone flights (St. Paul, Brooklyn Park, Minnetonka, Duluth, St. Cloud,
  // Rochester), as fading flight paths, three hours behind and offset a little.
  const dronesFrame: DronesFrame = { recent: [], now: 0, daylight: sky.daylight };
  hover.setDrones(() => dronesFrame.recent);
  const dronesFeed = startPoller<DronesResponse>("/api/drones", 30 * 60_000, (body) => { dronesFrame.recent = body.flights; }, { maxMs: 2 * 60 * 60_000 });

  // MN DNR's fall color report, as a slow warm wash; quiet outside the
  // season. ?fallcolor=peak (or starting, changing, past) previews a level.
  const fallColorPreview = previewFallColor(new URLSearchParams(location.search).get("fallcolor") ?? "");
  const fallColor = new FallColorHaze(document.getElementById("fallcolor")!);
  let fallColorBody: FallColorResponse = fallColorPreview ?? { t: 0, samples: 0 };
  if (fallColorPreview) fallColor.set(fallColorPreview);
  const fallColorFeed = fallColorPreview ? undefined
    : startPoller<FallColorResponse>("/api/fallcolor", 60 * 60_000, (body) => { fallColorBody = body; fallColor.set(body); }, { maxMs: 4 * 60 * 60_000 });

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
    requestAnimationFrame(frame);
    if (!governor.shouldRun(nowMs)) return;
    governor.ran(nowMs);
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
    aurora.frame(map.getBearing());
    air.advance(dt, now);
    if (!still) {
      cars?.advance(dt, tf.readings);
      trains?.advance(dt);
      amtrak.advance(Date.now() / 1000);
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
    warningsFrame.now = now;
    gamesFrame.now = now;
    incidentsFrame.now = now;
    airportFrame.now = now;
    // These layers fade items by how long ago they were reported (real clock times), unlike the others, whose `now` only drives an animation.
    const wall = Date.now() / 1000;
    wildlifeFrame.now = wall;
    crimeFrame.now = wall;
    gunfireFrame.now = wall;
    dronesFrame.now = wall;
    overlay.setProps({
      // Planes fly above everything on the ground.
      layers: [
        ...(layersPanel.shown("warnings") ? warningLayers(warningsFrame, anchor) : []),
        ...(layersPanel.shown("games") ? gamesLayers(gamesFrame) : []),
        ...(layersPanel.shown("traffic") && freeways ? [trafficLayer(freeways, tf, anchor)] : []),
        ...(layersPanel.shown("traffic") && cars && !still ? carsLayer(cars, tf.daylight, map.getZoom()) : []),
        ...(layersPanel.shown("freight") && trains && !still ? trainLayers(trains.lines, trains.shapes, tf.daylight) : []),
        ...(layersPanel.shown("amtrak") && !still ? amtrakLayers(amtrak.trains, tf.daylight) : []),
        ...(layersPanel.shown("incidents") ? incidentsLayers(incidentsFrame, anchor) : []),
        ...(layersPanel.shown("beaches") ? beachesLayers(beachesFrame, anchor) : []),
        ...(layersPanel.shown("airport") ? airportLayers(airportFrame) : []),
        ...(layersPanel.shown("wildlife") ? wildlifeLayers(wildlifeFrame) : []),
        ...(layersPanel.shown("crime") ? crimeLayers(crimeFrame) : []),
        ...(layersPanel.shown("gunfire") ? gunfireLayers(gunfireFrame) : []),
        ...(layersPanel.shown("drones") ? droneLayers(dronesFrame) : []),
        ...(layersPanel.shown("cameras") ? cameraLayers(cameras, anchor) : []),
        ...(layersPanel.shown("snow") ? snowLayers(snowFrame, anchor) : []),
        ...(layersPanel.shown("transit") && !still ? trailLayers(transit, f) : []),
        ...(layersPanel.shown("transit") ? vehicleLayers(transit, f) : []),
        ...(layersPanel.shown("river") ? riverLayers(rf) : []),
        ...(layersPanel.shown("river") ? fallsLayers(fallsFrame) : []),
        ...(layersPanel.shown("planes") ? aircraftLayers(a) : []),
        // Satellites fly highest of all.
        ...(layersPanel.shown("satellites") ? satelliteLayers(sf) : []),
        ...pickLayers(fleet.list().filter((v) => v.alpha > 0.3), a.planes, f.version, sf.sats),
        ...hover.frame(now, f.version),
      ],
    });
  };
  requestAnimationFrame(frame);

  const feed = startFeed((feedTime, rows) => {
    fleet.update(feedTime, rows, performance.now() / 1000);
    fleet.prune(feedTime);
  });
  // Duluth's own buses, merged into the same Fleet as Metro Transit's.
  const dtaFeed = startDtaFeed((feedTime, rows) => {
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

  // Flag layers whose live data is failing, in the layers panel.
  const layerFeeds: [LayerKey, { status: FeedStatus } | undefined][] = [
    ["transit", feed], ["planes", airFeed], ["traffic", trafficFeed], ["incidents", incidentsFeed], ["river", riverFeed],
    ["warnings", warningsFeed], ["games", gamesFeed], ["beaches", beachesFeed], ["airport", airportFeed],
    ["wildlife", wildlifeFeed], ["snow", snowFeed], ["crime", crimeFeed], ["gunfire", gunfireFeed], ["drones", dronesFeed], ["amtrak", amtrakFeed],
  ];
  setInterval(() => layersPanel.setFailing(new Set(layerFeeds.filter(([, f]) => isDown(f?.status)).map(([k]) => k))), 2000);

  // Nobody is watching a hidden tab: stop polling, and catch up on return.
  document.addEventListener("visibilitychange", () => {
    const hidden = document.visibilityState === "hidden";
    for (const p of [feed, dtaFeed, airFeed, weatherFeed, trafficFeed, airQualityFeed, riverFeed, snowFeed, alertsFeed, warningsFeed, auroraFeed, gamesFeed, incidentsFeed, beachesFeed, airportFeed, wildlifeFeed, fallColorFeed, crimeFeed, gunfireFeed, dronesFeed, amtrakFeed]) if (!p) continue; else if (hidden) p.pause(); else p.resume();
  });

  startStatus(document.getElementById("status")!, fleet, feed, air, () => [fx.current && `${fx.current.summary} · ${fx.current.wind}`, airPhrase(haze.current), showerStatus(clock()), auroraPhrase(auroraKp, Math.floor(Date.now() / 1000)), airportPhrase(airportFrame.status), fallColorPhrase(fallColorBody)].filter(Boolean).join(" · ") || undefined, airFeed.status, () => sats.aboveHorizon);

  (window as unknown as { fromAbove: unknown }).fromAbove = {
    map, overlay, governor, transit, fleet, feed, dtaFeed, trails, air, airFeed, hover, drift, fx, haze, learnedLakes, tf,
    freeways: () => freeways, cameras: () => cameras, sats, sky: () => sky, moon, planets, snow,
    river: { rf, passages: () => passages, setPassages: (p: Passage[]) => { passages = p; placeBoats(); } },
    falls: { frame: fallsFrame, gauge: () => fallsGauge, setGauge: (g: Gauge) => { fallsGauge = g; fallsFrame.level = g.flowKcfs !== null ? flowLevel(g.flowKcfs * 1000) : "dry"; } },
    alerts, alertsFeed,
    warnings: { frame: warningsFrame, feed: warningsFeed },
    games: { frame: gamesFrame, feed: gamesFeed },
    incidents: { frame: incidentsFrame, feed: incidentsFeed },
    beaches: { frame: beachesFrame, feed: beachesFeed },
    airport: { frame: airportFrame, feed: airportFeed },
    wildlife: { frame: wildlifeFrame, feed: wildlifeFeed },
    crime: { frame: crimeFrame, feed: crimeFeed, districts: () => stPaulDistricts },
    gunfire: { frame: gunfireFrame, feed: gunfireFeed },
    drones: { frame: dronesFrame, feed: dronesFeed },
    rail: { freight: () => trains, amtrak, amtrakFeed },
    fallColor: { body: () => fallColorBody, feed: fallColorFeed },
    layersPanel,
    aurora: { strength: () => auroraKp, feed: auroraFeed },
    imagery: { opacity: () => map.getPaintProperty(IMAGERY_LAYER_ID, "raster-opacity") as number },
  };
});

(window as unknown as { fromAbove: unknown }).fromAbove = { map, overlay };
