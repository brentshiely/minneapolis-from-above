/**
 * Recent gunfire calls in Minneapolis, fading out as they age. A call is a
 * moment, not a place that stays marked, so the dot is gone in a couple of
 * days.
 */
import type { GunfireEvent, GunfireResponse } from "../../functions/api/gunfire.ts";
import { ago } from "../crime/crime.ts";
import type { Description } from "../describe.ts";

export type { GunfireEvent, GunfireResponse };

/** Days after which a call is fully faded and no longer shown. */
export const FADE_DAYS = 2;

/** 1 (just reported) fading to 0 (fully aged out); never negative. */
export function gunfireStrength(e: GunfireEvent, nowS: number): number {
  return Math.max(0, Math.min(1, 1 - (nowS - e.reportedAt) / 86_400 / FADE_DAYS));
}

export function describeGunfire(e: GunfireEvent, nowS: number): Description {
  const where = e.precinct ? `, ${e.precinct}` : "";
  return {
    title: `${e.label}${where}.`,
    detail: `Reported ${ago(Math.max(0, nowS - e.reportedAt))} in Minneapolis.`,
    meta: "Minneapolis Police calls · location approximate",
  };
}
