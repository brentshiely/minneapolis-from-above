/**
 * Wind made visible: how fast and which way wind threads drift on screen.
 * The scale is fixed and linear, so what you see is proportional to the
 * real wind at every zoom: twice the wind, twice the drift.
 */

/** Screen pixels per second of drift, per mph of wind. */
export const PX_PER_MPH = 6;
/** Below this, it's calm: no threads. */
export const CALM_MPH = 2;

export function driftSpeed(mph: number): number {
  return mph < CALM_MPH ? 0 : mph * PX_PER_MPH;
}

/** A handful of threads in a breeze, more as it picks up, never a swarm. */
export function threadCount(mph: number): number {
  if (mph < CALM_MPH) return 0;
  return Math.round(Math.min(70, 8 + mph * 2.4));
}

/**
 * Unit vector on screen for wind blowing toward `towardDeg` (compass),
 * with the map rotated by `bearingDeg`. Screen y points down.
 */
export function screenVector(towardDeg: number, bearingDeg: number): [number, number] {
  const a = ((towardDeg - bearingDeg) * Math.PI) / 180;
  return [Math.sin(a), -Math.cos(a)];
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** "NW" for wind from 315°. Wind is named for where it comes from. */
export function compass(fromDeg: number): string {
  return POINTS[Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8];
}

/** "NW wind 12 mph, gusting to 25" or "calm". */
export function windPhrase(fromDeg: number | null, mph: number, gustMph: number | null): string {
  if (mph < CALM_MPH) return "calm";
  const dir = fromDeg === null ? "" : `${compass(fromDeg)} `;
  const gust = gustMph !== null && gustMph >= mph + 5 ? `, gusting to ${gustMph}` : "";
  return `${dir}wind ${mph} mph${gust}`;
}
