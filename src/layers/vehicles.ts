import { ScatterplotLayer } from "@deck.gl/layers";
import type { Mode, Transit } from "../transit/data.ts";
import type { Vehicle } from "../live/fleet.ts";
import { vehicleColor } from "../palette.ts";

/** Real-world size in meters, and the smallest it may shrink to on screen. */
const SIZE: Record<Mode, { radiusM: number; minPx: number; maxPx: number }> = {
  rail: { radiusM: 16, minPx: 3.2, maxPx: 14 },
  brt: { radiusM: 9, minPx: 2.6, maxPx: 10 },
  bus: { radiusM: 7, minPx: 2, maxPx: 8 },
};

/** One layer per mode so trains stay bigger than buses at every zoom. */
export function vehicleLayers(transit: Transit, vehicles: Vehicle[], version: number) {
  const byMode: Record<Mode, Vehicle[]> = { bus: [], brt: [], rail: [] };
  for (const v of vehicles) byMode[v.mode].push(v);

  return (["bus", "brt", "rail"] as const).map((mode) => {
    const size = SIZE[mode];
    return new ScatterplotLayer<Vehicle>({
      id: `vehicles-${mode}`,
      data: byMode[mode],
      getPosition: (v) => v.position,
      getFillColor: (v) => [...vehicleColor(transit.routes[v.routeId]), 255],
      getRadius: size.radiusM,
      radiusUnits: "meters",
      radiusMinPixels: size.minPx,
      radiusMaxPixels: size.maxPx,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version, getFillColor: version },
    });
  });
}
