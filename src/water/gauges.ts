/**
 * River and lake gauges from the National Weather Service's water
 * prediction service, and how to talk about them.
 */
import { ago, type Description } from "../describe.ts";

export interface Gauge {
  lid: string;
  /** e.g. "Mississippi River at St. Paul Ford Plant" */
  name: string;
  /** The water body the gauge measures, e.g. "Mississippi River". */
  body: string;
  lat: number;
  lon: number;
  /** Feet: a local gauge height, or an elevation above sea level. */
  stage: number;
  /** Thousands of cubic feet per second, when measured. */
  flowKcfs: number | null;
  /** NWS flood category: no_flooding, action, minor, moderate, major, not_defined. */
  category: string;
  /** POSIX seconds of the reading. */
  t: number;
}

export interface GaugeDetail {
  /** Feet; undefined where NWS hasn't defined one. */
  floodStage?: number;
  actionStage?: number;
  /** Change in the last 24 hours, feet. */
  change24h?: number;
  /** The highest forecast level in the next few days, if it's a rise. */
  crest?: { stage: number; t: number };
}

/** "Mississippi River at St. Paul" -> "Mississippi River"; "Elm Creek (MN) at Champlin" -> "Elm Creek". */
export function waterBody(name: string): string {
  return name.split(/\s+(?:at|above|below|near|abv|blw|nr|in)\s+/i)[0].replace(/\s*\((?:MN|WI)\)\s*/i, "").trim();
}

/** For matching map names to gauge names: "Saint Croix River" and "St. Croix River" are the same river. */
export function sameWater(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\bsaint\b/g, "st.").replace(/\bst\b(?!\.)/g, "st.").replace(/[^a-z.\s]/g, "").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

/** Gauges in the NWS list that have a current reading. */
export function parseGauges(body: { gauges?: Array<{ lid: string; name: string; latitude: number; longitude: number; status?: { observed?: { primary?: number; primaryUnit?: string; secondary?: number; secondaryUnit?: string; floodCategory?: string; validTime?: string } } }> }): Gauge[] {
  const out: Gauge[] = [];
  for (const g of body.gauges ?? []) {
    const o = g.status?.observed;
    if (!o || typeof o.primary !== "number" || o.primary <= -999 || o.primaryUnit !== "ft" || o.floodCategory === "obs_not_current") continue;
    const t = o.validTime ? Date.parse(o.validTime) / 1000 : NaN;
    if (!Number.isFinite(t)) continue;
    out.push({
      lid: g.lid, name: g.name, body: waterBody(g.name), lat: g.latitude, lon: g.longitude,
      stage: o.primary,
      flowKcfs: o.secondaryUnit === "kcfs" && typeof o.secondary === "number" && o.secondary > 0 ? o.secondary : null,
      category: o.floodCategory ?? "not_defined",
      t,
    });
  }
  return out;
}

type Point = { validTime: string; primary: number };

/** Flood stages, the last day's change and any coming crest, from NWS gauge and stageflow responses. */
export function parseDetail(
  gauge: { flood?: { categories?: Record<string, { stage?: number }> } },
  stageflow: { observed?: { data?: Point[] }; forecast?: { data?: Point[] } },
  nowS = Date.now() / 1000,
): GaugeDetail {
  const d: GaugeDetail = {};
  const cats = gauge.flood?.categories ?? {};
  const stage = (k: string) => { const v = cats[k]?.stage; return typeof v === "number" && v > -999 ? v : undefined; };
  d.floodStage = stage("minor");
  d.actionStage = stage("action");

  const obs = (stageflow.observed?.data ?? []).filter((p) => p.primary > -999);
  const last = obs.at(-1);
  if (last) {
    const lastT = Date.parse(last.validTime) / 1000;
    // The reading closest to 24 hours before the latest one.
    let prior: Point | undefined, best = Infinity;
    for (const p of obs) {
      const gap = Math.abs(lastT - Date.parse(p.validTime) / 1000 - 86_400);
      if (gap < best) { best = gap; prior = p; }
    }
    if (prior && best < 3 * 3600) d.change24h = Math.round((last.primary - prior.primary) * 100) / 100;

    const soon = (stageflow.forecast?.data ?? []).filter((p) => {
      const t = Date.parse(p.validTime) / 1000;
      return p.primary > -999 && t > nowS && t < nowS + 5 * 86_400;
    });
    const peak = soon.reduce<Point | undefined>((m, p) => (!m || p.primary > m.primary ? p : m), undefined);
    if (peak && peak.primary - last.primary >= 0.5) d.crest = { stage: peak.primary, t: Date.parse(peak.validTime) / 1000 };
  }
  return d;
}

/** Gauges reading hundreds of feet are elevations above sea level, not gauge heights. */
const isElevation = (stage: number) => stage > 400;

function feet(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${Math.abs(r) === 1 ? "foot" : "feet"}`;
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Chicago" });

/** "St. Paul Ford Plant" reads better as "Saint Paul Ford Plant". */
const plainName = (name: string) => name.replace(/\bSt\.\s/g, "Saint ").replace(/\babv\b/gi, "above").replace(/\bblw\b/gi, "below");

export function describeGauge(g: Gauge, detail?: GaugeDetail, nowS = Date.now() / 1000): Description {
  const sentences: string[] = [];
  const level = isElevation(g.stage) ? `${feet(g.stage)} above sea level` : `${feet(g.stage)} on the gauge`;
  const ch = detail?.change24h;
  let trend = "";
  if (ch !== undefined) {
    if (Math.abs(ch) < 0.1) trend = ", steady over the last day";
    else trend = `, ${ch > 0 ? "up" : "down"} ${feet(Math.abs(ch))} in the last day`;
  }
  sentences.push(`${level[0].toUpperCase()}${level.slice(1)}${trend}.`);
  if (g.flowKcfs) sentences.push(`Flowing at ${Math.round(g.flowKcfs * 1000).toLocaleString("en-US")} cubic feet a second.`);

  const flood = detail?.floodStage;
  if (g.category === "minor" || g.category === "moderate" || g.category === "major") {
    sentences.push(`In ${g.category} flood${flood !== undefined ? `; flood stage is ${feet(flood)}` : ""}.`);
  } else if (g.category === "action") {
    sentences.push(`Near flood stage${flood !== undefined ? ` (${feet(flood)})` : ""}.`);
  } else if (flood !== undefined) {
    const below = flood - g.stage;
    sentences.push(`Flood stage is ${feet(flood)}${below > 0 ? `, about ${feet(below).replace(/\.0 /, " ")} above today's level` : ""}.`);
  }
  if (detail?.crest) sentences.push(`Forecast to rise to ${feet(detail.crest.stage)} by ${DAY.format(new Date(detail.crest.t * 1000))}.`);

  return { title: `${plainName(g.name)}.`, detail: sentences.join(" "), meta: `NWS gauge ${g.lid} · updated ${ago(nowS - g.t)}` };
}
