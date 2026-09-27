import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import type { Sat } from "../sky/satellites.ts";
import { SAT_TRAIL_S } from "../sky/satellites.ts";
import type { Kind } from "../sky/orbits.ts";
import { ISS_ICON, SATELLITE_ICON, STARLINK_ICON, STATION_ICON } from "../icons.ts";
import { mixRgb } from "../color.ts";

const ICONS: Record<Kind, typeof ISS_ICON> = { iss: ISS_ICON, station: STATION_ICON, satellite: SATELLITE_ICON, starlink: STARLINK_ICON };
const SIZE: Record<Kind, number> = { iss: 30, station: 26, satellite: 18, starlink: 13 };

export interface SatFrame {
  sats: Sat[];
  now: number;
  version: number;
  daylight: number;
  sunElevation: number;
}

/**
 * Satellites cross the map along their real ground tracks: a pale icon
 * with a short fading track behind it. The ISS and crewed stations are
 * larger and brighter; the thousands of Starlinks are small and quiet.
 */
export function satelliteLayers(f: SatFrame) {
  const d = f.daylight;
  const ink = mixRgb([198, 226, 255], [36, 58, 92], d);
  const alpha = (s: Sat) => (s.kind === "iss" || s.kind === "station" ? 255 : s.kind === "starlink" ? 170 : 215);
  // At night, satellites you could actually see get a soft halo.
  const seen = f.sunElevation <= -6 ? f.sats.filter((s) => !s.live.eclipsed && s.live.elevation >= 10) : [];
  return [
    new TripsLayer<Sat>({
      id: "sat-tracks",
      data: f.sats,
      getPath: (s) => s.trail,
      positionFormat: "XY",
      _pathType: "open",
      getTimestamps: (s) => s.times,
      getColor: (s) => [...ink, s.kind === "starlink" ? 55 : 90],
      getWidth: 1.4,
      widthUnits: "pixels",
      capRounded: true,
      fadeTrail: true,
      trailLength: SAT_TRAIL_S,
      currentTime: f.now,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPath: f.version, getTimestamps: f.version, getColor: d },
    }),
    new ScatterplotLayer<Sat>({
      id: "sat-visible-halo",
      data: seen,
      getPosition: (s) => s.position,
      getFillColor: [255, 244, 210, 40],
      getRadius: 16,
      radiusUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: f.version },
    }),
    new IconLayer<Sat>({
      id: "satellites",
      data: f.sats,
      getIcon: (s) => ICONS[s.kind],
      getPosition: (s) => s.position,
      getAngle: (s) => -s.heading,
      getSize: (s) => SIZE[s.kind],
      sizeUnits: "pixels",
      billboard: false,
      getColor: (s) => [...ink, alpha(s)],
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: f.version, getAngle: f.version, getColor: d },
    }),
  ];
}
