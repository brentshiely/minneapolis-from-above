/**
 * Minnehaha Falls: a fixed landmark, not a moving feed. Its flow comes
 * from the nearest live gauge already in the water data (GM-18),
 * Minnehaha Creek at Hiawatha Ave, about 150 m downstream of the falls
 * (44.9151, -93.2109 per the National Park Service; the gauge itself
 * sits at 44.9156, -93.2125).
 */
import type { Description } from "../describe.ts";
import { ago } from "../describe.ts";
import type { Gauge } from "./gauges.ts";

export const FALLS_LOCATION: [number, number] = [-93.2109, 44.9151];
export const FALLS_GAUGE_LID = "MHAM5";

export type FlowLevel = "dry" | "trickle" | "gentle" | "flowing" | "roaring";

/**
 * Minnehaha Creek is a dam-controlled outflow of Lake Minnetonka: it runs
 * a few cfs on an ordinary dry day, and can pass a few hundred at flood.
 * Cutoffs are informal, not a hydrologic standard.
 */
export function flowLevel(cfs: number): FlowLevel {
  if (cfs < 1) return "dry";
  if (cfs < 10) return "trickle";
  if (cfs < 40) return "gentle";
  if (cfs < 150) return "flowing";
  return "roaring";
}

const FLOW_WORDS: Record<FlowLevel, string> = {
  dry: "Essentially dry",
  trickle: "A trickle",
  gentle: "Flowing gently",
  flowing: "Running well",
  roaring: "Roaring",
};

/** A gentle visual shimmer only kicks in once the falls has real flow. */
export function shimmerStrength(level: FlowLevel): number {
  return { dry: 0, trickle: 0, gentle: 0.35, flowing: 0.7, roaring: 1 }[level];
}

export function describeFalls(gauge: Gauge | undefined, nowS: number): Description {
  if (!gauge || gauge.flowKcfs === null) {
    return {
      title: "Minnehaha Falls.",
      detail: "A 53-foot waterfall on Minnehaha Creek, fed by Lake Minnetonka's outflow at Gray's Bay Dam.",
      meta: "No current flow reading",
    };
  }
  const cfs = gauge.flowKcfs * 1000;
  const level = flowLevel(cfs);
  const flow = cfs < 1 ? "under 1" : Math.round(cfs).toLocaleString("en-US");
  const detail = level === "dry"
    ? `${FLOW_WORDS.dry}: ${flow} cubic feet a second.`
    : `${FLOW_WORDS[level]}: ${flow} cubic feet a second.`;
  return {
    title: "Minnehaha Falls.",
    detail,
    meta: `Minnehaha Creek at Hiawatha Ave · updated ${ago(nowS - gauge.t)}`,
  };
}
