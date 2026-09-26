import { PathLayer } from "@deck.gl/layers";
import type { Mode, Shape, Transit } from "../transit/data.ts";
import { ROUTE_STYLE, routeAlpha, routeColor } from "../palette.ts";

/**
 * The quiet network underneath everything that moves. One layer per mode,
 * since minimum pixel width is a per-layer setting: rail must stay visible
 * at metro zoom where its real width is a fraction of a pixel. Buses draw
 * first so rail and BRT sit on top where corridors overlap.
 */
export function routeLayers(transit: Transit, d: number, beforeId?: string) {
  const byMode: Record<Mode, Shape[]> = { bus: [], brt: [], rail: [] };
  for (const s of transit.shapes) byMode[transit.routes[s.route]?.mode ?? "bus"].push(s);

  return (["bus", "brt", "rail"] as const).map((mode) => {
    const style = ROUTE_STYLE[mode];
    return new PathLayer<Shape>({
      id: `routes-${mode}`,
      data: byMode[mode],
      getPath: (s) => s.path,
      getColor: (s) => [...routeColor(transit.routes[s.route], d), routeAlpha(mode, d)],
      getWidth: style.widthM,
      widthUnits: "meters",
      widthMinPixels: style.minPx,
      widthMaxPixels: style.maxPx,
      jointRounded: true,
      capRounded: true,
      parameters: { depthCompare: "always" },
      updateTriggers: { getColor: d },
      ...(beforeId ? { beforeId } : {}),
    });
  });
}
