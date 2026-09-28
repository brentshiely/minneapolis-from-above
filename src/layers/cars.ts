import { ScatterplotLayer } from "@deck.gl/layers";
import type { CarDot } from "../traffic/cars.ts";
import { mixRgb } from "../color.ts";

/** Headlight-pale at night, a muted fleck by day -- a glint riding the congestion-colored road beneath it. */
const COLOR: [[number, number, number], [number, number, number]] = [[255, 241, 214], [70, 78, 90]];
const ALPHA: [number, number] = [210, 150];

export function carsLayer(dots: CarDot[], daylight: number, version: number) {
  if (!dots.length) return [];
  const color = mixRgb(COLOR[0], COLOR[1], daylight);
  const alpha = ALPHA[0] + (ALPHA[1] - ALPHA[0]) * daylight;
  return [
    new ScatterplotLayer<CarDot>({
      id: "cars",
      data: dots,
      getPosition: (c) => c.position,
      getFillColor: [...color, alpha],
      getRadius: 3.2,
      radiusUnits: "meters",
      radiusMinPixels: 1.4,
      radiusMaxPixels: 3,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version, getFillColor: daylight },
    }),
  ];
}
