import { ScatterplotLayer } from "@deck.gl/layers";
import type { CarFlow } from "../traffic/cars.ts";
import { mixRgb } from "../color.ts";

/** Headlight-pale at night, a muted fleck by day -- a glint riding the congestion-colored road beneath it. */
const COLOR: [[number, number, number], [number, number, number]] = [[255, 241, 214], [70, 78, 90]];
const ALPHA: [number, number] = [210, 150];

/**
 * Zoomed out, tens of thousands of cars merge into a solid line that hides
 * the congestion color beneath; they fade in and shrink to single dots as
 * the map closes in on the road.
 */
const FADE_ZOOMS: [number, number] = [9.5, 13];
const FAR_FADE = 0.22;

export function carsLayer(flow: CarFlow, daylight: number, zoom: number) {
  if (!flow.count) return [];
  const color = mixRgb(COLOR[0], COLOR[1], daylight);
  const near = Math.min(1, Math.max(0, (zoom - FADE_ZOOMS[0]) / (FADE_ZOOMS[1] - FADE_ZOOMS[0])));
  const fade = FAR_FADE + (1 - FAR_FADE) * near;
  const alpha = (ALPHA[0] + (ALPHA[1] - ALPHA[0]) * daylight) * fade;
  return [
    new ScatterplotLayer({
      id: "cars",
      // Binary attributes: tens of thousands of cars, no per-car objects.
      data: { length: flow.count, attributes: { getPosition: { value: flow.positions, size: 2 } } },
      getFillColor: [...color, alpha],
      getRadius: 2.2,
      radiusUnits: "meters",
      radiusMinPixels: 0.9 + 0.5 * near,
      radiusMaxPixels: 3,
      parameters: { depthCompare: "always" },
      updateTriggers: { getFillColor: [daylight, zoom] },
    }),
  ];
}
