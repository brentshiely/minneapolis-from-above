import type { Mode, RouteInfo } from "./transit/data.ts";
import { hexToRgb, mixNumber, mixRgb, type RGB } from "./color.ts";

export type { RGB };
export { hexToRgb };

/**
 * Colors for everything drawn over the base map, at night and by day.
 * Each function takes `d`, the daylight level from 0 (night) to 1 (day).
 *
 * At night vehicles glow: bright, lifted colors with additive halos.
 * By day glow is invisible on a light map, so vehicles become crisp,
 * saturated dots with a white rim, and routes darken to read on paper.
 */

const GREY_BRT = "#8A8B8A";
const isGreyBrt = (r: RouteInfo) => r.color.toUpperCase() === GREY_BRT;

function lift([r, g, b]: RGB, amt: number): RGB {
  return [r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt].map(Math.round) as RGB;
}
function shade([r, g, b]: RGB, amt: number): RGB {
  return [r * (1 - amt), g * (1 - amt), b * (1 - amt)].map(Math.round) as RGB;
}

/** Local bus routes: one cool tone, so the network reads as a single fabric. */
const BUS_ROUTE: [RGB, RGB] = [[96, 140, 178], [92, 126, 160]];
/** Metro Transit brands the A–E lines grey; lift it at night, deepen it by day. */
const BRT_ROUTE_GREY: [RGB, RGB] = [[138, 150, 164], [112, 122, 134]];

export function routeColor(route: RouteInfo | undefined, d = 0): RGB {
  if (!route || route.mode === "bus") return mixRgb(BUS_ROUTE[0], BUS_ROUTE[1], d);
  if (isGreyBrt(route)) return mixRgb(BRT_ROUTE_GREY[0], BRT_ROUTE_GREY[1], d);
  const base = hexToRgb(route.color);
  return mixRgb(lift(base, route.mode === "rail" ? 0.4 : 0.2), shade(base, 0.05), d);
}

/**
 * Several shapes of one route often share a street (branches, short turns),
 * and translucent lines stack, so downtown corridors brighten on their own.
 * The pixel caps keep routes a thread under the vehicles at street zoom.
 */
export const ROUTE_STYLE: Record<Mode, { alpha: [number, number]; widthM: number; minPx: number; maxPx: number }> = {
  rail: { alpha: [220, 200], widthM: 6, minPx: 2.2, maxPx: 5 },
  brt: { alpha: [90, 120], widthM: 4, minPx: 1.3, maxPx: 3 },
  bus: { alpha: [40, 70], widthM: 3, minPx: 0.8, maxPx: 2.5 },
};

export const routeAlpha = (mode: Mode, d = 0) => mixNumber(ROUTE_STYLE[mode].alpha[0], ROUTE_STYLE[mode].alpha[1], d);

/** Buses: warm headlight amber at night, a deep burnt orange by day. */
const BUS_VEHICLE: [RGB, RGB] = [[255, 206, 138], [214, 104, 18]];
const BRT_VEHICLE_GREY: [RGB, RGB] = [[214, 224, 234], [64, 74, 88]];

/** Vehicles always read stronger than their routes, so motion reads first. */
export function vehicleColor(route: RouteInfo | undefined, d = 0): RGB {
  if (!route || route.mode === "bus") return mixRgb(BUS_VEHICLE[0], BUS_VEHICLE[1], d);
  if (isGreyBrt(route)) return mixRgb(BRT_VEHICLE_GREY[0], BRT_VEHICLE_GREY[1], d);
  const base = hexToRgb(route.color);
  return mixRgb(lift(base, 0.55), shade(base, 0.12), d);
}

/**
 * Planes: pale against the night sky, dark slate against the day map.
 * They switch over a short window late in the dawn blend rather than
 * fading through the same mid-tones as the map, where they'd vanish.
 */
function late(d: number): number {
  const x = Math.min(1, Math.max(0, (d - 0.62) / 0.2));
  return x * x * (3 - 2 * x);
}
export const planeColor = (d = 0): RGB => mixRgb([236, 241, 250], [40, 50, 64], late(d));
export const groundPlaneColor = (d = 0): RGB => mixRgb([170, 180, 194], [110, 118, 130], late(d));
