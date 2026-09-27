import { GeoJsonLayer } from "@deck.gl/layers";
import type { Warning } from "../weather/warnings.ts";
import { pulse, warningColor } from "../weather/warnings.ts";

export interface WarningsFrame {
  active: Warning[];
  now: number;
}

/**
 * A very subtle shaded area for each active watch/warning, breathing
 * slowly rather than sitting static — enough to notice, never alarming.
 * Empty and free of cost on an ordinary day.
 */
export function warningLayers(f: WarningsFrame, beforeId?: string) {
  if (!f.active.length) return [];
  const p = pulse(f.now);
  return [
    new GeoJsonLayer<Warning>({
      id: "warnings",
      data: f.active.map((w) => ({ type: "Feature" as const, properties: w, geometry: w.geometry })),
      pickable: true,
      stroked: true,
      filled: true,
      getFillColor: (f) => [...warningColor(f.properties.event), Math.round(28 * p)],
      getLineColor: (f) => [...warningColor(f.properties.event), Math.round(150 * p)],
      getLineWidth: 2,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 1.5,
      parameters: { depthCompare: "always" },
      updateTriggers: { getFillColor: p, getLineColor: p },
      ...(beforeId ? { beforeId } : {}),
    }),
  ];
}
