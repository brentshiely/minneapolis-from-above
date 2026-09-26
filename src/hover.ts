import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import type { Fleet, Vehicle } from "./live/fleet.ts";
import type { AirFleet, Plane } from "./live/aircraft.ts";
import type { Transit } from "./transit/data.ts";
import { describePlane, describeVehicle, type Description, type FlightInfo } from "./describe.ts";
import { planeHighlight, vehicleHighlight } from "./layers/hover.ts";

type Target = { kind: "vehicle"; id: string } | { kind: "plane"; id: string };

/**
 * Hover (or tap) a bus, train or plane to see what it is. The tooltip
 * follows its subject as it moves. On touch screens a tap pins it until
 * the next tap elsewhere.
 */
export class Hover {
  private target: Target | null = null;
  private pinned = false;
  private tip: HTMLElement;
  private lastText = "";
  private flights = new Map<string, FlightInfo | "pending">();
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
    map.getCanvas().addEventListener("mouseleave", () => { if (!this.pinned) this.clear(); });
  }

  private pick(info: PickingInfo) {
    const obj = info.object as (Vehicle | Plane | undefined);
    let next: Target | null = null;
    if (obj && info.layer?.id === "pick-vehicles") next = { kind: "vehicle", id: (obj as Vehicle).id };
    else if (obj && info.layer?.id === "pick-planes") next = { kind: "plane", id: (obj as Plane).id };
    this.target = next;
    this.map.getCanvas().style.cursor = next ? "pointer" : "";
    if (!next) this.hideTip();
  }

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
    let layers;
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

  private renderTip(d: Description, lngLat: [number, number]) {
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
    this.tip.hidden = false;
    const pt = this.map.project(lngLat);
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
