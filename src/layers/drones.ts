import { PathLayer } from "@deck.gl/layers";
import { droneStrength, type DroneFlight } from "../drones/drones.ts";
import { mixRgb } from "../color.ts";
import { FINGER } from "./hover.ts";

export interface DronesFrame {
  recent: DroneFlight[];
  now: number;
  /** Daylight, 0 (night) to 1 (day). */
  daylight: number;
}

/** Cool and thin, apart from the warm layers: a drone's flight reads as a line drawn across the city, not a place marked. */
const COLOR: [[number, number, number], [number, number, number]] = [[132, 206, 236], [28, 108, 150]];

type Leg = { flight: DroneFlight; path: [number, number][]; strength: number };

export function droneLayers(f: DronesFrame, beforeId?: string) {
  const legs: Leg[] = [];
  for (const flight of f.recent) {
    const strength = droneStrength(flight, f.now);
    if (strength > 0) for (const path of flight.paths) legs.push({ flight, path, strength });
  }
  if (!legs.length) return [];
  const color = mixRgb(COLOR[0], COLOR[1], f.daylight);
  const common = { data: legs, getPath: (x: Leg) => x.path, jointRounded: true, capRounded: true, parameters: { depthCompare: "always" as const }, ...(beforeId ? { beforeId } : {}) };
  return [
    new PathLayer<Leg>({
      ...common,
      id: "drones",
      getColor: (x) => [...color, Math.round(190 * x.strength)],
      getWidth: 1.6,
      widthUnits: "pixels",
      updateTriggers: { getColor: f.daylight },
    }),
    // A wide, invisible line to hover: a thin one is hard to land on.
    new PathLayer<Leg>({
      ...common,
      id: "pick-drones",
      pickable: true,
      getColor: [0, 0, 0, 1],
      getWidth: 14 * FINGER,
      widthUnits: "pixels",
    }),
  ];
}
