/**
 * Recent police drone flights, drawn as their flight paths and fading out
 * over a couple of days. A flight is a moment, not a place that stays marked.
 */
import type { DroneFlight, DronesResponse } from "../../functions/api/drones.ts";
import { ago } from "../crime/crime.ts";
import type { Description } from "../describe.ts";

export type { DroneFlight, DronesResponse };

/** Days after which a flight has fully faded and is no longer shown. */
export const FADE_DAYS = 2;

/** 1 (just reported) fading to 0 (fully aged out); never negative. */
export function droneStrength(f: DroneFlight, nowS: number): number {
  return Math.max(0, Math.min(1, 1 - (nowS - f.takeoff) / 86_400 / FADE_DAYS));
}

export function describeDrone(f: DroneFlight, nowS: number): Description {
  return {
    title: "A police drone was sent to a call.",
    detail: `${f.city}, ${ago(Math.max(0, nowS - f.takeoff))}. Reason logged: ${f.reason}.`,
    meta: `${f.city} police drone flight log · location approximate`,
  };
}
