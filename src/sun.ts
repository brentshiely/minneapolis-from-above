/**
 * Where the sun is in the sky, from the NOAA solar position algorithm
 * (accurate to well under a degree for these purposes).
 * https://gml.noaa.gov/grad/solcalc/calcdetails.html
 */

export const MINNEAPOLIS = { lat: 44.9778, lon: -93.265 };

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface SunPosition {
  /** Degrees above the horizon (negative below). */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

export function sunPosition(date: Date, lat = MINNEAPOLIS.lat, lon = MINNEAPOLIS.lon): SunPosition {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545) / 36_525; // Julian centuries since J2000

  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(rad(M)) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * t)
    + Math.sin(rad(3 * M)) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const obliq0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = obliq0 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));

  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime = 4 * deg(
    y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0))
    - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)),
  );

  const utcMinutes = (date.getTime() / 60_000) % 1440;
  const trueSolarTime = (((utcMinutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const cosZenith = Math.sin(rad(lat)) * Math.sin(rad(decl)) + Math.cos(rad(lat)) * Math.cos(rad(decl)) * Math.cos(rad(hourAngle));
  const zenith = deg(Math.acos(Math.min(1, Math.max(-1, cosZenith))));
  const elevation = 90 - zenith;

  const azDen = Math.cos(rad(lat)) * Math.sin(rad(zenith));
  let azimuth: number;
  if (Math.abs(azDen) < 1e-9) azimuth = lat > 0 ? 180 : 0;
  else {
    const azRad = (Math.sin(rad(lat)) * Math.cos(rad(zenith)) - Math.sin(rad(decl))) / azDen;
    const a = deg(Math.acos(Math.min(1, Math.max(-1, azRad))));
    azimuth = hourAngle > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  return { elevation, azimuth };
}

/**
 * How much daylight there is, 0 (night) to 1 (day). Blends smoothly from
 * the end of civil twilight (sun 6° below the horizon) to the sun 6° up,
 * so dawn and dusk each take about an hour.
 */
export function daylight(elevation: number): number {
  const x = Math.min(1, Math.max(0, (elevation + 6) / 12));
  return x * x * (3 - 2 * x);
}
