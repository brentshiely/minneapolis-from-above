import { IconLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type { Plane } from "../live/aircraft.ts";
import type { Trail } from "../live/trails.ts";
import type { LonLat } from "../live/geometry.ts";
import { M_PER_DEG_LAT } from "../transit/data.ts";
import { PLANE_ICON } from "../icons.ts";

export interface AircraftFrame {
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

const SKY: [number, number, number] = [232, 238, 248];
const GROUND: [number, number, number] = [150, 162, 178];

/**
 * A plane's shadow falls southeast of it (afternoon sun), farther the higher
 * it flies, so low planes visibly trail their shadow across the ground.
 */
function shadowAt(p: Plane): LonLat {
  if (p.onGround) return p.position;
  const m = Math.min(1500, ((p.altFt ?? 0) * 0.3048) * 0.18);
  const kx = M_PER_DEG_LAT * Math.cos((p.position[1] * Math.PI) / 180);
  const d = m / Math.SQRT2;
  return [p.position[0] + d / kx, p.position[1] - d / M_PER_DEG_LAT];
}

export function aircraftLayers(f: AircraftFrame) {
  const airborne = f.trails.filter((t) => !t.vehicle.onGround);
  return [
    new TripsLayer<Trail<Plane>>({
      id: "contrails",
      data: airborne,
      getPath: (t) => t.flat,
      positionFormat: "XY",
      getTimestamps: (t) => t.times,
      getColor: (t) => [...SKY, 70 * t.vehicle.alpha * opacity(t.vehicle)],
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
      updateTriggers: { getPath: f.trailsVersion, getTimestamps: f.trailsVersion, getColor: f.trailsVersion },
    }),
    new IconLayer<Plane>({
      id: "plane-shadows",
      data: f.planes,
      getIcon: () => PLANE_ICON,
      getPosition: shadowAt,
      getAngle: (p) => -p.heading,
      getSize: sizePx,
      sizeUnits: "pixels",
      billboard: false,
      getColor: (p) => [0, 0, 0, lerp(90, 30, height(p)) * p.alpha * (p.onGround ? 0 : 1)],
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
      billboard: false,
      getColor: (p) => [...(p.onGround ? GROUND : SKY), 255 * opacity(p) * p.alpha],
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: f.version, getAngle: f.version, getColor: f.version, getSize: f.version },
    }),
  ];
}
