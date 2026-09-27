/**
 * Where the moon is, how much of it is lit, and when it rises and sets.
 * Position from the low-precision lunar theory in Montenbruck & Pfleger,
 * "Astronomy on the Personal Computer" (a few arcminutes), with distance
 * and phase angle from the main terms in Meeus, "Astronomical Algorithms"
 * ch. 47–48. Good to a minute or two on rise and set times.
 */
import { MINNEAPOLIS } from "./sun.ts";
import type { Description } from "./describe.ts";

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const frac = (x: number) => x - Math.floor(x);
const norm360 = (x: number) => ((x % 360) + 360) % 360;

/** Terrestrial time runs about 69 s ahead of UTC these years. */
const DELTA_T_S = 69;
const ARCSEC = 206_264.8062;
const EARTH_RADIUS_KM = 6378.14;
const MOON_RADIUS_KM = 1737.4;
/** The moon moves about 12.19° a lunar day ahead of the sun. */
const SYNODIC_DAYS = 29.530589;

const julianDay = (date: Date) => date.getTime() / 86_400_000 + 2_440_587.5;

interface Ecliptic {
  /** Geocentric ecliptic longitude and latitude, degrees. */
  lon: number;
  lat: number;
  distanceKm: number;
  /** Degrees the moon is ahead of the sun in longitude, 0–360. */
  elongation: number;
  /** Angle sun–moon–earth, degrees: 0 full, 180 new. */
  phaseAngle: number;
}

function ecliptic(date: Date): Ecliptic {
  const t = (julianDay(date) + DELTA_T_S / 86_400 - 2_451_545) / 36_525;
  // Mean elements, in revolutions then radians.
  const L0 = frac(0.606433 + 1336.855225 * t); // moon's mean longitude
  const l = 2 * Math.PI * frac(0.374897 + 1325.55241 * t); // moon's mean anomaly
  const ls = 2 * Math.PI * frac(0.993133 + 99.997361 * t); // sun's mean anomaly
  const D = 2 * Math.PI * frac(0.827361 + 1236.853086 * t); // elongation
  const F = 2 * Math.PI * frac(0.259086 + 1342.227825 * t); // argument of latitude

  const dL = 22640 * Math.sin(l) - 4586 * Math.sin(l - 2 * D) + 2370 * Math.sin(2 * D) + 769 * Math.sin(2 * l)
    - 668 * Math.sin(ls) - 412 * Math.sin(2 * F) - 212 * Math.sin(2 * l - 2 * D) - 206 * Math.sin(l + ls - 2 * D)
    + 192 * Math.sin(l + 2 * D) - 165 * Math.sin(ls - 2 * D) - 125 * Math.sin(D) - 110 * Math.sin(l + ls)
    + 148 * Math.sin(l - ls) - 55 * Math.sin(2 * F - 2 * D);
  const S = F + (dL + 412 * Math.sin(2 * F) + 541 * Math.sin(ls)) / ARCSEC;
  const h = F - 2 * D;
  const N = -526 * Math.sin(h) + 44 * Math.sin(l + h) - 31 * Math.sin(-l + h) - 23 * Math.sin(ls + h)
    + 11 * Math.sin(-ls + h) - 25 * Math.sin(-2 * l + F) + 21 * Math.sin(-l + F);
  const lon = norm360(360 * frac(L0 + dL / 1_296_000));
  const lat = deg((18520 * Math.sin(S) + N) / ARCSEC);

  // Distance: the largest terms of Meeus table 47.A, in km.
  const distanceKm = 385_000.56 - 20_905.355 * Math.cos(l) - 3699.111 * Math.cos(2 * D - l) - 2955.968 * Math.cos(2 * D)
    - 569.925 * Math.cos(2 * l) + 48.888 * Math.cos(ls) - 3.149 * Math.cos(2 * F) + 246.158 * Math.cos(2 * D - 2 * l)
    - 152.138 * Math.cos(2 * D - ls - l) - 170.733 * Math.cos(2 * D + l) - 204.586 * Math.cos(2 * D - ls)
    - 129.62 * Math.cos(ls - l) + 108.743 * Math.cos(D) + 104.755 * Math.cos(ls + l);

  // The sun's apparent longitude (as in sun.ts), for the moon's elongation.
  const M = 357.52911 + 35999.05029 * t;
  const sunLon = 280.46646 + 36000.76983 * t
    + 1.914602 * Math.sin(rad(M)) + 0.019993 * Math.sin(rad(2 * M)) - 0.00569;
  const elongation = norm360(lon - sunLon);

  // Phase angle, Meeus 48.4, from the mean elements.
  const phaseAngle = 180 - deg(D) - 6.289 * Math.sin(l) + 2.1 * Math.sin(ls) - 1.274 * Math.sin(2 * D - l)
    - 0.658 * Math.sin(2 * D) - 0.214 * Math.sin(2 * l) - 0.11 * Math.sin(D);
  return { lon, lat, distanceKm, elongation, phaseAngle: norm360(phaseAngle) };
}

export interface MoonPosition {
  /** Degrees above the horizon as seen from the ground (negative below). */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  distanceKm: number;
}

export function moonPosition(date: Date, lat = MINNEAPOLIS.lat, lon = MINNEAPOLIS.lon): MoonPosition {
  const e = ecliptic(date);
  const jd = julianDay(date);
  const t = (jd - 2_451_545) / 36_525;
  const obliq = rad(23.439291 - 0.0130042 * t);
  const lam = rad(e.lon), bet = rad(e.lat);
  const ra = Math.atan2(Math.sin(lam) * Math.cos(obliq) - Math.tan(bet) * Math.sin(obliq), Math.cos(lam));
  const dec = Math.asin(Math.sin(bet) * Math.cos(obliq) + Math.cos(bet) * Math.sin(obliq) * Math.sin(lam));
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2_451_545) + 0.000387933 * t * t;
  const H = rad(norm360(gmst + lon) - deg(ra));
  const phi = rad(lat);
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azimuth = norm360(deg(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))) + 180);
  // The moon is close enough that where you stand shifts it: up to a
  // degree lower than seen from the earth's center.
  const parallax = Math.asin((EARTH_RADIUS_KM / e.distanceKm) * Math.cos(alt));
  return { elevation: deg(alt - parallax), azimuth, distanceKm: e.distanceKm };
}

export type PhaseName =
  | "New moon" | "Waxing crescent" | "First quarter" | "Waxing gibbous"
  | "Full moon" | "Waning gibbous" | "Last quarter" | "Waning crescent";

export interface MoonPhase {
  /** Fraction of the disc that's lit, 0–1. */
  illumination: number;
  /** Degrees ahead of the sun, 0 (new) → 90 (first quarter) → 180 (full) → 270 (last quarter). */
  elongation: number;
  waxing: boolean;
  name: PhaseName;
}

/** The four main phases are named for about half a day either side. */
const NAMED_WINDOW = 7;

export function moonPhase(date: Date): MoonPhase {
  const { elongation, phaseAngle } = ecliptic(date);
  const illumination = (1 + Math.cos(rad(phaseAngle))) / 2;
  const near = (a: number) => Math.abs(((elongation - a + 540) % 360) - 180) <= NAMED_WINDOW;
  const waxing = elongation < 180;
  const name: PhaseName = near(0) ? "New moon" : near(90) ? "First quarter" : near(180) ? "Full moon" : near(270) ? "Last quarter"
    : waxing ? (elongation < 90 ? "Waxing crescent" : "Waxing gibbous")
    : elongation < 270 ? "Waning gibbous" : "Waning crescent";
  return { illumination, elongation, waxing, name };
}

/**
 * The next moment the moon reaches a given elongation (0 new, 90 first
 * quarter, 180 full, 270 last quarter) after `from`.
 */
export function nextPhase(from: Date, target: number): Date {
  let t = from.getTime() + (norm360(target - ecliptic(from).elongation) / 360) * SYNODIC_DAYS * 86_400_000;
  for (let i = 0; i < 4; i++) {
    const off = ((ecliptic(new Date(t)).elongation - target + 540) % 360) - 180;
    t -= (off / 12.19) * 86_400_000;
  }
  return new Date(t);
}

/**
 * The upper limb on the horizon, with the usual 34′ of refraction: the
 * definition behind published moonrise and moonset times.
 */
function aboveRiseLine(date: Date, lat: number, lon: number): number {
  const p = moonPosition(date, lat, lon);
  const semidiameter = deg(Math.asin(MOON_RADIUS_KM / p.distanceKm));
  return p.elevation + 34 / 60 + semidiameter;
}

export interface MoonEvent { kind: "rise" | "set"; at: Date }

/** Moonrises and moonsets between two moments, to the nearest few seconds. */
export function moonEvents(start: Date, end: Date, lat = MINNEAPOLIS.lat, lon = MINNEAPOLIS.lon): MoonEvent[] {
  const STEP = 10 * 60_000;
  const events: MoonEvent[] = [];
  let t0 = start.getTime();
  let h0 = aboveRiseLine(start, lat, lon);
  while (t0 < end.getTime()) {
    const t1 = Math.min(end.getTime(), t0 + STEP);
    const h1 = aboveRiseLine(new Date(t1), lat, lon);
    if ((h0 < 0) !== (h1 < 0)) {
      let a = t0, b = t1, ha = h0;
      while (b - a > 5000) {
        const m = (a + b) / 2;
        const hm = aboveRiseLine(new Date(m), lat, lon);
        if ((hm < 0) === (ha < 0)) { a = m; ha = hm; } else b = m;
      }
      events.push({ kind: h1 >= 0 ? "rise" : "set", at: new Date(Math.round((a + b) / 2)) });
    }
    t0 = t1; h0 = h1;
  }
  return events;
}

export interface Moon {
  position: MoonPosition;
  phase: MoonPhase;
  /** Up now, by the published rise/set definition. */
  up: boolean;
  /** The next moonset if it's up, or moonrise if it's down. */
  next?: MoonEvent;
  nextFull: Date;
  nextNew: Date;
  at: Date;
}

export function moonAt(date: Date): Moon {
  const up = aboveRiseLine(date, MINNEAPOLIS.lat, MINNEAPOLIS.lon) >= 0;
  // The moon runs about 50 minutes later each day, so look a day and a half ahead.
  const next = moonEvents(date, new Date(date.getTime() + 36 * 3_600_000)).find((e) => e.kind === (up ? "set" : "rise"));
  return {
    position: moonPosition(date), phase: moonPhase(date), up, next,
    nextFull: nextPhase(date, 180), nextNew: nextPhase(date, 0), at: date,
  };
}

// --- in words ----------------------------------------------------------------

const DIRECTIONS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export const compassWord = (az: number) => DIRECTIONS[Math.round(norm360(az) / 45) % 8];

const TZ = "America/Chicago";
const clockTime = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" }).format(d);
const dayName = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" }).format(d);

/** "3:12 AM", or "7:41 PM tomorrow" when it's tomorrow and could be mistaken for today. */
function when(event: Date, now: Date): string {
  const tomorrow = dayKey(event) !== dayKey(now) && event.getTime() - now.getTime() > 12 * 3_600_000;
  return `${clockTime(event)}${tomorrow ? " tomorrow" : ""}`;
}

/**
 * "The moon" / "Waxing gibbous, 87% lit. Up now in the southeast, 34°
 * above the horizon. Sets at 3:12 AM."
 */
export function describeMoon(m: Moon): Description {
  const { phase, position } = m;
  const lit = Math.round(phase.illumination * 100);
  const sky = m.up
    ? `Up now in the ${compassWord(position.azimuth)}, ${Math.max(0, Math.round(position.elevation))}° above the horizon.`
    : "Below the horizon now.";
  const where = (at: Date) => compassWord(moonPosition(at).azimuth);
  const next = !m.next ? ""
    : m.next.kind === "set" ? ` Sets at ${when(m.next.at, m.at)}.`
    : ` Rises at ${when(m.next.at, m.at)} in the ${where(m.next.at)}.`;
  const full = phase.name === "Full moon";
  const meta = full ? `Next new moon ${dayName(m.nextNew)}` : `Next full moon ${dayName(m.nextFull)}`;
  return { title: "The moon", detail: `${phase.name}, ${lit}% lit. ${sky}${next}`, meta };
}
