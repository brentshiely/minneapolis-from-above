/**
 * Filling the holes in MnDOT's sensor coverage.
 *
 * A detector routinely drops out for a cycle or two, leaving one stretch of
 * freeway blank between neighbors that are reporting, and (since cars follow
 * the readings) empty of cars. Traffic doesn't actually vanish for a quarter
 * mile, so a stretch with no speed borrows from the nearest reporting
 * stretches either side of it on the same road, weighted by how close each
 * is. It's marked estimated so it can be drawn dimmer and described as such,
 * and a hole too wide to trust the neighbors across (no sensors for a mile or
 * more) stays blank rather than invented.
 */
import { distM } from "../transit/data.ts";
import type { Freeways, Stretch } from "./freeways.ts";
import type { Readings } from "./traffic.ts";

/** Farthest a hole may be from a reporting neighbor (hole's midpoint to the neighbor's midpoint) and still borrow from it. */
export const MAX_FILL_M = 2500;

export interface Filled {
  /** The raw readings plus an estimate for every hole that could be filled. */
  readings: Readings;
  /** Stations whose speed is an estimate. */
  estimated: Set<string>;
}

const pathLength = (s: Stretch): number => {
  let m = 0;
  for (let i = 1; i < s.path.length; i++) m += distM(s.path[i - 1], s.path[i]);
  return m;
};

type Field = 0 | 1;

export function fillGaps(fw: Freeways, raw: Readings): Filled {
  const readings: Readings = { ...raw };
  const estimated = new Set<string>();
  const { stretches } = fw;
  const lens = stretches.map(pathLength);
  const has = (i: number, f: Field) => raw[stretches[i].station]?.[f] != null;

  /** Distance to, and index of, the nearest stretch reporting this field in one direction along the same road. */
  const nearest = (i: number, f: Field, step: 1 | -1): { i: number; d: number } | undefined => {
    let d = lens[i] / 2;
    for (let j = i + step; j >= 0 && j < stretches.length && stretches[j].corridor === stretches[i].corridor; j += step) {
      if (d + lens[j] / 2 > MAX_FILL_M) return undefined;
      if (has(j, f)) return { i: j, d: d + lens[j] / 2 };
      d += lens[j];
    }
    return undefined;
  };

  const estimate = (i: number, f: Field): number | undefined => {
    const a = nearest(i, f, -1), b = nearest(i, f, 1);
    const va = a && (raw[stretches[a.i].station][f] as number), vb = b && (raw[stretches[b.i].station][f] as number);
    if (a && b) {
      // Nearer neighbor counts for more; the +100 keeps an adjacent stretch from swamping the weights.
      const wa = 1 / (a.d + 100), wb = 1 / (b.d + 100);
      return (va! * wa + vb! * wb) / (wa + wb);
    }
    return va ?? vb;
  };

  const done = new Set<string>();
  stretches.forEach((s, i) => {
    if (done.has(s.station)) return;
    const have = raw[s.station];
    const speed = have?.[0] ?? null, flow = have?.[1] ?? null;
    if (speed !== null && flow !== null) return;
    done.add(s.station);
    const fSpeed = speed ?? estimate(i, 0) ?? null;
    const fFlow = flow ?? estimate(i, 1) ?? null;
    if (fSpeed === null && fFlow === null) return;
    readings[s.station] = [fSpeed, fFlow === null ? null : Math.round(fFlow)];
    if (speed === null && fSpeed !== null) estimated.add(s.station);
  });
  return { readings, estimated };
}
