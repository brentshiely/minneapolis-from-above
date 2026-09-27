import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Mode, Shape, Transit } from "../transit/data.ts";
import type { AlertInfo } from "../transit/alerts.ts";
import { ROUTE_STYLE, routeAlpha, routeColor } from "../palette.ts";

/**
 * The quiet network underneath everything that moves. One layer per mode,
 * since minimum pixel width is a per-layer setting: rail must stay visible
 * at metro zoom where its real width is a fraction of a pixel. Buses draw
 * first so rail and BRT sit on top where corridors overlap.
 *
 * A route a live alert affects is left out here and drawn instead by
 * `alertRouteLayers`; both mode layers are already close to full opacity,
 * so a dash pattern merely drawn over one would barely read as broken.
 */
export function routeLayers(transit: Transit, d: number, beforeId?: string, affected?: Map<string, unknown>) {
  const byMode: Record<Mode, Shape[]> = { bus: [], brt: [], rail: [] };
  for (const s of transit.shapes) if (!affected?.has(s.route)) byMode[transit.routes[s.route]?.mode ?? "bus"].push(s);

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

/**
 * A route a live service alert currently affects, dashed in its own mode
 * color in place of its normal solid line. Empty and free of cost on an
 * ordinary day, when no alert applies to anything on the map.
 */
export function alertRouteLayers(transit: Transit, affected: Map<string, AlertInfo>, d: number, beforeId?: string) {
  if (affected.size === 0) return [];
  const shapes = transit.shapes.filter((s) => affected.has(s.route));
  if (!shapes.length) return [];
  return [
    new PathLayer<Shape, PathStyleExtensionProps<Shape>>({
      id: "routes-alert",
      data: shapes,
      pickable: true,
      getPath: (s) => s.path,
      getColor: (s) => {
        const mode = transit.routes[s.route]?.mode ?? "bus";
        return [...routeColor(transit.routes[s.route], d), routeAlpha(mode, d)];
      },
      getWidth: (s) => ROUTE_STYLE[transit.routes[s.route]?.mode ?? "bus"].widthM,
      widthUnits: "meters",
      widthMinPixels: 1.6,
      widthMaxPixels: 5,
      getDashArray: [16, 10],
      dashJustified: true,
      dashUnits: "pixels",
      // 'path' keeps the dash phase continuous along the whole shape; the
      // default per-segment mode restarts it at every vertex, and our
      // decoded shapes have vertices close enough together that it never
      // gets past the first, always-on dash.
      extensions: [new PathStyleExtension({ dash: true, dashMode: "path" })],
      jointRounded: true,
      capRounded: true,
      parameters: { depthCompare: "always" },
      updateTriggers: { getColor: d, getWidth: affected },
      ...(beforeId ? { beforeId } : {}),
    }),
  ];
}
