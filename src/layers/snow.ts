import { PathLayer } from "@deck.gl/layers";
import type { SnowRoute } from "../snow/routes.ts";
import { mixNumber, mixRgb, type RGB } from "../color.ts";

/**
 * Snow emergency routes, lit only while a city has declared one. Ice white
 * against the night map, a deep glacier teal on the day map: cold, clearly
 * not a bus route or a freeway speed. [night, day].
 */
const COLOR: [RGB, RGB] = [[186, 222, 250], [0, 128, 164]];
const ALPHA: [number, number] = [130, 150];
/** A soft cold glow under the line at night; none by day, where it would muddy. */
const HALO_ALPHA = 18;

export interface SnowFrame {
  /** The lit routes; a new array only when what's lit changes. */
  routes: SnowRoute[];
  daylight: number;
}

export function snowLayers(f: SnowFrame, beforeId?: string) {
  if (!f.routes.length) return [];
  const d = f.daylight;
  const color = mixRgb(COLOR[0], COLOR[1], d);
  const common = {
    data: f.routes,
    getPath: (r: SnowRoute) => r.path,
    widthUnits: "meters" as const,
    capRounded: true,
    jointRounded: true,
    parameters: { depthCompare: "always" as const },
    ...(beforeId ? { beforeId } : {}),
  };
  return [
    new PathLayer<SnowRoute>({
      ...common,
      id: "snow-halo",
      // The wide halo doubles as a generous hit area, so it never fades to
      // 0: fully transparent objects drop out of the picking pass.
      pickable: true,
      getColor: [...color, Math.max(1, Math.round(HALO_ALPHA * (1 - d)))],
      getWidth: 28,
      widthMinPixels: 4,
      widthMaxPixels: 10,
    }),
    new PathLayer<SnowRoute>({
      ...common,
      id: "snow-routes",
      pickable: true,
      getColor: [...color, Math.round(mixNumber(ALPHA[0], ALPHA[1], d))],
      getWidth: 7,
      widthMinPixels: 1.3,
      widthMaxPixels: 3,
    }),
  ];
}
