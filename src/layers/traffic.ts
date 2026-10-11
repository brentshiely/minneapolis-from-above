import { PathLayer } from "@deck.gl/layers";
import type { Freeways, Stretch } from "../traffic/freeways.ts";
import { level, type Level, type Readings } from "../traffic/traffic.ts";
import { mixRgb, type RGB } from "../color.ts";

/**
 * Freeway speeds as color: calm blue when moving freely, amber when
 * slowing, orange in heavy traffic, deep red when stop and go.
 * [night, day] for each, so it reads on both maps.
 */
const COLORS: Record<Level, [RGB, RGB]> = {
  free: [[76, 150, 214], [54, 118, 190]],
  slowing: [[238, 190, 88], [214, 150, 24]],
  heavy: [[244, 124, 60], [218, 88, 30]],
  stopped: [[230, 62, 76], [184, 28, 44]],
};
/** Free-flowing freeways stay quiet (quieter at night, beside the bus web); congestion speaks up. */
const ALPHA: Record<Level, [number, number]> = { free: [92, 125], slowing: [200, 210], heavy: [225, 230], stopped: [240, 240] };

/** An estimate borrowed from neighboring sensors draws fainter than a real reading. */
const ESTIMATE_DIM = 0.6;

export interface TrafficFrame {
  /** Raw sensor readings plus estimates for holes (see traffic/gaps.ts). */
  readings: Readings;
  /** Stations whose speed in `readings` is an estimate. */
  estimated: ReadonlySet<string>;
  version: number;
  daylight: number;
}

export function trafficLayer(freeways: Freeways, f: TrafficFrame, beforeId?: string) {
  const d = f.daylight;
  const colorOf = (s: Stretch): [number, number, number, number] => {
    const speed = f.readings[s.station]?.[0];
    if (speed === null || speed === undefined) return [0, 0, 0, 0];
    const lv = level(speed, freeways.stations[s.station]?.limit ?? 55);
    const alpha = (ALPHA[lv][0] + (ALPHA[lv][1] - ALPHA[lv][0]) * d) * (f.estimated.has(s.station) ? ESTIMATE_DIM : 1);
    return [...mixRgb(COLORS[lv][0], COLORS[lv][1], d), alpha];
  };
  return new PathLayer<Stretch>({
    id: "traffic",
    data: freeways.stretches,
    pickable: true,
    getPath: (s) => s.path,
    getColor: colorOf,
    getWidth: 14,
    widthUnits: "meters",
    widthMinPixels: 2,
    widthMaxPixels: 7,
    capRounded: true,
    jointRounded: true,
    parameters: { depthCompare: "always" },
    updateTriggers: { getColor: [f.version, d] },
    ...(beforeId ? { beforeId } : {}),
  });
}
