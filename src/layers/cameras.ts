import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { CameraInfo } from "../traffic/cameras.ts";
import { CAMERA_ICON } from "../icons.ts";
import { FINGER } from "./hover.ts";

/** Small and quiet: a fixture along the freeway, not another moving dot. */
const CAMERA_COLOR: [number, number, number] = [176, 184, 192];

/**
 * Every camera as a tiny fixed mark along its freeway, plus an invisible,
 * generous pick disc so a small icon is still easy to hover or tap.
 */
export function cameraLayers(cameras: CameraInfo[], beforeId?: string) {
  return [
    new IconLayer<CameraInfo>({
      id: "cameras",
      data: cameras,
      getIcon: () => CAMERA_ICON,
      getPosition: (c) => [c.lon, c.lat],
      getSize: 11,
      sizeUnits: "pixels",
      billboard: false,
      getColor: [...CAMERA_COLOR, 190],
      parameters: { depthCompare: "always" },
      ...(beforeId ? { beforeId } : {}),
    }),
    new ScatterplotLayer<CameraInfo>({
      id: "pick-cameras",
      data: cameras,
      pickable: true,
      getPosition: (c) => [c.lon, c.lat],
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 9 * FINGER,
      parameters: { depthCompare: "always" },
    }),
  ];
}
