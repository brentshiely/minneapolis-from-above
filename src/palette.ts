import type { Mode, RouteInfo } from "./transit/data.ts";

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Local buses share one cool tone so the network reads as a single fabric. */
const BUS: RGB = [96, 140, 178];
/** Metro Transit brands the A–E lines grey; lift it so it reads at night. */
const BRT_GREY: RGB = [138, 150, 164];

/**
 * Light rail and the named BRT lines keep their real colors (Blue, Green,
 * Gold, Orange, Red), nudged brighter against the dark base.
 */
export function routeColor(route: RouteInfo | undefined): RGB {
  if (!route || route.mode === "bus") return BUS;
  if (route.color.toUpperCase() === "#8A8B8A") return BRT_GREY;
  return lift(hexToRgb(route.color), route.mode === "rail" ? 0.4 : 0.2);
}

function lift([r, g, b]: RGB, amt: number): RGB {
  return [r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt].map(Math.round) as RGB;
}

/**
 * Several shapes of one route often share a street (branches, short turns),
 * and translucent lines stack, so downtown corridors brighten on their own.
 * The pixel caps keep routes a thread under the vehicles at street zoom.
 */
export const ROUTE_STYLE: Record<Mode, { alpha: number; widthM: number; minPx: number; maxPx: number }> = {
  rail: { alpha: 220, widthM: 6, minPx: 2.2, maxPx: 5 },
  brt: { alpha: 90, widthM: 4, minPx: 1.3, maxPx: 3 },
  bus: { alpha: 40, widthM: 3, minPx: 0.8, maxPx: 2.5 },
};
