import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import type { Shape, Transit } from "../transit/data.ts";
import type { AlertInfo } from "../transit/alerts.ts";
import { ROUTE_STYLE, routeAlpha, routeColor } from "../palette.ts";

/**
 * A route a live service alert currently affects, dashed in its own mode
 * color. The rest of the network isn't drawn by default (hovering a
 * vehicle traces its own route instead, in `layers/hover.ts`), so this is
 * the only always-on route drawing: empty and free of cost on an ordinary
 * day, when no alert applies to anything on the map.
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
