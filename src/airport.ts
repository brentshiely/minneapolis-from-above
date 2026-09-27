/**
 * MSP's own operating status from the FAA's feed: quiet on an ordinary
 * day, a plain-language note when a ground stop, ground delay, general
 * delay or closure is active.
 */
import type { Description } from "./describe.ts";
import type { AirportResponse, MspStatus } from "../functions/api/airport.ts";

export type { AirportResponse, MspStatus };

export const MSP_POSITION: [number, number] = [-93.2218, 44.882];

/** FAA reason codes are terse ("TM Initiatives:MIT:WX"); read the gist in plain words. */
export function reasonWord(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes("wind")) return "wind";
  if (r.includes("ceiling")) return "low clouds";
  if (r.includes("volume")) return "heavy traffic";
  if (r.includes("wx") || r.includes("weather")) return "weather";
  if (r.includes("mit") || r.includes("tm initiatives")) return "traffic management";
  if (r.includes("thunderstorm")) return "thunderstorms";
  return raw;
}

/** Worst-first, for picking the one line that matters most when several apply at once. */
const SEVERITY: Record<MspStatus["kind"], number> = { closure: 0, "ground-stop": 1, "ground-delay": 2, delay: 3 };

function line(s: MspStatus): string {
  switch (s.kind) {
    case "closure": return `Closed: ${reasonWord(s.reason)}.`;
    case "ground-stop": return `Ground stop: ${reasonWord(s.reason)}, until ${s.until}.`;
    case "ground-delay": return `Ground delay: ${reasonWord(s.reason)}, averaging ${s.avg}.`;
    case "delay": return `${s.type}s delayed ${s.min} to ${s.max}: ${reasonWord(s.reason)}.`;
  }
}

/** The single most notable line, for the quiet status-line caption. Nothing when all's normal. */
export function airportPhrase(status: MspStatus[]): string | undefined {
  if (!status.length) return undefined;
  const worst = [...status].sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind])[0];
  return `MSP ${line(worst).charAt(0).toLowerCase()}${line(worst).slice(1)}`;
}

export function describeAirport(status: MspStatus[]): Description {
  if (!status.length) return { title: "Minneapolis–Saint Paul International Airport.", detail: "Normal operations, no delays.", meta: "FAA status" };
  const sorted = [...status].sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind]);
  return { title: "Minneapolis–Saint Paul International Airport.", detail: sorted.map(line).join(" "), meta: "FAA status" };
}

const PREVIEW: Record<string, MspStatus> = {
  groundstop: { kind: "ground-stop", reason: "wind", until: "3:30 pm CDT" },
  grounddelay: { kind: "ground-delay", reason: "low ceilings", avg: "48 minutes", max: "1 hour and 42 minutes" },
  delay: { kind: "delay", type: "Departure", reason: "TM Initiatives:MIT:WX", min: "15 minutes", max: "29 minutes", trend: "Decreasing" },
  closure: { kind: "closure", reason: "snow removal", start: "6:00 am CDT", reopen: "9:00 am CDT" },
};

/** `?msp=delay` (or groundstop, grounddelay, closure) previews a status. */
export function previewAirport(spec: string): AirportResponse | undefined {
  const s = PREVIEW[spec.trim().toLowerCase()];
  if (!s) return undefined;
  return { t: Math.floor(Date.now() / 1000), status: [s] };
}
