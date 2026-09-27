/**
 * NWS watches, warnings and advisories touching the metro: how to color
 * one, the legend of what's currently active, and the plain-language
 * hover description. The geometry and filtering live server-side
 * (functions/api/warnings.ts); this is all pure and testable without it.
 */
import type { Description } from "../describe.ts";
import type { RGB } from "../color.ts";
import type { Warning, WarningsResponse } from "../../functions/api/warnings.ts";

export type { Warning, WarningsResponse };

/**
 * The map convention most US weather sites use, so it reads as familiar
 * rather than invented. Anything not listed here (an unusual advisory
 * type NWS hasn't been asked about before) still shows, in a neutral
 * amber, rather than being silently dropped.
 */
const EVENT_COLOR: Record<string, RGB> = {
  "Tornado Warning": [255, 0, 0],
  "Tornado Watch": [255, 255, 0],
  "Severe Thunderstorm Warning": [255, 165, 0],
  "Severe Thunderstorm Watch": [219, 112, 147],
  "Flash Flood Warning": [46, 139, 87],
  "Flash Flood Watch": [46, 139, 87],
  "Flood Warning": [0, 255, 0],
  "Flood Watch": [46, 139, 87],
  "Flood Advisory": [0, 255, 127],
  "Winter Storm Warning": [255, 105, 180],
  "Winter Storm Watch": [70, 130, 180],
  "Winter Weather Advisory": [123, 104, 238],
  "Ice Storm Warning": [139, 0, 139],
  "Blizzard Warning": [255, 69, 0],
  "Wind Chill Warning": [176, 196, 222],
  "Wind Chill Advisory": [175, 238, 238],
  "Excessive Heat Warning": [199, 21, 133],
  "Heat Advisory": [255, 140, 0],
  "High Wind Warning": [218, 165, 32],
  "Wind Advisory": [210, 180, 140],
  "Freeze Warning": [72, 61, 139],
  "Frost Advisory": [100, 149, 237],
  "Special Weather Statement": [255, 228, 181],
};
const FALLBACK_COLOR: RGB = [230, 180, 90];

export function warningColor(event: string): RGB {
  return EVENT_COLOR[event] ?? FALLBACK_COLOR;
}

export function rgbCss([r, g, b]: RGB): string {
  return `rgb(${r}, ${g}, ${b})`;
}

const SEVERITY_RANK: Record<string, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
export function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 4;
}

/** A slow, quiet breathing: never fully dims, never flashes. */
export function pulse(now: number): number {
  return 0.72 + 0.28 * Math.sin(now * ((2 * Math.PI) / 3.2));
}

/** One entry per distinct event type currently active, most severe first. */
export function legend(warnings: Warning[]): { event: string; color: RGB }[] {
  const seen = new Map<string, Warning>();
  for (const w of warnings) if (!seen.has(w.event)) seen.set(w.event, w);
  return [...seen.values()]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.event.localeCompare(b.event))
    .map((w) => ({ event: w.event, color: warningColor(w.event) }));
}

export function describeWarning(w: Warning): Description {
  const until = w.expires > 0
    ? `Until ${new Date(w.expires * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}`
    : undefined;
  return {
    title: `${w.event}.`,
    detail: w.headline,
    meta: until ? `${until} · National Weather Service` : "National Weather Service",
  };
}

/**
 * `?warning=tornado` (etc.) previews a synthetic one over the metro's
 * core, so the feature can be checked without waiting for real severe
 * weather. Roughly a box over the northwest metro.
 */
const PREVIEW_BOX: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [[[-93.42, 45.05], [-93.15, 45.05], [-93.15, 45.20], [-93.42, 45.20], [-93.42, 45.05]]],
};
const PREVIEWS: Record<string, { event: string; severity: string; headline: string }> = {
  tornado: { event: "Tornado Warning", severity: "Extreme", headline: "Tornado Warning for northwestern Hennepin and southern Anoka counties until 7:45 PM CDT. Take shelter now." },
  severe: { event: "Severe Thunderstorm Warning", severity: "Severe", headline: "Severe Thunderstorm Warning for northern Hennepin County until 7:15 PM CDT. 60 mph wind gusts and quarter-size hail possible." },
  winter: { event: "Winter Storm Warning", severity: "Moderate", headline: "Winter Storm Warning from 6 PM this evening to noon Tuesday. Total snow accumulations of 8 to 12 inches expected." },
};
export function previewWarning(spec: string): WarningsResponse | undefined {
  const preset = PREVIEWS[spec.trim().toLowerCase()];
  if (!preset) return undefined;
  const t = Math.floor(Date.now() / 1000);
  return {
    t,
    w: [{ id: `preview-${spec}`, event: preset.event, severity: preset.severity, headline: preset.headline, expires: t + 3600, geometry: PREVIEW_BOX }],
  };
}
