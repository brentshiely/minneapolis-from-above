import { ScatterplotLayer } from "@deck.gl/layers";
import type { Incident } from "../traffic/incidents.ts";
import { FINGER } from "./hover.ts";

export interface IncidentsFrame {
  active: Incident[];
  /** Page-clock seconds, for the marker's gentle pulse. */
  now: number;
}

const COLOR: Record<string, [number, number, number]> = {
  INCIDENT_CRASH: [220, 70, 60],
  INCIDENT_HAZARD: [230, 150, 60],
  INCIDENT_STALL: [230, 190, 90],
  INCIDENT_ROADWORK: [90, 140, 220],
  INCIDENT_CONSTRUCTION: [90, 140, 220],
};
const color = (type: string) => COLOR[type] ?? [190, 190, 190];

/** A small marker at each active incident, quietly pulsing. Empty on a clear day. */
export function incidentsLayers(f: IncidentsFrame, beforeId?: string) {
  if (!f.active.length) return [];
  const pulse = 0.65 + 0.35 * Math.sin(f.now * 1.6);
  const common = { data: f.active, getPosition: (x: Incident) => x.position, ...(beforeId ? { beforeId } : {}) };
  return [
    new ScatterplotLayer<Incident>({
      ...common,
      id: "incidents",
      getFillColor: (x) => [...color(x.type), Math.round(190 * pulse)],
      getLineColor: (x) => [...color(x.type), 255],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.2,
      getRadius: 6,
      radiusUnits: "pixels",
      radiusMinPixels: 5,
      parameters: { depthCompare: "always" },
      updateTriggers: { getFillColor: pulse },
    }),
    new ScatterplotLayer<Incident>({
      ...common,
      id: "pick-incidents",
      pickable: true,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 14 * FINGER,
      parameters: { depthCompare: "always" },
    }),
  ];
}
