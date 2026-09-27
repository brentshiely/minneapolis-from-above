import { IconLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type { Plane } from "../live/aircraft.ts";
import type { Trail } from "../live/trails.ts";
import type { LonLat } from "../live/geometry.ts";
import { M_PER_DEG_LAT } from "../transit/data.ts";
import { PLANE_ICON } from "../icons.ts";
import { groundPlaneColor, planeColor } from "../palette.ts";
import type { SunPosition } from "../sun.ts";

export interface AircraftFrame {
  /** Daylight, 0 (night) to 1 (day), and where the sun is. */
  daylight: number;
  sun: SunPosition;
  planes: Plane[];
  trails: Trail<Plane>[];
  now: number;
  version: number;
  trailsVersion: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
/** 0 near the ground, 1 at cruise. */
const height = (p: Plane) => (p.onGround ? 0 : (p.altFt ?? 10_000) / 30_000);

/** Low planes on approach loom large and bright; cruisers are small and faint. */
function sizePx(p: Plane) { return p.onGround ? 13 : lerp(30, 16, height(p)); }
function opacity(p: Plane) { return p.onGround ? 0.45 : lerp(1, 0.6, height(p)); }


/** Longest shadow offset drawn, in meters; a low sun would otherwise fling it off the map. */
const MAX_SHADOW_M = 2500;

/**
 * A plane's shadow falls directly away from the sun, offset by its
 * altitude over the tangent of the sun's elevation: low planes trail their
 * shadow closely, high ones cast it far across the ground.
 */
function shadowAt(p: Plane, sun: SunPosition): LonLat {
  if (p.onGround || sun.elevation <= 1) return p.position;
  const altM = (p.altFt ?? 0) * 0.3048;
  const m = Math.min(MAX_SHADOW_M, altM / Math.tan((sun.elevation * Math.PI) / 180));
  const away = ((sun.azimuth + 180) * Math.PI) / 180;
  const kx = M_PER_DEG_LAT * Math.cos((p.position[1] * Math.PI) / 180);
  return [p.position[0] + (m * Math.sin(away)) / kx, p.position[1] + (m * Math.cos(away)) / M_PER_DEG_LAT];
}

export function aircraftLayers(f: AircraftFrame) {
  const airborne = f.trails.filter((t) => !t.vehicle.onGround);
  const d = f.daylight;
  const sky = planeColor(d), ground = groundPlaneColor(d);
  // Shadows only exist while the sun is up.
  const shadowStrength = d;
  return [
    new TripsLayer<Trail<Plane>>({
      id: "contrails",
      data: airborne,
      getPath: (t) => t.flat,
      positionFormat: "XY",
      getTimestamps: (t) => t.times,
      getColor: (t) => [...sky, (70 - 25 * d) * t.vehicle.alpha * opacity(t.vehicle)],
      getWidth: 2,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      fadeTrail: true,
      // Trails are never loops, and are handed over pre-flattened. Without
      // this, deck.gl treats a path whose ends coincide as closed and sizes
      // its buffers differently from the timestamps, corrupting neighbors
      // or throwing "offset is out of bounds".
      _pathType: "open",
      trailLength: 45,
      currentTime: f.now,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPath: f.trailsVersion, getTimestamps: f.trailsVersion, getColor: [f.trailsVersion, d] },
    }),
    new IconLayer<Plane>({
      id: "plane-shadows",
      data: f.planes,
      getIcon: () => PLANE_ICON,
      getPosition: (p) => shadowAt(p, f.sun),
      getAngle: (p) => -p.heading,
      getSize: sizePx,
      sizeUnits: "pixels",
      billboard: true, // face the camera; a flat "sticker on the ground" icon foreshortens to a sliver when the drift camera pitches
      getColor: (p) => [20, 28, 38, lerp(80, 35, height(p)) * shadowStrength * p.alpha * (p.onGround ? 0 : 1)],
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: f.version, getAngle: f.version, getColor: f.version, getSize: f.version },
    }),
    new IconLayer<Plane>({
      id: "planes",
      data: f.planes,
      getIcon: () => PLANE_ICON,
      getPosition: (p) => p.position,
      getAngle: (p) => -p.heading,
      getSize: sizePx,
      sizeUnits: "pixels",
      billboard: true, // face the camera; a flat "sticker on the ground" icon foreshortens to a sliver when the drift camera pitches
      getColor: (p) => [...(p.onGround ? ground : sky), 255 * opacity(p) * p.alpha],
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: f.version, getAngle: f.version, getColor: f.version, getSize: f.version },
    }),
  ];
}
