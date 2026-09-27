/**
 * Where each naked-eye planet is in the sky, and how bright it looks.
 * Positions from Paul Schlyter's low-precision heliocentric orbital
 * elements ("Computing Planetary Positions", stjarnhimlen.se/comp/ppcomp.html) —
 * the same family of two-body formulas as Meeus' fuller VSOP87 theory, good
 * to a degree or so, plenty for a glow at the map's edge. Visual magnitudes
 * from the Astronomical Almanac's approximate formulae (Meeus ch. 41).
 */
import { MINNEAPOLIS } from "./sun.ts";
import { compassWord } from "./moon.ts";
import type { Description } from "./describe.ts";

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm360 = (x: number) => ((x % 360) + 360) % 360;

const julianDay = (date: Date) => date.getTime() / 86_400_000 + 2_440_587.5;
/** Days since 2000-01-00.0 UT (Schlyter's epoch for these elements). */
const daysSinceEpoch = (date: Date) => julianDay(date) - 2_451_543.5;

export type PlanetName = "Mercury" | "Venus" | "Mars" | "Jupiter" | "Saturn";
export const PLANET_NAMES: PlanetName[] = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

interface Elements { N: number; i: number; w: number; a: number; e: number; M: number }

/** Mean orbital elements at day `d`, degrees (except a, e). */
const ELEMENTS: Record<PlanetName, (d: number) => Elements> = {
  Mercury: (d) => ({ N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5.00e-8 * d, w: 29.1241 + 1.01444e-5 * d, a: 0.387098, e: 0.205635 + 5.59e-10 * d, M: 168.6562 + 4.0923344368 * d }),
  Venus: (d) => ({ N: 76.6799 + 2.46590e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.8910 + 1.38374e-5 * d, a: 0.723330, e: 0.006773 - 1.302e-9 * d, M: 48.0052 + 1.6021302244 * d }),
  Mars: (d) => ({ N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: 18.6021 + 0.5240207766 * d }),
  Jupiter: (d) => ({ N: 100.4542 + 2.76854e-5 * d, i: 1.3030 - 1.557e-7 * d, w: 273.8777 + 1.64505e-5 * d, a: 5.20256, e: 0.048498 + 4.469e-9 * d, M: 19.8950 + 0.0830853001 * d }),
  Saturn: (d) => ({ N: 113.6634 + 2.38980e-5 * d, i: 2.4886 - 1.081e-7 * d, w: 339.3939 + 2.97661e-5 * d, a: 9.55475, e: 0.055546 - 9.499e-9 * d, M: 316.9670 + 0.0334442282 * d }),
};

/** The sun's own apparent orbit (equivalently Earth's), for the geocentric shift. */
const sunElements = (d: number) => ({ w: 282.9404 + 4.70935e-5 * d, a: 1, e: 0.016709 - 1.151e-9 * d, M: 356.0470 + 0.9856002585 * d });

/** Kepler's equation, solved by a few rounds of Newton's method. */
function eccentricAnomaly(Mdeg: number, e: number): number {
  let E = Mdeg + deg(e * Math.sin(rad(Mdeg)) * (1 + e * Math.cos(rad(Mdeg))));
  for (let i = 0; i < 8; i++) E -= (E - deg(e * Math.sin(rad(E))) - Mdeg) / (1 - e * Math.cos(rad(E)));
  return E;
}

/** A body's position in its own orbital plane: true anomaly and distance (AU). */
function orbitalPlane(M: number, e: number, a: number) {
  const E = eccentricAnomaly(M, e);
  const xv = a * (Math.cos(rad(E)) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(rad(E));
  return { v: deg(Math.atan2(yv, xv)), r: Math.hypot(xv, yv) };
}

/** The sun's geocentric ecliptic position (z = 0, by definition of the ecliptic), AU. */
function sunGeocentric(d: number) {
  const el = sunElements(d);
  const { v, r } = orbitalPlane(el.M, el.e, el.a);
  const lon = rad(v + el.w);
  return { xs: r * Math.cos(lon), ys: r * Math.sin(lon), r };
}

/** Heliocentric ecliptic rectangular coordinates (AU) for one planet. */
function heliocentric(el: Elements) {
  const { v, r } = orbitalPlane(el.M, el.e, el.a);
  const vw = rad(v + el.w);
  const N = rad(el.N), i = rad(el.i);
  return {
    xh: r * (Math.cos(N) * Math.cos(vw) - Math.sin(N) * Math.sin(vw) * Math.cos(i)),
    yh: r * (Math.sin(N) * Math.cos(vw) + Math.cos(N) * Math.sin(vw) * Math.cos(i)),
    zh: r * (Math.sin(vw) * Math.sin(i)),
    r,
  };
}

export interface PlanetPosition {
  /** Degrees above the horizon as seen from the ground (negative below). */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Approximate visual magnitude (lower is brighter; Venus runs about -4, Saturn about +1). */
  magnitude: number;
}

const APPROX_MAG: Record<PlanetName, (rR: number, fv: number) => number> = {
  Mercury: (rR, fv) => -0.42 + 5 * Math.log10(rR) + 0.0380 * fv - 0.000273 * fv * fv + 0.000002 * fv ** 3,
  Venus: (rR, fv) => -4.40 + 5 * Math.log10(rR) + 0.0009 * fv + 0.000239 * fv * fv - 0.00000065 * fv ** 3,
  Mars: (rR, fv) => -1.52 + 5 * Math.log10(rR) + 0.016 * fv,
  Jupiter: (rR, fv) => -9.40 + 5 * Math.log10(rR) + 0.005 * fv,
  // Saturn's rings can swing this a magnitude either way; we ignore the ring
  // term rather than model ring-plane geometry for an ambient glow.
  Saturn: (rR) => -8.88 + 5 * Math.log10(rR),
};

export function planetPosition(name: PlanetName, date: Date, lat = MINNEAPOLIS.lat, lon = MINNEAPOLIS.lon): PlanetPosition {
  const d = daysSinceEpoch(date);
  const { xh, yh, zh, r } = heliocentric(ELEMENTS[name](d));
  const sun = sunGeocentric(d);
  const xg = xh + sun.xs, yg = yh + sun.ys, zg = zh;
  const R = Math.hypot(xg, yg, zg);

  // Ecliptic to equatorial (Schlyter's simplified obliquity of the date).
  const obliq = rad(23.4393 - 3.563e-7 * d);
  const xe = xg, ye = yg * Math.cos(obliq) - zg * Math.sin(obliq), ze = yg * Math.sin(obliq) + zg * Math.cos(obliq);
  const ra = norm360(deg(Math.atan2(ye, xe)));
  const decl = deg(Math.atan2(ze, Math.hypot(xe, ye)));

  const jd = julianDay(date);
  const t = (jd - 2_451_545) / 36_525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2_451_545) + 0.000387933 * t * t;
  const H = rad(norm360(gmst + lon) - ra);
  const phi = rad(lat), dec = rad(decl);
  const elevation = deg(Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)));
  const azimuth = norm360(deg(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))) + 180);

  // Phase angle (sun-planet-earth), law of cosines on the three distances.
  const fv = deg(Math.acos(Math.min(1, Math.max(-1, (r * r + R * R - sun.r * sun.r) / (2 * r * R)))));
  const magnitude = APPROX_MAG[name](r * R, fv);
  return { elevation, azimuth, magnitude };
}

/**
 * The upper limb on the horizon with standard atmospheric refraction — the
 * same convention as sunrise/sunset tables (planets have no meaningful disc).
 */
const REFRACTION = 34 / 60;
function aboveRiseLine(name: PlanetName, date: Date, lat: number, lon: number): number {
  return planetPosition(name, date, lat, lon).elevation + REFRACTION;
}

export interface PlanetEvent { kind: "rise" | "set"; at: Date }

/** Rises and sets between two moments, to the nearest few seconds. */
export function planetEvents(name: PlanetName, start: Date, end: Date, lat = MINNEAPOLIS.lat, lon = MINNEAPOLIS.lon): PlanetEvent[] {
  const STEP = 15 * 60_000;
  const events: PlanetEvent[] = [];
  let t0 = start.getTime();
  let h0 = aboveRiseLine(name, start, lat, lon);
  while (t0 < end.getTime()) {
    const t1 = Math.min(end.getTime(), t0 + STEP);
    const h1 = aboveRiseLine(name, new Date(t1), lat, lon);
    if ((h0 < 0) !== (h1 < 0)) {
      let a = t0, b = t1, ha = h0;
      while (b - a > 5000) {
        const m = (a + b) / 2;
        const hm = aboveRiseLine(name, new Date(m), lat, lon);
        if ((hm < 0) === (ha < 0)) { a = m; ha = hm; } else b = m;
      }
      events.push({ kind: h1 >= 0 ? "rise" : "set", at: new Date(Math.round((a + b) / 2)) });
    }
    t0 = t1; h0 = h1;
  }
  return events;
}

export interface Planet {
  name: PlanetName;
  position: PlanetPosition;
  up: boolean;
  /** The next set if it's up, or rise if it's down, within the next day and a half. */
  next?: PlanetEvent;
  at: Date;
}

export function planetAt(name: PlanetName, date: Date): Planet {
  const up = aboveRiseLine(name, date, MINNEAPOLIS.lat, MINNEAPOLIS.lon) >= 0;
  const next = planetEvents(name, date, new Date(date.getTime() + 36 * 3_600_000)).find((e) => e.kind === (up ? "set" : "rise"));
  return { name, position: planetPosition(name, date), up, next, at: date };
}

export const planetsAt = (date: Date): Planet[] => PLANET_NAMES.map((n) => planetAt(n, date));

// --- in words ----------------------------------------------------------------

const TZ = "America/Chicago";
const clockTime = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" }).format(d);

function when(event: Date, now: Date): string {
  const tomorrow = dayKey(event) !== dayKey(now) && event.getTime() - now.getTime() > 12 * 3_600_000;
  return `${clockTime(event)}${tomorrow ? " tomorrow" : ""}`;
}

const NICKNAME: Record<PlanetName, string> = {
  Mercury: "The closest planet to the sun",
  Venus: "The brightest planet",
  Mars: "The red planet",
  Jupiter: "The biggest planet",
  Saturn: "The ringed planet",
};

/**
 * "Venus" / "The brightest planet, up in the west, 22° above the horizon.
 * Sets at 9:47 PM."
 */
export function describePlanet(p: Planet): Description {
  const sky = p.up
    ? `up in the ${compassWord(p.position.azimuth)}, ${Math.max(0, Math.round(p.position.elevation))}° above the horizon.`
    : "below the horizon now.";
  const next = !p.next ? ""
    : p.next.kind === "set" ? ` Sets at ${when(p.next.at, p.at)}.`
    : ` Rises at ${when(p.next.at, p.at)}.`;
  return { title: p.name, detail: `${NICKNAME[p.name]}, ${sky}${next}`, meta: "One of the five planets visible to the naked eye" };
}
