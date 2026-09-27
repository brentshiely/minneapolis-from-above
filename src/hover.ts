import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer, PickingInfo } from "@deck.gl/core";
import type { Fleet, Vehicle } from "./live/fleet.ts";
import type { AirFleet, Plane } from "./live/aircraft.ts";
import type { Transit } from "./transit/data.ts";
import { describePlane, describeVehicle, type Description, type FlightInfo } from "./describe.ts";
import { gaugeHighlight, planeHighlight, vehicleHighlight } from "./layers/hover.ts";
import { describeGauge, type Gauge, type GaugeDetail } from "./water/gauges.ts";
import { gaugeAt, learnLakeGauges } from "./water/match.ts";
import type { Freeways, Stretch } from "./traffic/freeways.ts";
import { describeStation, type Readings } from "./traffic/traffic.ts";
import type { Sat } from "./sky/satellites.ts";
import { describeSatellite, type SatcatRecord, type UcsRow } from "./sky/describe.ts";
import { LOCKS, describeLock, describePassage, type Boat, type Lock, type LockNo, type Passage } from "./river/river.ts";
import { riverHighlight } from "./layers/river.ts";

/** Wall-clock seconds (gauge readings carry real timestamps). */
const nowS_wall = () => Date.now() / 1000;

type Target =
  | { kind: "vehicle"; id: string }
  | { kind: "plane"; id: string }
  /** Water: the gauge that speaks for it, and where the cursor is. */
  | { kind: "water"; lid: string; at: [number, number] }
  /** A freeway: the sensor station for that stretch, and where the cursor is. */
  | { kind: "traffic"; station: string; at: [number, number] }
  | { kind: "satellite"; id: number }
  /** A boat that went through a lock lately, or the lock itself. */
  | { kind: "boat"; key: string }
  | { kind: "lock"; no: LockNo }
  /** The moon's glow at the edge of the map (a spot on screen, not the map). */
  | { kind: "moon" };

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
 * is, water to see its level, or the moon for its phase. The tooltip
 * follows its subject as it moves. On touch screens a tap pins it until
 * the next tap elsewhere.
 */
export class Hover {
  private target: Target | null = null;
  private pinned = false;
  private tip: HTMLElement;
  private lastText = "";
  private flights = new Map<string, FlightInfo | "pending">();
  private gauges: Gauge[] = [];
  private gaugeDetails = new Map<string, GaugeDetail | "pending">();
  private freeways?: Freeways;
  private readings: () => Readings = () => ({});
  private trafficTime: () => number = () => 0;

  private sats: () => Sat[] = () => [];
  private sunElevation: () => number = () => 0;
  private satcat = new Map<number, SatcatRecord | "pending">();
  private ucs?: Record<string, UcsRow> | "pending";

  private moon?: MoonSpot;
  setMoon(moon: MoonSpot) { this.moon = moon; }

  setSatellites(list: () => Sat[], sunElevation: () => number) { this.sats = list; this.sunElevation = sunElevation; }

  private boats: () => Boat[] = () => [];
  private passages: () => Passage[] = () => [];
  setRiver(boats: () => Boat[], passages: () => Passage[]) { this.boats = boats; this.passages = passages; }

  private satInfo(id: number): { catalog?: SatcatRecord; ucs?: UcsRow } {
    const c = this.satcat.get(id);
    if (c === undefined) {
      this.satcat.set(id, "pending");
      fetch(`/api/satinfo?id=${id}`).then((r) => (r.ok ? r.json() : {})).then((j: SatcatRecord) => this.satcat.set(id, j)).catch(() => this.satcat.set(id, {}));
    }
    if (this.ucs === undefined) {
      this.ucs = "pending";
      fetch("/data/ucs.json").then((r) => (r.ok ? r.json() : {})).then((j: Record<string, UcsRow>) => { this.ucs = j; }).catch(() => { this.ucs = {}; });
    }
    return {
      catalog: c && c !== "pending" ? c : undefined,
      ucs: this.ucs && this.ucs !== "pending" ? this.ucs[String(id)] : undefined,
    };
  }

  setFreeways(fw: Freeways, readings: () => Readings, trafficTime: () => number) {
    this.freeways = fw; this.readings = readings; this.trafficTime = trafficTime;
  }
  private map: MapLibreMap;
  private fleet: Fleet;
  private air: AirFleet;
  private transit: Transit;

  private daylight: () => number;

  constructor(map: MapLibreMap, overlay: MapboxOverlay, fleet: Fleet, air: AirFleet, transit: Transit, daylight: () => number = () => 0) {
    this.map = map; this.fleet = fleet; this.air = air; this.transit = transit; this.daylight = daylight;
    this.tip = document.getElementById("tip")!;
    overlay.setProps({
      onHover: (info: PickingInfo) => { if (!this.pinned) this.pick(info); },
      onClick: (info: PickingInfo) => {
        this.pick(info);
        this.pinned = this.target !== null;
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

  private pick(info: PickingInfo) {
    const obj = info.object as (Vehicle | Plane | undefined);
    let next: Target | null = null;
    if (obj && info.layer?.id === "pick-vehicles") next = { kind: "vehicle", id: (obj as Vehicle).id };
    else if (obj && info.layer?.id === "pick-planes") next = { kind: "plane", id: (obj as Plane).id };
    else if (obj && info.layer?.id === "pick-sats") next = { kind: "satellite", id: (obj as unknown as Sat).id };
    else if (obj && info.layer?.id === "pick-boats") next = { kind: "boat", key: (obj as unknown as Boat).key };
    else if (obj && info.layer?.id === "pick-locks") next = { kind: "lock", no: (obj as unknown as Lock).no };
    else if (obj && info.layer?.id === "traffic" && info.coordinate) {
      next = { kind: "traffic", station: (obj as unknown as Stretch).station, at: [info.coordinate[0], info.coordinate[1]] };
    }
    else if (this.moon?.hit(info.x, info.y)) next = { kind: "moon" };
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

  clear() {
    this.target = null;
    this.pinned = false;
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
    if (this.target.kind === "vehicle") {
      const v = this.fleet.vehicles.get(this.target.id);
      if (!v || v.alpha === 0) { this.clear(); return []; }
      const shape = v.motion.shape ?? this.transit.shapeForTrip(v.tripId);
      desc = describeVehicle({
        routeId: v.routeId, route: this.transit.routes[v.routeId], shape, vehicleId: v.id,
        ageS: this.fleet.feedTime - v.fixTime,
      });
      position = v.position;
      layers = vehicleHighlight(this.transit, v, version, this.daylight());
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
    } else if (this.target.kind === "traffic") {
      const info = this.freeways?.stations[this.target.station];
      if (!info) { this.clear(); return []; }
      desc = describeStation(info, this.readings()[this.target.station], nowS_wall() - this.trafficTime());
      position = this.target.at;
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
    const text = `${d.title}\n${d.detail ?? ""}\n${d.meta}`;
    if (text !== this.lastText) {
      this.lastText = text;
      const title = document.createElement("div");
      title.className = "tip-title";
      title.textContent = d.title;
      const parts: HTMLElement[] = [title];
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
