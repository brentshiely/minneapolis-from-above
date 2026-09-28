import { IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Vehicle } from "../live/fleet.ts";
import type { Plane } from "../live/aircraft.ts";
import type { Mode, RouteInfo, Shape, Transit } from "../transit/data.ts";
import type { Gauge } from "../water/gauges.ts";
import type { Sat } from "../sky/satellites.ts";
import { ROUTE_STYLE, planeColor, routeColor, vehicleColor } from "../palette.ts";
import { mixRgb } from "../color.ts";
import { BUS_ICON, TRAIN_ICON } from "../icons.ts";

/** Fingers are bigger than mouse pointers: widen hit areas on touch screens. */
const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
export const FINGER = coarse ? 1.8 : 1;

/**
 * Invisible, generous hit areas so small moving dots are easy to hover.
 * Alpha 1/255 rather than 0 so they still render into the picking pass.
 */
export function pickLayers(vehicles: Vehicle[], planes: Plane[], version: number, sats: Sat[] = []) {
  return [
    // Satellites (and debris) cover ground fast — often several times their
    // own icon size between frames — so the point itself is a hard target.
    // Its recent ground track is a much bigger, slower-moving one: hovering
    // anywhere along the trail picks the same object.
    new PathLayer<Sat>({
      id: "pick-sat-tracks",
      data: sats,
      pickable: true,
      getPath: (x) => x.trail,
      positionFormat: "XY",
      _pathType: "open",
      getColor: [0, 0, 0, 1],
      getWidth: 1,
      widthUnits: "pixels",
      widthMinPixels: 16 * FINGER,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPath: version },
    }),
    new ScatterplotLayer<Sat>({
      id: "pick-sats",
      data: sats,
      pickable: true,
      getPosition: (x) => x.position,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 13 * FINGER,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version },
    }),
    new ScatterplotLayer<Vehicle>({
      id: "pick-vehicles",
      data: vehicles,
      pickable: true,
      getPosition: (v) => v.position,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 10 * FINGER,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version },
    }),
    new ScatterplotLayer<Plane>({
      id: "pick-planes",
      data: planes,
      pickable: true,
      getPosition: (p) => p.position,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 16 * FINGER,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version },
    }),
  ];
}

/** The route isn't shown by default; hovering a vehicle traces the one it's on. */
function routeHighlight(shape: Shape, mode: Mode, route: RouteInfo | undefined, d: number) {
  const style = ROUTE_STYLE[mode];
  return new PathLayer<Shape>({
    id: "hover-route",
    data: [shape],
    getPath: (s) => s.path,
    getColor: [...routeColor(route, d), 235],
    getWidth: style.widthM,
    widthUnits: "meters",
    widthMinPixels: style.minPx + 0.6,
    widthMaxPixels: style.maxPx + 1,
    jointRounded: true,
    capRounded: true,
    parameters: { depthCompare: "always" },
    updateTriggers: { getColor: d },
  });
}

/** The hovered vehicle, drawn as a bus or train icon on a dark disc, with the route it's on traced beneath it. */
export function vehicleHighlight(transit: Transit, v: Vehicle, shape: Shape | undefined, version: number, d = 0) {
  const color = vehicleColor(transit.routes[v.routeId], d);
  // A dark disc at night, a white one by day.
  const disc = mixRgb([7, 11, 16], [255, 255, 255], d);
  const data = [v];
  return [
    ...(shape ? [routeHighlight(shape, transit.routes[v.routeId]?.mode ?? "bus", transit.routes[v.routeId], d)] : []),
    new ScatterplotLayer<Vehicle>({
      id: "hover-disc",
      data,
      getPosition: (x) => x.position,
      getFillColor: [...disc, 230],
      getLineColor: [...color, 255],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.5,
      getRadius: 17,
      radiusUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version, getFillColor: d, getLineColor: d },
    }),
    new IconLayer<Vehicle>({
      id: "hover-icon",
      data,
      getIcon: (x) => (x.mode === "rail" ? TRAIN_ICON : BUS_ICON),
      getPosition: (x) => x.position,
      getAngle: (x) => -x.motion.heading,
      getSize: 26,
      sizeUnits: "pixels",
      billboard: true, // face the camera; a flat "sticker on the ground" icon foreshortens to a sliver when the drift camera pitches
      getColor: [...color, 255],
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version, getAngle: version, getColor: d },
    }),
  ];
}

/** A soft ring around the hovered plane. */
export function planeHighlight(p: Plane, version: number, d = 0) {
  const ring = planeColor(d);
  return [
    new ScatterplotLayer<Plane>({
      id: "hover-plane-ring",
      data: [p],
      getPosition: (x) => x.position,
      getFillColor: [...ring, 18],
      getLineColor: [...ring, 150],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.2,
      getRadius: 22,
      radiusUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version, getFillColor: d, getLineColor: d },
    }),
  ];
}

/** A small ring on the gauge itself, so you can see where the reading comes from. */
export function gaugeHighlight(g: Gauge, d = 0) {
  const ring = mixRgb([130, 190, 255], [30, 100, 190], d);
  return [
    new ScatterplotLayer<Gauge>({
      id: "hover-gauge",
      data: [g],
      getPosition: (x) => [x.lon, x.lat],
      getFillColor: [...ring, 60],
      getLineColor: [...ring, 230],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.5,
      getRadius: 7,
      radiusUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getFillColor: d, getLineColor: d },
    }),
  ];
}
