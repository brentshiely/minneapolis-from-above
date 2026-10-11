import { ScatterplotLayer } from "@deck.gl/layers";
import { gunfireStrength, type GunfireEvent } from "../gunfire/gunfire.ts";
import { mixRgb } from "../color.ts";
import { FINGER } from "./hover.ts";

export interface GunfireFrame {
  recent: GunfireEvent[];
  now: number;
  /** Daylight, 0 (night) to 1 (day). */
  daylight: number;
}

/** A warm ember, apart from crime's plum and the harder reds of road incidents and warnings: a ring around a dot, so it reads as an event. */
const COLOR: [[number, number, number], [number, number, number]] = [[236, 170, 124], [178, 98, 58]];

type Live = GunfireEvent & { strength: number };

export function gunfireLayers(f: GunfireFrame, beforeId?: string) {
  const live: Live[] = f.recent.map((e) => ({ ...e, strength: gunfireStrength(e, f.now) })).filter((x) => x.strength > 0);
  if (!live.length) return [];
  const color = mixRgb(COLOR[0], COLOR[1], f.daylight);
  const common = { data: live, getPosition: (x: Live) => x.position, ...(beforeId ? { beforeId } : {}) };
  return [
    new ScatterplotLayer<Live>({
      ...common,
      id: "gunfire",
      getFillColor: (x) => [...color, Math.round(200 * x.strength)],
      getLineColor: (x) => [...color, Math.round(150 * x.strength)],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.2,
      getRadius: 3.5,
      radiusUnits: "pixels",
      radiusMinPixels: 3,
      parameters: { depthCompare: "always" },
      updateTriggers: { getFillColor: f.daylight, getLineColor: f.daylight },
    }),
    // The halo: a larger, empty ring around each dot.
    new ScatterplotLayer<Live>({
      ...common,
      id: "gunfire-halo",
      filled: false,
      stroked: true,
      getLineColor: (x) => [...color, Math.round(110 * x.strength)],
      lineWidthUnits: "pixels",
      getLineWidth: 1,
      getRadius: 9,
      radiusUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getLineColor: f.daylight },
    }),
    new ScatterplotLayer<Live>({
      ...common,
      id: "pick-gunfire",
      pickable: true,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 13 * FINGER,
      parameters: { depthCompare: "always" },
    }),
  ];
}
