import { ScatterplotLayer } from "@deck.gl/layers";
import { crimeStrength, type CrimeIncident } from "../crime/crime.ts";
import { mixRgb } from "../color.ts";
import { FINGER } from "./hover.ts";

export interface ResolvedCrime { c: CrimeIncident; position: [number, number] }

export interface CrimeFrame {
  recent: ResolvedCrime[];
  now: number;
  /** Daylight, 0 (night) to 1 (day). */
  daylight: number;
}

/** Informational, not an alarm: a quiet muted plum, never the warm reds used for live road incidents or warnings. */
const COLOR: [[number, number, number], [number, number, number]] = [[176, 140, 190], [122, 92, 138]];

export function crimeLayers(f: CrimeFrame, beforeId?: string) {
  const live = f.recent.map((r) => ({ ...r, strength: crimeStrength(r.c, f.now) })).filter((x) => x.strength > 0);
  if (!live.length) return [];
  const color = mixRgb(COLOR[0], COLOR[1], f.daylight);
  const common = { data: live, getPosition: (x: ResolvedCrime & { strength: number }) => x.position, ...(beforeId ? { beforeId } : {}) };
  return [
    new ScatterplotLayer<ResolvedCrime & { strength: number }>({
      ...common,
      id: "crime",
      getFillColor: (x) => [...color, Math.round(190 * x.strength)],
      getRadius: 2,
      radiusUnits: "pixels",
      radiusMinPixels: 1.5,
      parameters: { depthCompare: "always" },
      updateTriggers: { getFillColor: f.daylight },
    }),
    new ScatterplotLayer<ResolvedCrime & { strength: number }>({
      ...common,
      id: "pick-crime",
      pickable: true,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 13 * FINGER,
      parameters: { depthCompare: "always" },
    }),
  ];
}
