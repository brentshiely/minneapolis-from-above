import { ScatterplotLayer } from "@deck.gl/layers";
import type { Beach } from "../water/beaches.ts";
import { FINGER } from "./hover.ts";

export interface BeachesFrame {
  active: Beach[];
}

const OPEN: [number, number, number] = [80, 170, 210];
const CLOSED: [number, number, number] = [210, 90, 70];

/** A small static mark per beach currently in season. Empty most of the year. */
export function beachesLayers(f: BeachesFrame, beforeId?: string) {
  if (!f.active.length) return [];
  const common = { data: f.active, getPosition: (b: Beach) => b.position, ...(beforeId ? { beforeId } : {}) };
  return [
    new ScatterplotLayer<Beach>({
      ...common,
      id: "beaches",
      getFillColor: (b) => [...(b.status === "open" ? OPEN : CLOSED), 210],
      getLineColor: [255, 255, 255, 160],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1,
      getRadius: 6,
      radiusUnits: "pixels",
      radiusMinPixels: 5,
      parameters: { depthCompare: "always" },
    }),
    new ScatterplotLayer<Beach>({
      ...common,
      id: "pick-beaches",
      pickable: true,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 14 * FINGER,
      parameters: { depthCompare: "always" },
    }),
  ];
}
