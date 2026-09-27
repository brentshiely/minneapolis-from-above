/**
 * Where satellites are, from their orbital elements (two-line element
 * sets from CelesTrak), using the standard SGP4 model via satellite.js.
 */
import {
  degreesLat, degreesLong, ecfToLookAngles, eciToEcf, eciToGeodetic, gstime, jday, propagate, sunPos, twoline2satrec,
  type SatRec,
} from "satellite.js";

export interface Tle {
  id: number;
  name: string;
  l1: string;
  l2: string;
}

/** Parse CelesTrak's three-line format: name, line 1, line 2. */
export function parseTles(text: string): Tle[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out: Tle[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (!l1?.startsWith("1 ") || !l2?.startsWith("2 ")) continue;
    out.push({ id: Number(l1.slice(2, 7)), name: name.trim(), l1, l2 });
  }
  return out;
}

export type Kind = "iss" | "station" | "starlink" | "satellite" | "debris";

/** The broken-up satellites whose remains CelesTrak tracks as debris clouds. */
const DEBRIS_PARENTS = /^(FENGYUN 1C|COSMOS 2251|IRIDIUM 33|COSMOS 1408)\b/;

/** What icon a satellite gets. */
export function kindOf(t: Pick<Tle, "id" | "name">): Kind {
  if (/\bDEB\b/.test(t.name) || DEBRIS_PARENTS.test(t.name)) return "debris";
  if (t.id === 25544) return "iss";
  if (/^CSS \(|TIANHE|WENTIAN|MENGTIAN/.test(t.name)) return "station";
  if (/^STARLINK/.test(t.name)) return "starlink";
  return "satellite";
}

export const MINNEAPOLIS_OBSERVER = {
  latitude: (44.9778 * Math.PI) / 180,
  longitude: (-93.265 * Math.PI) / 180,
  height: 0.25, // km
};

const EARTH_RADIUS_KM = 6371;
const AU_KM = 149_597_870.7;

export interface SatPosition {
  lon: number;
  lat: number;
  /** Kilometers above the surface. */
  altKm: number;
  /** Kilometers per second, relative to Earth's center. */
  speedKms: number;
  /** Degrees above Minneapolis's horizon, and compass direction. */
  elevation: number;
  azimuth: number;
  /** In Earth's shadow (so not lit by the sun). */
  eclipsed: boolean;
}

export function satrecOf(t: Tle): SatRec | undefined {
  try {
    const s = twoline2satrec(t.l1, t.l2);
    return s.error ? undefined : s;
  } catch {
    return undefined;
  }
}

/** Where a satellite is at `date`, or undefined if its orbit has decayed. */
export function positionAt(rec: SatRec, date: Date, withViewing = true): SatPosition | undefined {
  const pv = propagate(rec, date);
  if (!pv || typeof pv.position !== "object") return undefined;
  const gmst = gstime(date);
  const geo = eciToGeodetic(pv.position, gmst);
  if (!Number.isFinite(geo.latitude)) return undefined;
  const v = pv.velocity;
  const pos: SatPosition = {
    lon: degreesLong(geo.longitude),
    lat: degreesLat(geo.latitude),
    altKm: geo.height,
    speedKms: Math.hypot(v.x, v.y, v.z),
    elevation: 0, azimuth: 0, eclipsed: false,
  };
  if (withViewing) {
    const look = ecfToLookAngles(MINNEAPOLIS_OBSERVER, eciToEcf(pv.position, gmst));
    pos.elevation = (look.elevation * 180) / Math.PI;
    pos.azimuth = ((look.azimuth * 180) / Math.PI + 360) % 360;
    pos.eclipsed = inEarthShadow(pv.position, date);
  }
  return pos;
}

/**
 * Earth's shadow as a cylinder behind the planet (the umbra's taper is
 * negligible at satellite heights): the satellite is dark if it's on the
 * night side and within one Earth radius of the Sun-Earth line.
 */
export function inEarthShadow(r: { x: number; y: number; z: number }, date: Date): boolean {
  const s = sunPos(jday(date)).rsun;
  const sx = s.x * AU_KM, sy = s.y * AU_KM, sz = s.z * AU_KM;
  const sLen = Math.hypot(sx, sy, sz);
  const ux = sx / sLen, uy = sy / sLen, uz = sz / sLen;
  const along = r.x * ux + r.y * uy + r.z * uz;
  if (along > 0) return false; // sunward side
  const px = r.x - along * ux, py = r.y - along * uy, pz = r.z - along * uz;
  return Math.hypot(px, py, pz) < EARTH_RADIUS_KM;
}

/** Could you see it with your eyes right now from Minneapolis? */
export function visibleToEye(p: SatPosition, sunElevation: number): boolean {
  return !p.eclipsed && p.elevation >= 10 && sunElevation <= -6;
}
