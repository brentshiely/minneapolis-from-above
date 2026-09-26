import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Vehicle } from "../live/fleet.ts";
import type { Plane } from "../live/aircraft.ts";
import type { Transit } from "../transit/data.ts";
import { vehicleColor } from "../palette.ts";
import { BUS_ICON, TRAIN_ICON } from "../icons.ts";

/**
 * Invisible, generous hit areas so small moving dots are easy to hover.
 * Alpha 1/255 rather than 0 so they still render into the picking pass.
 */
export function pickLayers(vehicles: Vehicle[], planes: Plane[], version: number) {
  return [
    new ScatterplotLayer<Vehicle>({
      id: "pick-vehicles",
      data: vehicles,
      pickable: true,
      getPosition: (v) => v.position,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 10,
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
      radiusMinPixels: 16,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version },
    }),
  ];
}

/** The hovered vehicle, drawn as a bus or train icon on a dark disc. */
export function vehicleHighlight(transit: Transit, v: Vehicle, version: number) {
  const color = vehicleColor(transit.routes[v.routeId]);
  const data = [v];
  return [
    new ScatterplotLayer<Vehicle>({
      id: "hover-disc",
      data,
      getPosition: (x) => x.position,
      getFillColor: [7, 11, 16, 220],
      getLineColor: [...color, 255],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.5,
      getRadius: 17,
      radiusUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version },
    }),
    new IconLayer<Vehicle>({
      id: "hover-icon",
      data,
      getIcon: (x) => (x.mode === "rail" ? TRAIN_ICON : BUS_ICON),
      getPosition: (x) => x.position,
      getAngle: (x) => -x.motion.heading,
      getSize: 26,
      sizeUnits: "pixels",
      billboard: false,
      getColor: [...color, 255],
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version, getAngle: version },
    }),
  ];
}

/** A soft ring around the hovered plane. */
export function planeHighlight(p: Plane, version: number) {
  return [
    new ScatterplotLayer<Plane>({
      id: "hover-plane-ring",
      data: [p],
      getPosition: (x) => x.position,
      getFillColor: [232, 238, 248, 18],
      getLineColor: [232, 238, 248, 150],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.2,
      getRadius: 22,
      radiusUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: version },
    }),
  ];
}
