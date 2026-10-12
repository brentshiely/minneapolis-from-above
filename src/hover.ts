import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, PickingInfo } from "@deck.gl/core";
import type { Fleet, Vehicle } from "./live/fleet.ts";
import type { AirFleet, Plane } from "./live/aircraft.ts";
import type { Shape, Transit } from "./transit/data.ts";
import type { AlertInfo } from "./transit/alerts.ts";
import { describeAlert, describePlane, describeVehicle, type Description, type FlightInfo } from "./describe.ts";
import { gaugeHighlight, planeHighlight, vehicleHighlight } from "./layers/hover.ts";
import { describeGauge, type Gauge, type GaugeDetail } from "./water/gauges.ts";
import { gaugeAt, learnLakeGauges } from "./water/match.ts";
import type { Freeways, Stretch } from "./traffic/freeways.ts";
import { describeStation, type Readings } from "./traffic/traffic.ts";
import { describeFalls, FALLS_LOCATION } from "./water/falls.ts";
import { describeCamera, type CameraInfo } from "./traffic/cameras.ts";
import type { Sat } from "./sky/satellites.ts";
import { describeSatellite, type SatcatRecord, type UcsRow } from "./sky/describe.ts";
import { LOCKS, describeLock, describePassage, type Boat, type Lock, type LockNo, type Passage } from "./river/river.ts";
import { riverHighlight } from "./layers/river.ts";
import { routeRule, type City, type Stage } from "./snow/rules.ts";
import type { SnowRoute } from "./snow/routes.ts";
import type { PlanetsField } from "./planetlight.ts";
import type { PlanetName } from "./planets.ts";
import { describeWarning, type Warning } from "./weather/warnings.ts";
import { describeGame, VENUES, type GameStatus, type Venue } from "./sports/games.ts";
import { describeIncident, type Incident } from "./traffic/incidents.ts";
import { describeBeach, type Beach } from "./water/beaches.ts";
import { describeAirport, MSP_POSITION, type MspStatus } from "./airport.ts";
import { describeSighting, type Sighting } from "./wildlife/sightings.ts";
import { describeCrime } from "./crime/crime.ts";
import { describeGunfire, type GunfireEvent } from "./gunfire/gunfire.ts";
import { describeDrone, type DroneFlight } from "./drones/drones.ts";
import { describeFreight, type TrainShape, type RailLine } from "./rail/rail.ts";
import { describeAmtrak, type AmtrakTrain } from "./rail/amtrak.ts";
import type { ResolvedCrime } from "./layers/crime.ts";
import { dataUrl } from "./dataurl.ts";

/** Wall-clock seconds (gauge readings carry real timestamps). */
const nowS_wall = () => Date.now() / 1000;

/** The layers whose picked objects can sit almost on top of one another (a plane on approach over a bus). */
const MOVING_LAYER_IDS = ["pick-vehicles", "pick-planes"];
/** How far around the cursor to look for the real closest one, in screen pixels. */
const MOVING_PICK_RADIUS_PX = 8;

type Target =
  | { kind: "vehicle"; id: string }
  | { kind: "plane"; id: string }
  /** Water: the gauge that speaks for it, and where the cursor is. */
  | { kind: "water"; lid: string; at: [number, number] }
  /** A freeway: the sensor station for that stretch, and where the cursor is. */
  | { kind: "traffic"; station: string; at: [number, number] }
  /** A traffic camera. */
  | { kind: "camera"; name: string }
  | { kind: "satellite"; id: number }
  /** A boat that went through a lock lately, or the lock itself. */
  | { kind: "boat"; key: string }
  | { kind: "lock"; no: LockNo }
  /** The moon's glow at the edge of the map (a spot on screen, not the map). */
  | { kind: "moon" }
  /** A planet's glow at the edge of the map (a spot on screen, not the map). */
  | { kind: "planet"; name: PlanetName }
  /** A lit snow emergency route, and where the cursor is. */
  | { kind: "snow"; city: City; name: string; at: [number, number] }
  | { kind: "falls" }
  /** A shaded watch/warning area, and where the cursor is. */
  | { kind: "warning"; id: string; at: [number, number] }
  /** A venue currently playing a game. */
  | { kind: "game"; venue: Venue }
  /** A live freeway incident. */
  | { kind: "incident"; id: string }
  /** A swimming beach, in season. */
  | { kind: "beach"; id: string }
  /** MSP's own operating status. */
  | { kind: "airport" }
  /** A recent wildlife sighting. */
  | { kind: "wildlife"; id: number }
  /** A recently reported crime incident. */
  | { kind: "crime"; id: string }
  /** A recent gunfire call. */
  | { kind: "gunfire"; id: string }
  /** A recent police drone flight, and where the cursor is on it. */
  | { kind: "drone"; id: string; at: [number, number] }
  /** A simulated freight train. */
  | { kind: "freight"; id: number }
  /** An Amtrak train, by Amtraker's id for this run. */
  | { kind: "amtrak"; id: string };

/** The moon, as the hover sees it: a spot on screen that can describe itself. */
export interface MoonSpot {
  hit(x: number, y: number): boolean;
  anchor(): [number, number];
  describe(): Description | undefined;
}

/** How often to refresh the list of river and lake gauges. */
const GAUGE_REFRESH_MS = 10 * 60_000;

/**
 * Hover (or tap) a bus, train, plane, satellite or boat to see what it
 * is, water to see its level, a lit snow emergency route for today's
 * parking rule, or the moon for its phase. The tooltip
 * follows its subject as it moves. On touch screens a tap pins it until
 * the next tap elsewhere.
 */
export class Hover {
  private target: Target | null = null;
  private pinned = false;
  /** Page-clock ms when the tooltip was pinned open, or 0. */
  private pinnedAt = 0;
  private tip: HTMLElement;
  private lastText = "";
  private flights = new Map<string, FlightInfo | "pending">();
  private gauges: Gauge[] = [];
  private gaugeDetails = new Map<string, GaugeDetail | "pending">();
  private freeways?: Freeways;
  private readings: () => Readings = () => ({});
  private estimated: (station: string) => boolean = () => false;
  private trafficTime: () => number = () => 0;

  private sats: () => Sat[] = () => [];
  private sunElevation: () => number = () => 0;
  private satcat = new Map<number, SatcatRecord | "pending">();
  private ucs?: Record<string, UcsRow> | "pending";

  private moon?: MoonSpot;
  setMoon(moon: MoonSpot) { this.moon = moon; }

  private planets?: PlanetsField;
  setPlanets(planets: PlanetsField) { this.planets = planets; }

  setSatellites(list: () => Sat[], sunElevation: () => number) { this.sats = list; this.sunElevation = sunElevation; }

  private boats: () => Boat[] = () => [];
  private passages: () => Passage[] = () => [];
  setRiver(boats: () => Boat[], passages: () => Passage[]) { this.boats = boats; this.passages = passages; }
  private snowStage: (city: City) => Stage | undefined = () => undefined;
  setSnow(stage: (city: City) => Stage | undefined) { this.snowStage = stage; }
  private alerts: () => Map<string, AlertInfo> = () => new Map();
  setAlerts(affected: () => Map<string, AlertInfo>) { this.alerts = affected; }

  private fallsGauge: () => Gauge | undefined = () => undefined;
  setFalls(gauge: () => Gauge | undefined) { this.fallsGauge = gauge; }
  private warnings: () => Warning[] = () => [];
  setWarnings(list: () => Warning[]) { this.warnings = list; }
  private games: () => GameStatus[] = () => [];
  setGames(list: () => GameStatus[]) { this.games = list; }
  private incidents: () => Incident[] = () => [];
  setIncidents(list: () => Incident[]) { this.incidents = list; }
  private beaches: () => Beach[] = () => [];
  setBeaches(list: () => Beach[]) { this.beaches = list; }
  private airportStatus: () => MspStatus[] = () => [];
  setAirport(list: () => MspStatus[]) { this.airportStatus = list; }
  private sightings: () => Sighting[] = () => [];
  setWildlife(list: () => Sighting[]) { this.sightings = list; }
  private crimes: () => ResolvedCrime[] = () => [];
  setCrime(list: () => ResolvedCrime[]) { this.crimes = list; }
  private gunfire: () => GunfireEvent[] = () => [];
  setGunfire(list: () => GunfireEvent[]) { this.gunfire = list; }
  private freight: () => TrainShape[] = () => [];
  setFreight(list: () => TrainShape[]) { this.freight = list; }
  private amtrak: () => AmtrakTrain[] = () => [];
  setAmtrak(list: () => AmtrakTrain[]) { this.amtrak = list; }
  private drones: () => DroneFlight[] = () => [];
  setDrones(list: () => DroneFlight[]) { this.drones = list; }

  private satInfo(id: number): { catalog?: SatcatRecord; ucs?: UcsRow } {
    const c = this.satcat.get(id);
    if (c === undefined) {
      this.satcat.set(id, "pending");
      fetch(`/api/satinfo?id=${id}`).then((r) => (r.ok ? r.json() : {})).then((j: SatcatRecord) => this.satcat.set(id, j)).catch(() => this.satcat.set(id, {}));
    }
    if (this.ucs === undefined) {
      this.ucs = "pending";
      fetch(dataUrl("ucs.json")).then((r) => (r.ok ? r.json() : {})).then((j: Record<string, UcsRow>) => { this.ucs = j; }).catch(() => { this.ucs = {}; });
    }
    return {
      catalog: c && c !== "pending" ? c : undefined,
      ucs: this.ucs && this.ucs !== "pending" ? this.ucs[String(id)] : undefined,
    };
  }

  setFreeways(fw: Freeways, readings: () => Readings, trafficTime: () => number, estimated: (station: string) => boolean = () => false) {
    this.freeways = fw; this.readings = readings; this.trafficTime = trafficTime; this.estimated = estimated;
  }
  private cameras = new Map<string, CameraInfo>();
  setCameras(cameras: CameraInfo[]) { this.cameras = new Map(cameras.map((c) => [c.name, c])); }
  private map: MapLibreMap;
  private overlay: MapboxOverlay;
  private fleet: Fleet;
  private air: AirFleet;
  private transit: Transit;

  private daylight: () => number;

  constructor(map: MapLibreMap, overlay: MapboxOverlay, fleet: Fleet, air: AirFleet, transit: Transit, daylight: () => number = () => 0) {
    this.map = map; this.overlay = overlay; this.fleet = fleet; this.air = air; this.transit = transit; this.daylight = daylight;
    this.tip = document.getElementById("tip")!;
    overlay.setProps({
      onHover: (info: PickingInfo) => { if (!this.pinned) this.pick(info); },
      onClick: (info: PickingInfo) => {
        this.pick(info);
        this.pinned = this.target !== null;
        this.pinnedAt = this.pinned ? performance.now() : 0;
      },
    });
    addEventListener("keydown", (e) => { if (e.key === "Escape") this.clear(); });
    // Refresh gauges every 10 minutes; after a failed load, try again in 30 s.
    const loadGauges = () => {
      fetch("/api/water")
        .then((r) => (r.ok ? (r.json() as Promise<{ gauges?: Gauge[] }>) : undefined))
        .then((b) => {
          if (!b?.gauges || (b as { unavailable?: string }).unavailable) throw new Error("no gauges");
          this.gauges = b.gauges;
          this.gaugeDetails.clear();
          learnLakeGauges(map, this.gauges);
          setTimeout(loadGauges, GAUGE_REFRESH_MS);
        })
        .catch(() => setTimeout(loadGauges, 60_000));
    };
    loadGauges();
    // Learn which lake each lake gauge sits on as its area loads. Not on the
    // map's "idle" event: with animation running it fires ~55 times a second.
    const learner = setInterval(() => {
      if (this.gauges.length && learnLakeGauges(map, this.gauges) === 0) clearInterval(learner);
    }, 5000);
    setInterval(loadGauges, GAUGE_REFRESH_MS);
    map.getCanvas().addEventListener("mouseleave", () => { if (!this.pinned) this.clear(); });
  }

  /**
   * Planes fly low right over the freeways and streets they're landing
   * near, so a plane's marker and a bus's can land within a pixel of each
   * other on screen. Exact-pixel picking then just returns whichever was
   * drawn last, which can flicker between the two as they drift past one
   * another. Re-resolve by the real, currently closer marker instead.
   */
  private nearestMovingTarget(info: PickingInfo): { kind: "vehicle"; id: string } | { kind: "plane"; id: string } | null {
    if (info.x === undefined || info.y === undefined) return null;
    const candidates = this.overlay.pickMultipleObjects({
      x: info.x, y: info.y, radius: MOVING_PICK_RADIUS_PX, layerIds: MOVING_LAYER_IDS,
    });
    let best: ({ kind: "vehicle"; id: string } | { kind: "plane"; id: string }) & { d: number } | null = null;
    for (const c of candidates) {
      if (!c.object) continue;
      const isPlane = c.layer?.id === "pick-planes";
      const pos = (isPlane ? (c.object as Plane).position : (c.object as Vehicle).position) as [number, number];
      const screen = this.map.project(pos);
      const d = Math.hypot(screen.x - info.x, screen.y - info.y);
      if (!best || d < best.d) {
        best = isPlane
          ? { kind: "plane", id: (c.object as Plane).id, d }
          : { kind: "vehicle", id: (c.object as Vehicle).id, d };
      }
    }
    return best;
  }

  private pick(info: PickingInfo) {
    const obj = info.object as (Vehicle | Plane | undefined);
    let next: Target | null = null;
    if (obj && (info.layer?.id === "pick-vehicles" || info.layer?.id === "pick-planes")) {
      next = this.nearestMovingTarget(info)
        ?? (info.layer!.id === "pick-vehicles" ? { kind: "vehicle", id: (obj as Vehicle).id } : { kind: "plane", id: (obj as Plane).id });
    }
    else if (obj && (info.layer?.id === "pick-sats" || info.layer?.id === "pick-sat-tracks")) next = { kind: "satellite", id: (obj as unknown as Sat).id };
    else if (obj && info.layer?.id === "pick-boats") next = { kind: "boat", key: (obj as unknown as Boat).key };
    else if (obj && info.layer?.id === "pick-locks") next = { kind: "lock", no: (obj as unknown as Lock).no };
    else if (obj && (info.layer?.id === "snow-routes" || info.layer?.id === "snow-halo") && info.coordinate) {
      const r = obj as unknown as SnowRoute;
      next = { kind: "snow", city: r.city, name: r.name, at: [info.coordinate[0], info.coordinate[1]] };
    }
    else if (obj && info.layer?.id === "pick-falls") next = { kind: "falls" };
    else if (obj && info.layer?.id === "warnings" && info.coordinate) {
      const w = obj as unknown as { properties: Warning };
      next = { kind: "warning", id: w.properties.id, at: [info.coordinate[0], info.coordinate[1]] };
    }
    else if (obj && info.layer?.id === "pick-games") next = { kind: "game", venue: (obj as unknown as GameStatus).venue };
    else if (obj && info.layer?.id === "pick-incidents") next = { kind: "incident", id: (obj as unknown as Incident).id };
    else if (obj && info.layer?.id === "pick-beaches") next = { kind: "beach", id: (obj as unknown as Beach).id };
    else if (obj && info.layer?.id === "pick-airport") next = { kind: "airport" };
    else if (obj && info.layer?.id === "pick-wildlife") next = { kind: "wildlife", id: (obj as unknown as { s: Sighting }).s.id };
    else if (obj && info.layer?.id === "pick-crime") next = { kind: "crime", id: (obj as unknown as ResolvedCrime).c.id };
    else if (obj && info.layer?.id === "pick-gunfire") next = { kind: "gunfire", id: (obj as unknown as GunfireEvent).id };
    else if (obj && info.layer?.id === "pick-freight") next = { kind: "freight", id: (obj as unknown as TrainShape).id };
    else if (obj && info.layer?.id === "pick-amtrak") next = { kind: "amtrak", id: (obj as unknown as AmtrakTrain).row.id };
    else if (obj && info.layer?.id === "pick-drones" && info.coordinate) next = { kind: "drone", id: (obj as unknown as { flight: DroneFlight }).flight.id, at: [info.coordinate[0], info.coordinate[1]] };
    else if (obj && info.layer?.id === "traffic" && info.coordinate) {
      next = { kind: "traffic", station: (obj as unknown as Stretch).station, at: [info.coordinate[0], info.coordinate[1]] };
    }
    else if (obj && info.layer?.id === "pick-cameras") next = { kind: "camera", name: (obj as unknown as CameraInfo).name };
    else if (this.moon?.hit(info.x, info.y)) next = { kind: "moon" };
    else if (this.planets?.hit(info.x, info.y) !== undefined) next = { kind: "planet", name: this.planets.hit(info.x, info.y)! };
    else if (info.coordinate && this.gauges.length) {
      // Nothing moving under the cursor: is it water with a gauge?
      const at: [number, number] = [info.coordinate[0], info.coordinate[1]];
      const g = gaugeAt(this.map, info.x, info.y, at, this.gauges);
      if (g) next = { kind: "water", lid: g.lid, at };
    }
    this.target = next;
    this.map.getCanvas().style.cursor = next ? "pointer" : "";
    if (!next) this.hideTip();
  }

  /** True while a tooltip is pinned open by a tap. */
  get pinnedOpen() { return this.pinned && this.target !== null; }

  /** Seconds the pinned tooltip has been open, or 0 when none is. */
  get pinnedForS() { return this.pinnedOpen && this.pinnedAt ? (performance.now() - this.pinnedAt) / 1000 : 0; }

  clear() {
    this.target = null;
    this.pinned = false;
    this.pinnedAt = 0;
    this.map.getCanvas().style.cursor = "";
    this.hideTip();
  }

  private hideTip() {
    this.tip.hidden = true;
    this.lastText = "";
  }

  private gaugeDetail(lid: string): GaugeDetail | undefined {
    const cached = this.gaugeDetails.get(lid);
    if (cached === "pending") return undefined;
    if (cached) return cached;
    this.gaugeDetails.set(lid, "pending");
    fetch(`/api/water?lid=${lid}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: GaugeDetail) => this.gaugeDetails.set(lid, d))
      .catch(() => this.gaugeDetails.set(lid, {}));
    return undefined;
  }

  private flightInfo(p: Plane): FlightInfo | undefined {
    const key = `${p.callsign}|${p.id}`;
    const cached = this.flights.get(key);
    if (cached === "pending") return undefined;
    if (cached) return cached;
    this.flights.set(key, "pending");
    const q = new URLSearchParams();
    if (/^[A-Z0-9]{2,8}$/.test(p.callsign)) q.set("callsign", p.callsign);
    q.set("hex", p.id);
    fetch(`/api/flight?${q}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((info: FlightInfo) => this.flights.set(key, info))
      .catch(() => this.flights.set(key, {}));
    return undefined;
  }

  /** Called every frame: returns highlight layers and moves the tooltip. */
  frame(nowS: number, version: number) {
    if (!this.target) return [];
    let desc: Description;
    let position: [number, number];
    let layers: Layer[];
    if (this.target.kind === "moon") {
      const d = this.moon?.describe();
      if (!d) { this.clear(); return []; }
      this.renderTip(d, this.moon!.anchor(), true);
      return [];
    }
    if (this.target.kind === "planet") {
      const d = this.planets?.describe(this.target.name);
      if (!d) { this.clear(); return []; }
      this.renderTip(d, this.planets!.anchor(this.target.name), true);
      return [];
    }
    if (this.target.kind === "vehicle") {
      const v = this.fleet.vehicles.get(this.target.id);
      if (!v || v.alpha === 0) { this.clear(); return []; }
      const shape = v.motion.shape ?? this.transit.shapeForTrip(v.tripId);
      desc = describeVehicle({
        routeId: v.routeId, route: this.transit.routes[v.routeId], shape, vehicleId: v.id,
        ageS: this.fleet.feedTime - v.fixTime,
      });
      position = v.position;
      // A route with a live service alert: trace it dashed and add the notice.
      const alert = this.alerts().get(v.routeId);
      if (alert) desc = { ...desc, detail: [desc.detail, describeAlert(v.routeId, this.transit.routes[v.routeId], alert).title, alert.header.trim()].filter(Boolean).join(" ") };
      layers = vehicleHighlight(this.transit, v, shape, version, this.daylight(), !!alert);
    } else if (this.target.kind === "satellite") {
      const id = this.target.id;
      const sat = this.sats().find((x) => x.id === id);
      if (!sat) { this.clear(); return []; }
      desc = describeSatellite({ id, name: sat.name, kind: sat.kind, live: sat.live, sunElevation: this.sunElevation(), ...this.satInfo(id) });
      position = sat.position;
      layers = [];
    } else if (this.target.kind === "boat") {
      const key = this.target.key;
      const boat = this.boats().find((b) => b.key === key);
      if (!boat) { this.clear(); return []; }
      desc = describePassage(boat.p, nowS_wall());
      position = boat.position;
      layers = riverHighlight(boat.position, this.daylight());
    } else if (this.target.kind === "lock") {
      const lock = LOCKS[this.target.no];
      desc = describeLock(lock, this.passages(), nowS_wall());
      position = lock.at;
      layers = riverHighlight(lock.at, this.daylight());
    } else if (this.target.kind === "falls") {
      desc = describeFalls(this.fallsGauge(), nowS_wall());
      position = FALLS_LOCATION;
      layers = [];
    } else if (this.target.kind === "snow") {
      const stage = this.snowStage(this.target.city);
      if (!stage) { this.clear(); return []; }
      desc = routeRule(stage, this.target.name || undefined);
      position = this.target.at;
      layers = [];
    } else if (this.target.kind === "warning") {
      const id = this.target.id;
      const w = this.warnings().find((x) => x.id === id);
      if (!w) { this.clear(); return []; }
      desc = describeWarning(w);
      position = this.target.at;
      layers = [];
    } else if (this.target.kind === "game") {
      const venue = this.target.venue;
      const g = this.games().find((x) => x.venue === venue);
      if (!g) { this.clear(); return []; }
      desc = describeGame(g);
      position = VENUES[venue].position;
      layers = [];
    } else if (this.target.kind === "incident") {
      const id = this.target.id;
      const x = this.incidents().find((i) => i.id === id);
      if (!x) { this.clear(); return []; }
      desc = describeIncident(x, nowS_wall());
      position = x.position;
      layers = [];
    } else if (this.target.kind === "beach") {
      const id = this.target.id;
      const b = this.beaches().find((x) => x.id === id);
      if (!b) { this.clear(); return []; }
      desc = describeBeach(b);
      position = b.position;
      layers = [];
    } else if (this.target.kind === "airport") {
      desc = describeAirport(this.airportStatus());
      position = MSP_POSITION;
      layers = [];
    } else if (this.target.kind === "wildlife") {
      const id = this.target.id;
      const s = this.sightings().find((x) => x.id === id);
      if (!s) { this.clear(); return []; }
      desc = describeSighting(s, nowS_wall());
      position = s.position;
      layers = [];
    } else if (this.target.kind === "crime") {
      const id = this.target.id;
      const r = this.crimes().find((x) => x.c.id === id);
      if (!r) { this.clear(); return []; }
      desc = describeCrime(r.c, nowS_wall());
      position = r.position;
      layers = [];
    } else if (this.target.kind === "gunfire") {
      const id = this.target.id;
      const e = this.gunfire().find((x) => x.id === id);
      if (!e) { this.clear(); return []; }
      desc = describeGunfire(e, nowS_wall());
      position = e.position;
      layers = [];
    } else if (this.target.kind === "drone") {
      const id = this.target.id;
      const f = this.drones().find((x) => x.id === id);
      if (!f) { this.clear(); return []; }
      desc = describeDrone(f, nowS_wall());
      position = this.target.at;
      layers = [];
    } else if (this.target.kind === "freight") {
      const id = this.target.id;
      const t = this.freight().find((x) => x.id === id);
      if (!t) { this.clear(); return []; }
      desc = describeFreight(t.line);
      position = t.path[t.path.length - 1];
      layers = [];
    } else if (this.target.kind === "amtrak") {
      const id = this.target.id;
      const t = this.amtrak().find((x) => x.row.id === id);
      if (!t) { this.clear(); return []; }
      desc = describeAmtrak(t.row, nowS_wall());
      position = t.path[t.path.length - 1];
      layers = [];
    } else if (this.target.kind === "traffic") {
      const info = this.freeways?.stations[this.target.station];
      if (!info) { this.clear(); return []; }
      desc = describeStation(info, this.readings()[this.target.station], nowS_wall() - this.trafficTime(), this.estimated(this.target.station));
      position = this.target.at;
      layers = [];
    } else if (this.target.kind === "camera") {
      const cam = this.cameras.get(this.target.name);
      if (!cam) { this.clear(); return []; }
      desc = describeCamera(cam, Date.now());
      position = [cam.lon, cam.lat];
      layers = [];
    } else if (this.target.kind === "water") {
      const lid = this.target.lid;
      const g = this.gauges.find((x) => x.lid === lid);
      if (!g) { this.clear(); return []; }
      desc = describeGauge(g, this.gaugeDetail(lid), nowS_wall());
      position = this.target.at;
      layers = gaugeHighlight(g, this.daylight());
    } else {
      const p = this.air.planes.get(this.target.id);
      if (!p || p.alpha === 0) { this.clear(); return []; }
      desc = describePlane({
        callsign: p.callsign, registration: p.registration, type: p.type, altFt: p.altFt, onGround: p.onGround,
        speedKt: p.speedKt, verticalFpm: p.verticalFpm, heading: p.heading, position: p.position,
        ageS: nowS - p.fixAt,
      }, this.flightInfo(p));
      position = p.position;
      layers = planeHighlight(p, version, this.daylight());
    }
    this.renderTip(desc, position);
    return layers;
  }

  /** `at` is a place on the map, or with `onScreen`, a point in the window. */
  private renderTip(d: Description, at: [number, number], onScreen = false) {
    const text = `${d.title}\n${d.detail ?? ""}\n${d.meta}\n${d.image ?? ""}`;
    if (text !== this.lastText) {
      this.lastText = text;
      const parts: HTMLElement[] = [];
      if (d.image) {
        const img = document.createElement("img");
        img.className = "tip-image";
        img.src = d.image;
        img.alt = "";
        // A dead or blocked snapshot shouldn't leave a broken-image glyph.
        img.addEventListener("error", () => img.remove(), { once: true });
        parts.push(img);
      }
      const title = document.createElement("div");
      title.className = "tip-title";
      title.textContent = d.title;
      parts.push(title);
      if (d.detail) {
        const detail = document.createElement("div");
        detail.className = "tip-detail";
        detail.textContent = d.detail;
        parts.push(detail);
      }
      const meta = document.createElement("div");
      meta.className = "tip-meta";
      meta.textContent = d.meta;
      parts.push(meta);
      this.tip.replaceChildren(...parts);
    }
    const pt = onScreen ? { x: at[0], y: at[1] } : this.map.project(at);
    // When the camera moves its subject off screen (drift, a jump, a zoom),
    // hide the tooltip rather than leave it describing something unseen.
    if (pt.x < -8 || pt.y < -8 || pt.x > innerWidth + 8 || pt.y > innerHeight + 8) {
      this.tip.hidden = true;
      return;
    }
    this.tip.hidden = false;
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    const vw = innerWidth, vh = innerHeight;
    // Up and to the right of the subject, flipped to stay on screen.
    let x = pt.x + 22, y = pt.y - h - 14;
    if (x + w > vw - 8) x = pt.x - w - 22;
    if (y < 8) y = pt.y + 22;
    x = Math.max(8, Math.min(vw - w - 8, x));
    y = Math.max(8, Math.min(vh - h - 8, y));
    this.tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
