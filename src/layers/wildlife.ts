import { ScatterplotLayer } from "@deck.gl/layers";
import { sightingStrength, type Sighting } from "../wildlife/sightings.ts";
import { FINGER } from "./hover.ts";

export interface WildlifeFrame {
  recent: Sighting[];
  now: number;
}

/** A tiny dot per recent sighting, fading out as it ages. Empty once everything's faded. */
export function wildlifeLayers(f: WildlifeFrame) {
  const live = f.recent.map((s) => ({ s, strength: sightingStrength(s, f.now) })).filter((x) => x.strength > 0);
  if (!live.length) return [];
  const common = { data: live, getPosition: (x: { s: Sighting }) => x.s.position };
  return [
    new ScatterplotLayer<{ s: Sighting; strength: number }>({
      ...common,
      id: "wildlife",
      getFillColor: (x) => [140, 190, 110, Math.round(200 * x.strength)],
      getRadius: 4,
      radiusUnits: "pixels",
      radiusMinPixels: 3,
      parameters: { depthCompare: "always" },
    }),
    new ScatterplotLayer<{ s: Sighting; strength: number }>({
      ...common,
      id: "pick-wildlife",
      pickable: true,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 13 * FINGER,
      parameters: { depthCompare: "always" },
    }),
  ];
}
