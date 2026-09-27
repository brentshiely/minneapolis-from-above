import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import { FALLS_ICON } from "../icons.ts";
import { FALLS_LOCATION, shimmerStrength, type FlowLevel } from "../water/falls.ts";
import { mixRgb } from "../color.ts";
import { FINGER } from "./hover.ts";

export interface FallsFrame {
  level: FlowLevel;
  daylight: number;
  /** Page-clock seconds, for the shimmer's gentle pulse. */
  now: number;
}

/** A single fixed landmark: the icon, a soft shimmer when it's really running, and its hit area. */
export function fallsLayers(f: FallsFrame) {
  const d = f.daylight;
  const ink = mixRgb([200, 226, 245], [40, 90, 130], d);
  const strength = shimmerStrength(f.level);
  const pulse = 0.6 + 0.4 * Math.sin(f.now * 1.6);
  return [
    ...(strength > 0
      ? [
        new ScatterplotLayer({
          id: "falls-shimmer",
          data: [FALLS_LOCATION],
          getPosition: (p: [number, number]) => p,
          getFillColor: [...ink, Math.round(70 * strength * pulse)],
          getRadius: 20,
          radiusUnits: "pixels",
          parameters: { depthCompare: "always" },
        }),
      ]
      : []),
    new IconLayer({
      id: "falls",
      data: [FALLS_LOCATION],
      getIcon: () => FALLS_ICON,
      getPosition: (p: [number, number]) => p,
      getSize: 22,
      sizeUnits: "pixels",
      billboard: true, // face the camera; a flat "sticker on the ground" icon foreshortens to a sliver when the drift camera pitches
      getColor: [...ink, 235],
      parameters: { depthCompare: "always" },
    }),
    new ScatterplotLayer({
      id: "pick-falls",
      data: [FALLS_LOCATION],
      pickable: true,
      getPosition: (p: [number, number]) => p,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 14 * FINGER,
      parameters: { depthCompare: "always" },
    }),
  ];
}
