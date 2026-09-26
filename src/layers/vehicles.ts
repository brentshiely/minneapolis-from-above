import { ScatterplotLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type { Mode, Transit } from "../transit/data.ts";
import type { Drawable } from "../live/fleet.ts";
import { TRAIL_S, type Trail } from "../live/trails.ts";
import { vehicleColor } from "../palette.ts";

interface ModeLook {
  /** Real-world radius in meters, and screen-size bounds. */
  radiusM: number; minPx: number; maxPx: number;
  /** Trail width in meters and minimum pixels; how long it lingers. */
  trailM: number; trailMinPx: number; trailS: number; trailAlpha: number;
  /** Halo strength (0-255) for the inner, middle and outer glow rings. */
  glow: [number, number, number];
}

/** Trains are the city's big movers: larger, longer trails, stronger glow. */
const LOOK: Record<Mode, ModeLook> = {
  rail: { radiusM: 16, minPx: 3.4, maxPx: 14, trailM: 8, trailMinPx: 2.4, trailS: TRAIL_S, trailAlpha: 200, glow: [56, 22, 9] },
  brt: { radiusM: 9, minPx: 2.6, maxPx: 10, trailM: 5, trailMinPx: 1.6, trailS: 70, trailAlpha: 150, glow: [40, 14, 6] },
  bus: { radiusM: 7, minPx: 2, maxPx: 8, trailM: 4, trailMinPx: 1.2, trailS: 60, trailAlpha: 130, glow: [30, 10, 0] },
};

/** Light adds up: overlapping glows brighten like real light, never darken. */
const ADDITIVE = {
  depthCompare: "always",
  blend: true,
  blendColorOperation: "add",
  blendColorSrcFactor: "src-alpha",
  blendColorDstFactor: "one",
  blendAlphaOperation: "add",
  blendAlphaSrcFactor: "one",
  blendAlphaDstFactor: "one-minus-src-alpha",
} as const;

export interface VehicleFrame {
  vehicles: Drawable[];
  trails: Trail[];
  /** Page clock in seconds. */
  now: number;
  /** Bumps whenever positions change, so deck.gl re-reads them. */
  version: number;
  /** Bumps whenever `trails` is rebuilt. */
  trailsVersion: number;
}

const colorOf = (transit: Transit) => (v: Drawable) => vehicleColor(transit.routes[v.routeId]);

export function trailLayers(transit: Transit, f: VehicleFrame) {
  const byMode: Record<Mode, Trail[]> = { bus: [], brt: [], rail: [] };
  for (const t of f.trails) byMode[t.vehicle.mode].push(t);
  const color = colorOf(transit);

  return (["bus", "brt", "rail"] as const).map((mode) => {
    const look = LOOK[mode];
    return new TripsLayer<Trail>({
      id: `trails-${mode}`,
      data: byMode[mode],
      getPath: (t) => t.path,
      getTimestamps: (t) => t.times,
      getColor: (t) => [...color(t.vehicle), look.trailAlpha * t.vehicle.alpha],
      getWidth: look.trailM,
      widthUnits: "meters",
      widthMinPixels: look.trailMinPx,
      widthMaxPixels: 8,
      capRounded: true,
      jointRounded: true,
      fadeTrail: true,
      trailLength: look.trailS,
      currentTime: f.now,
      parameters: ADDITIVE,
      updateTriggers: { getPath: f.trailsVersion, getTimestamps: f.trailsVersion, getColor: f.trailsVersion },
    });
  });
}

export function vehicleLayers(transit: Transit, f: VehicleFrame) {
  const byMode: Record<Mode, Drawable[]> = { bus: [], brt: [], rail: [] };
  for (const v of f.vehicles) if (v.alpha > 0) byMode[v.mode].push(v);
  const color = colorOf(transit);
  const layers = [];

  // Glow first (graded halos stacked additively read as a soft falloff),
  // then the vehicles on top.
  const GLOW_SCALE = [1.9, 3, 4.4];
  for (const mode of ["bus", "brt", "rail"] as const) {
    const look = LOOK[mode];
    look.glow.forEach((alpha, i) => {
      if (!alpha) return;
      const scale = GLOW_SCALE[i];
      layers.push(new ScatterplotLayer<Drawable>({
        id: `glow-${i}-${mode}`,
        data: byMode[mode],
        getPosition: (v) => v.position,
        getFillColor: (v) => [...color(v), alpha * v.alpha],
        getRadius: look.radiusM * scale,
        radiusUnits: "meters",
        radiusMinPixels: look.minPx * scale,
        radiusMaxPixels: look.maxPx * scale,
        parameters: ADDITIVE,
        updateTriggers: { getPosition: f.version, getFillColor: f.version },
      }));
    });
  }
  for (const mode of ["bus", "brt", "rail"] as const) {
    const look = LOOK[mode];
    layers.push(new ScatterplotLayer<Drawable>({
      id: `vehicles-${mode}`,
      data: byMode[mode],
      getPosition: (v) => v.position,
      getFillColor: (v) => [...color(v), 255 * v.alpha],
      getRadius: look.radiusM,
      radiusUnits: "meters",
      radiusMinPixels: look.minPx,
      radiusMaxPixels: look.maxPx,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: f.version, getFillColor: f.version },
    }));
  }
  return layers;
}
