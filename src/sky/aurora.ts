/**
 * Whether tonight's geomagnetic activity reaches far enough south for a
 * chance of aurora over Minneapolis (about 45°N). Kp is NOAA's 0–9
 * planetary index; the standard aurora-oval charts put the visible edge
 * at roughly Kp 5 for the far northern US, Kp 6 for the Twin Cities, and
 * Kp 8+ overhead-bright. Quiet otherwise — this never claims a sighting,
 * only that conditions favor one.
 */
import type { AuroraResponse, KpRow } from "../../functions/api/aurora.ts";

export type { AuroraResponse, KpRow };

const TZ = "America/Chicago";

/** 0 (no chance at this latitude) to 1 (strong, overhead-bright activity). */
export function auroraStrength(kp: number): number {
  return Math.min(1, Math.max(0, (kp - 5.5) / 3));
}

/** Local Minneapolis hour, 0–23, from a POSIX-seconds timestamp. */
function localHour(tSec: number): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(tSec * 1000)));
}

/**
 * The highest forecast Kp between now and sunrise: "tonight" runs from
 * whenever it's already dark through the coming morning, so an evening
 * check and an after-midnight check both look at the same window.
 */
export function tonightKp(rows: KpRow[], nowS: number): number {
  const h = localHour(nowS);
  // Before roughly 6 PM, "tonight" hasn't started; look ahead through
  // tomorrow morning instead of stopping at today's own dusk.
  const startS = nowS;
  const endS = nowS + (h < 18 ? 18 - h : 24 - h + 8) * 3_600;
  let max = 0;
  for (const [t, kp] of rows) if (t >= startS - 3 * 3_600 && t <= endS) max = Math.max(max, kp);
  return max;
}

/** "Northern lights possible tonight" in the status line; quiet otherwise. */
export function auroraPhrase(rows: KpRow[], nowS: number): string | undefined {
  return auroraStrength(tonightKp(rows, nowS)) > 0 ? "Northern lights possible tonight" : undefined;
}

const PREVIEW_KP: Record<string, number> = { quiet: 3, watch: 6, strong: 8 };

/** `?aurora=watch` (or quiet, strong) previews a Kp level without waiting for real activity. */
export function previewAurora(spec: string): AuroraResponse | undefined {
  const kp = PREVIEW_KP[spec.trim().toLowerCase()];
  if (kp === undefined) return undefined;
  const t = Math.floor(Date.now() / 1000);
  return { t, kp: [[t, kp, false]] };
}
