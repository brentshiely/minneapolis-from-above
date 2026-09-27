import { mixColor } from "../color.ts";

/**
 * Air quality from Open-Meteo's forecast model: the US AQI, which pollutant
 * drives it, and the faint haze the map shows when the air turns bad.
 */

/** What's behind the number, in words a passer-by would use. */
export type Pollutant = "smoke" | "fine particles" | "dust" | "ozone" | "nitrogen dioxide" | "sulfur dioxide" | "carbon monoxide";

export interface Air {
  /** POSIX seconds the reading is for. */
  t: number;
  /** US Air Quality Index, 0 to 500. */
  aqi: number;
  /** The pollutant with the highest sub-index; undefined if the source didn't say. */
  pollutant?: Pollutant;
}

/** Open-Meteo's `current` block, asking for these sub-indices. */
export const FIELDS = ["us_aqi", "us_aqi_pm2_5", "us_aqi_pm10", "us_aqi_ozone", "us_aqi_nitrogen_dioxide", "us_aqi_sulphur_dioxide", "us_aqi_carbon_monoxide"] as const;

export interface OpenMeteoAir {
  utc_offset_seconds?: number;
  current?: { time?: string } & Partial<Record<(typeof FIELDS)[number], number | null>>;
}

/**
 * Fine particles above "unhealthy for sensitive groups" in Minnesota are
 * nearly always wildfire smoke; lower readings could be anything (traffic,
 * a winter inversion), so they get the neutral name.
 */
const SMOKE_AT = 101;

export function parseAir(body: OpenMeteoAir): Air | undefined {
  const c = body.current;
  if (!c || typeof c.us_aqi !== "number") return undefined;
  // Open-Meteo times are local to the requested zone, without an offset.
  const local = c.time ? Date.parse(`${c.time}Z`) : NaN;
  const t = Number.isFinite(local) ? local / 1000 - (body.utc_offset_seconds ?? 0) : Math.floor(Date.now() / 1000);
  const subs: [Pollutant, number | null | undefined][] = [
    ["fine particles", c.us_aqi_pm2_5], ["dust", c.us_aqi_pm10], ["ozone", c.us_aqi_ozone],
    ["nitrogen dioxide", c.us_aqi_nitrogen_dioxide], ["sulfur dioxide", c.us_aqi_sulphur_dioxide], ["carbon monoxide", c.us_aqi_carbon_monoxide],
  ];
  let pollutant: Pollutant | undefined;
  let top = -1;
  for (const [name, v] of subs) if (typeof v === "number" && v > top) { top = v; pollutant = name; }
  if (pollutant === "fine particles" && top >= SMOKE_AT) pollutant = "smoke";
  return { t, aqi: Math.round(c.us_aqi), pollutant };
}

/** The EPA's six bands, in its own plain words. */
export function category(aqi: number): string {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy for sensitive groups";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very unhealthy";
  return "hazardous";
}

/**
 * For the status line, and only when it matters: nothing at all while the
 * air is good. e.g. "AQI 112, unhealthy for sensitive groups (smoke)".
 */
export function airPhrase(air: Air | undefined): string | undefined {
  if (!air || air.aqi <= 50) return undefined;
  return `AQI ${air.aqi}, ${category(air.aqi)}${air.pollutant ? ` (${air.pollutant})` : ""}`;
}

/** [AQI, haze opacity] stops: none when good, never enough to hide the map. */
const HAZE: [number, number][] = [[50, 0], [51, 0.05], [100, 0.12], [150, 0.24], [200, 0.34], [300, 0.44], [500, 0.52]];

/** Haze strength, 0 to about half, for an AQI. */
export function hazeStrength(aqi: number): number {
  if (!(aqi > HAZE[0][0])) return 0;
  for (let i = 1; i < HAZE.length; i++) {
    const [a1, s1] = HAZE[i];
    if (aqi <= a1) {
      const [a0, s0] = HAZE[i - 1];
      return s0 + ((aqi - a0) / (a1 - a0)) * (s1 - s0);
    }
  }
  return HAZE[HAZE.length - 1][1];
}

/** Particles make a warm, brownish murk; ozone and gases a paler, thinner haze. */
export const isParticulate = (p: Pollutant | undefined) => p === undefined || p === "smoke" || p === "fine particles" || p === "dust";

/**
 * The haze color for a pollutant at daylight `d` (0 night, 1 day). Smoke
 * at night picks up the city's sodium glow; by day it's a sepia cast.
 */
export function hazeColor(p: Pollutant | undefined, d: number): string {
  return isParticulate(p) ? mixColor("#76604a", "#a88c6c", d) : mixColor("#6a7078", "#dcdcd2", d);
}

/** How strongly the haze draws for this reading: gases stay paler. */
export function hazeFor(air: Air | undefined): number {
  if (!air) return 0;
  return hazeStrength(air.aqi) * (isParticulate(air.pollutant) ? 1 : 0.7);
}

/**
 * `?air=150`, `?air=smoke-200`, `?air=ozone-120`, `?air=dust-90`... previews
 * a reading without waiting for bad air. A bare number means smoke above
 * 100, fine particles below.
 */
export function previewAir(spec: string): Air | undefined {
  const s = spec.toLowerCase();
  const n = Number(/\d+/.exec(s)?.[0]);
  if (!Number.isFinite(n)) return undefined;
  const aqi = Math.min(500, n);
  const pollutant: Pollutant = s.includes("ozone") ? "ozone" : s.includes("dust") ? "dust"
    : s.includes("smoke") || aqi >= SMOKE_AT ? "smoke" : "fine particles";
  return { t: Date.now() / 1000, aqi, pollutant };
}
