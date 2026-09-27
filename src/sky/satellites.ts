import { kindOf, positionAt, satrecOf, type Kind, type SatPosition, type Tle } from "./orbits.ts";
import type { FromWorker, ToWorker } from "./satWorker.ts";
import type { SatRec } from "satellite.js";

/** Rescan all satellites this often, looking this far ahead. */
const SCAN_S = 10;
const AHEAD_S = 20;
/** Seconds of ground track drawn behind each satellite. */
export const SAT_TRAIL_S = 24;

export interface Sat {
  id: number;
  name: string;
  kind: Kind;
  position: [number, number];
  heading: number;
  live: SatPosition;
  /** Ground track behind it: flat [lon, lat, ...] and page-clock times. */
  trail: Float64Array;
  times: number[];
}

/**
 * Every active satellite, animated only while it's crossing the map.
 * A worker scans all ~16,000 every few seconds; the main thread tracks the
 * handful near the view each frame.
 */
export class Satellites {
  private worker: Worker;
  private recs = new Map<number, { tle: Tle; rec: SatRec }>();
  private lastScan = -Infinity;
  private bbox: () => [number, number, number, number];
  ready = false;
  total = 0;
  /** Working satellites, and debris pieces, above Minneapolis's horizon at the last scan. */
  aboveHorizon = 0;
  debrisAbove = 0;
  list: Sat[] = [];

  constructor(bbox: () => [number, number, number, number]) {
    this.bbox = bbox;
    this.worker = new Worker(new URL("./satWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === "ready") { this.ready = true; this.total = m.count; this.lastScan = -Infinity; }
      else if (m.type === "scan") {
        this.aboveHorizon = m.aboveHorizon;
        this.debrisAbove = m.debrisAbove;
        const keep = new Map<number, { tle: Tle; rec: SatRec }>();
        for (const tle of m.candidates) {
          const had = this.recs.get(tle.id);
          const rec = had?.rec ?? satrecOf(tle);
          if (rec) keep.set(tle.id, { tle, rec });
        }
        this.recs = keep;
      }
    };
    this.load();
  }

  /**
   * Working satellites first, then the tracked debris clouds as a second
   * batch: fresh from the live endpoint, or the deploy's snapshot.
   */
  private async load() {
    const active = await fetchTle(["/api/satellites", "/data/satellites.tle"]);
    if (active) this.post({ type: "init", tle: active });
    const debris = await fetchTle(["/api/debris", "/data/debris.tle"]);
    if (debris) this.post({ type: active ? "add" : "init", tle: debris });
  }

  private post(m: ToWorker) { this.worker.postMessage(m); }

  /** Call every frame with the page clock in seconds. */
  frame(nowS: number) {
    if (!this.ready) return;
    const wall = Date.now();
    if (nowS - this.lastScan >= SCAN_S) {
      this.lastScan = nowS;
      const [w, s, e, n] = this.bbox();
      // Pad the view so satellites are picked up just before they enter it.
      const padLon = Math.max(1.5, (e - w) * 0.25), padLat = Math.max(1, (n - s) * 0.25);
      this.post({ type: "scan", time: wall, bbox: [w - padLon, s - padLat, e + padLon, n + padLat], aheadS: AHEAD_S });
    }
    const out: Sat[] = [];
    for (const { tle, rec } of this.recs.values()) {
      const now = positionAt(rec, new Date(wall), true);
      if (!now) continue;
      const before = positionAt(rec, new Date(wall - 1000), false);
      const heading = before ? bearing(before.lon, before.lat, now.lon, now.lat) : 0;
      // A short ground track, computed exactly rather than recorded.
      const n = 7, trail = new Float64Array(n * 2), times: number[] = [];
      for (let k = 0; k < n; k++) {
        const dt = SAT_TRAIL_S * (1 - k / (n - 1));
        const p = k === n - 1 ? now : positionAt(rec, new Date(wall - dt * 1000), false);
        trail[k * 2] = p?.lon ?? now.lon; trail[k * 2 + 1] = p?.lat ?? now.lat;
        times.push(nowS - dt);
      }
      out.push({ id: tle.id, name: tle.name, kind: kindOf(tle), position: [now.lon, now.lat], heading, live: now, trail, times });
    }
    this.list = out;
  }
}

async function fetchTle(urls: string[]): Promise<string | undefined> {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (/^1 \d/m.test(text)) return text;
    } catch { /* try the next source */ }
  }
  return undefined;
}

function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const kx = Math.cos(((lat1 + lat2) * Math.PI) / 360);
  return ((Math.atan2((lon2 - lon1) * kx, lat2 - lat1) * 180) / Math.PI + 360) % 360;
}
