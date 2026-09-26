import { distM } from "../transit/data.ts";
import type { Fleet, Vehicle } from "./fleet.ts";
import type { LonLat } from "./geometry.ts";

/** How long a trail lasts, in seconds. */
export const TRAIL_S = 90;
/** Seconds between stored trail points. */
const SAMPLE_S = 1;
/** A jump longer than this between samples is a teleport; the trail restarts. */
const BREAK_M = 250;

export interface Trail {
  vehicle: Vehicle;
  path: LonLat[];
  /** Seconds on the page clock, one per path point. */
  times: number[];
}

/**
 * Recent drawn positions for every vehicle. Points are stored once a second;
 * `snapshot` appends each vehicle's current position so the trail meets the
 * vehicle exactly.
 */
export class Trails {
  private trails = new Map<string, Trail>();
  private lastSample = -Infinity;

  record(fleet: Fleet, now: number) {
    if (now - this.lastSample < SAMPLE_S) return;
    this.lastSample = now;
    const cutoff = now - TRAIL_S;
    for (const v of fleet.vehicles.values()) {
      let t = this.trails.get(v.id);
      if (!t) this.trails.set(v.id, (t = { vehicle: v, path: [], times: [] }));
      t.vehicle = v;
      const last = t.path[t.path.length - 1];
      if (last && distM(last, v.position) > BREAK_M) { t.path = []; t.times = []; }
      t.path.push([v.position[0], v.position[1]]);
      t.times.push(now);
      let drop = 0;
      while (drop < t.times.length - 1 && t.times[drop] < cutoff) drop++;
      if (drop) { t.path.splice(0, drop); t.times.splice(0, drop); }
    }
    for (const id of this.trails.keys()) if (!fleet.vehicles.has(id)) this.trails.delete(id);
  }

  /** Trails with each vehicle's live position appended as the head. */
  snapshot(now: number): Trail[] {
    const out: Trail[] = [];
    for (const t of this.trails.values()) {
      const head = t.vehicle.position;
      const last = t.path[t.path.length - 1];
      if (!last) continue;
      if (distM(last, head) > BREAK_M) continue; // mid-teleport; restarts next sample
      out.push({ vehicle: t.vehicle, path: [...t.path, head], times: [...t.times, now] });
    }
    return out;
  }
}
