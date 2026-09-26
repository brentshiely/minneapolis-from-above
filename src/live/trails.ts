import { distM } from "../transit/data.ts";
import type { LonLat } from "./geometry.ts";

/** How long a trail lasts, in seconds. */
export const TRAIL_S = 90;
/** Seconds between stored trail points. */
const SAMPLE_S = 1;
/** A jump longer than this between samples is a teleport; the trail restarts. */
const BREAK_M = 250;
/** A trail spanning less than this has nothing to draw. */
const MIN_SPAN_M = 0.5;

/** Anything that moves and can leave a trail. */
export interface Mover {
  id: string;
  position: LonLat;
}

export interface Trail<T extends Mover = Mover> {
  vehicle: T;
  path: LonLat[];
  /** The same path as flat [lon, lat, lon, lat, ...] for deck.gl. */
  flat: Float64Array;
  /** Seconds on the page clock, one per path point. */
  times: number[];
}

/**
 * Recent drawn positions for every vehicle. Points are stored once a second;
 * `snapshot` appends each vehicle's current position so the trail meets the
 * vehicle exactly.
 */
/** A trail as stored between samples. */
type Stored<T> = { vehicle: T; path: LonLat[]; times: number[] };

export class Trails<T extends Mover> {
  private trails = new Map<string, Stored<T>>();
  private lastSample = -Infinity;
  private seconds: number;

  constructor(seconds = TRAIL_S) {
    this.seconds = seconds;
  }

  record(movers: Map<string, T>, now: number) {
    if (now - this.lastSample < SAMPLE_S) return;
    this.lastSample = now;
    const cutoff = now - this.seconds;
    for (const v of movers.values()) {
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
    for (const id of this.trails.keys()) if (!movers.has(id)) this.trails.delete(id);
  }

  /** Trails with each vehicle's live position appended as the head. */
  snapshot(now: number): Trail<T>[] {
    const out: Trail<T>[] = [];
    for (const t of this.trails.values()) {
      const head = t.vehicle.position;
      const last = t.path[t.path.length - 1];
      if (!last) continue;
      if (distM(last, head) > BREAK_M) continue; // mid-teleport; restarts next sample
      // Skip vehicles that haven't moved: nothing to draw, and a path whose
      // points all coincide is one deck.gl would misread as a closed loop.
      if (!t.path.some((p) => distM(p, head) > MIN_SPAN_M)) continue;
      const path = [...t.path, head];
      const flat = new Float64Array(path.length * 2);
      path.forEach((p, i) => { flat[i * 2] = p[0]; flat[i * 2 + 1] = p[1]; });
      out.push({ vehicle: t.vehicle, path, flat, times: [...t.times, now] });
    }
    return out;
  }
}
