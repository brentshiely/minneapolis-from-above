/**
 * Scans every satellite off the main thread. Every few seconds the page
 * asks: which satellites will cross this patch of map soon, and how many
 * are above Minneapolis's horizon? Only those few are then animated
 * frame by frame on the main thread.
 */
import { parseTles, positionAt, satrecOf, type Tle } from "./orbits.ts";
import type { SatRec } from "satellite.js";

export type ToWorker =
  | { type: "init"; tle: string }
  | { type: "scan"; time: number; bbox: [number, number, number, number]; aheadS: number };

export type FromWorker =
  | { type: "ready"; count: number }
  | { type: "scan"; candidates: Tle[]; aboveHorizon: number };

let sats: { tle: Tle; rec: SatRec }[] = [];

/** The worker's own scope, typed without pulling worker types into the whole project. */
const scope = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((ev: MessageEvent<ToWorker>) => void) | null };

const inBox = (lon: number, lat: number, [w, s, e, n]: [number, number, number, number]) => lon >= w && lon <= e && lat >= s && lat <= n;

scope.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    sats = [];
    for (const tle of parseTles(msg.tle)) {
      const rec = satrecOf(tle);
      if (rec) sats.push({ tle, rec });
    }
    scope.postMessage({ type: "ready", count: sats.length });
    return;
  }
  if (msg.type === "scan") {
    const now = new Date(msg.time);
    const steps = 4;
    const candidates: Tle[] = [];
    let above = 0;
    for (const s of sats) {
      const p = positionAt(s.rec, now, true);
      if (!p) continue;
      if (p.elevation > 0) above++;
      // In the box now, or at any of a few moments over the coming scan window?
      let hit = inBox(p.lon, p.lat, msg.bbox);
      for (let k = 1; !hit && k <= steps; k++) {
        const q = positionAt(s.rec, new Date(msg.time + (msg.aheadS * 1000 * k) / steps), false);
        if (q && inBox(q.lon, q.lat, msg.bbox)) hit = true;
      }
      if (hit) candidates.push(s.tle);
    }
    scope.postMessage({ type: "scan", candidates, aboveHorizon: above });
  }
};
