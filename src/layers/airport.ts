import { ScatterplotLayer } from "@deck.gl/layers";
import { MSP_POSITION, type MspStatus } from "../airport.ts";
import { FINGER } from "./hover.ts";

export interface AirportFrame {
  status: MspStatus[];
  /** Page-clock seconds, for the active-status pulse. */
  now: number;
}

/** A quiet marker at MSP, always hoverable; a soft amber pulse only while something's active. */
export function airportLayers(f: AirportFrame) {
  const active = f.status.length > 0;
  const pulse = 0.6 + 0.4 * Math.sin(f.now * 1.6);
  return [
    ...(active
      ? [
        new ScatterplotLayer({
          id: "airport-halo",
          data: [MSP_POSITION],
          getPosition: (p: [number, number]) => p,
          getFillColor: [230, 150, 60, Math.round(90 * pulse)],
          getRadius: 22,
          radiusUnits: "pixels",
          parameters: { depthCompare: "always" },
          updateTriggers: { getFillColor: pulse },
        }),
      ]
      : []),
    new ScatterplotLayer({
      id: "airport",
      data: [MSP_POSITION],
      getPosition: (p: [number, number]) => p,
      getFillColor: active ? [230, 150, 60, 220] : [130, 150, 170, 140],
      getRadius: 6,
      radiusUnits: "pixels",
      radiusMinPixels: 5,
      parameters: { depthCompare: "always" },
    }),
    new ScatterplotLayer({
      id: "pick-airport",
      data: [MSP_POSITION],
      pickable: true,
      getPosition: (p: [number, number]) => p,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 14 * FINGER,
      parameters: { depthCompare: "always" },
    }),
  ];
}
