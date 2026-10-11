import { decodePolyline } from "../transit/data.ts";
import type { StationInfo } from "./traffic.ts";
import { dataUrl } from "../dataurl.ts";

/**
 * Baked by scripts/build-mndot.mjs into public/data/freeways.json. A corridor
 * is one road and direction, as `parts`: [station, encoded line] for each
 * stretch that has a sensor, in order along the road. (Older files had one
 * `line` per corridor and a `seg` station per segment of it; a browser can
 * still hold one for an hour after a deploy, so both are read.)
 */
interface FreewaysFile {
  stations: Record<string, StationInfo>;
  corridors: { route: string; dir: string; parts?: [string, string][]; line?: string; seg?: string[] }[];
}

/** A stretch of freeway whose speed comes from one sensor station. */
export interface Stretch {
  /** Which corridor (road and direction) this stretch is on; consecutive stretches with the same value are neighbors along it. */
  corridor: number;
  station: string;
  path: [number, number][];
}

export interface Freeways {
  stations: Record<string, StationInfo>;
  stretches: Stretch[];
}

export function parseFreeways(file: FreewaysFile): Freeways {
  const stretches: Stretch[] = [];
  file.corridors.forEach((c, corridor) => {
    if (c.parts) {
      for (const [station, line] of c.parts) stretches.push({ corridor, station, path: decodePolyline(line) });
      return;
    }
    // Legacy: merge consecutive segments that share a station into one stretch.
    const pts = decodePolyline(c.line ?? "");
    let cur: Stretch | undefined;
    (c.seg ?? []).forEach((station, i) => {
      if (!station) { cur = undefined; return; }
      if (cur && cur.station === station) cur.path.push(pts[i + 1]);
      else { cur = { corridor, station, path: [pts[i], pts[i + 1]] }; stretches.push(cur); }
    });
  });
  return { stations: file.stations, stretches };
}

export async function loadFreeways(url = dataUrl("freeways.json")): Promise<Freeways> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load freeway layout (${res.status}). Run: node scripts/build-mndot.mjs`);
  return parseFreeways(await res.json());
}
