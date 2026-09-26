/**
 * MnDOT freeway sensor readings, and how to talk about them.
 */
import { ago, type Description } from "../describe.ts";

/** Per station: [speed mph or null, flow vehicles/hour or null]. */
export type Readings = Record<string, [number | null, number | null]>;

export interface TrafficResponse {
  /** When MnDOT took the sample, POSIX seconds. */
  t: number;
  s: Readings;
}

export interface StationInfo {
  label: string;
  limit: number;
  route: string;
  dir: string;
}

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** "Sat Sep 26 18:42:00 CDT 2026" -> POSIX seconds. */
export function parseStamp(stamp: string): number {
  const m = /\w+ (\w+) (\d+) (\d+):(\d+):(\d+) (CDT|CST) (\d+)/.exec(stamp);
  if (!m) return Date.now() / 1000;
  const [, mon, day, h, mi, s, zone, year] = m;
  const iso = `${year}-${MONTHS[mon]}-${day.padStart(2, "0")}T${h}:${mi}:${s}${zone === "CDT" ? "-05:00" : "-06:00"}`;
  return Date.parse(iso) / 1000;
}

const num = (v: string | undefined) => {
  if (v === undefined || v === "UNKNOWN") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Parse MnDOT's stat_sample.xml. */
export function parseSample(xml: string): TrafficResponse {
  const stamp = /time_stamp='([^']*)'/.exec(xml)?.[1] ?? "";
  const s: Readings = {};
  for (const m of xml.matchAll(/<sample ([^>]*)\/>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/(\w+)='([^']*)'/g)].map((x) => [x[1], x[2]]));
    if (!a.sensor) continue;
    const speed = num(a.speed), flow = num(a.flow);
    if (speed === null && flow === null) continue;
    s[a.sensor] = [speed, flow];
  }
  return { t: parseStamp(stamp), s };
}

export type Level = "free" | "slowing" | "heavy" | "stopped";

/** How traffic compares with the speed limit. */
export function level(speed: number, limit: number): Level {
  const r = speed / limit;
  if (r >= 0.8) return "free";
  if (r >= 0.6) return "slowing";
  if (r >= 0.35) return "heavy";
  return "stopped";
}

const LEVEL_WORDS: Record<Level, string> = {
  free: "moving freely",
  slowing: "slowing",
  heavy: "heavy traffic",
  stopped: "stop and go",
};

const DIRS: Record<string, string> = { NB: "northbound", SB: "southbound", EB: "eastbound", WB: "westbound" };

/** "I-94", "US 169", "Highway 62"; plus express lanes and collector roads. */
export function routeName(route: string): string {
  const rev = / Rev$/.test(route), cd = / CD$/.test(route);
  const base = route.replace(/ (Rev|CD)$/, "")
    .replace(/^U\.S\.(\d+\w*)/, "US $1")
    .replace(/^T\.H\.(\d+\w*)/, "Highway $1");
  return rev ? `${base} express lanes` : cd ? `${base} collector road` : base;
}

/** "Co Rd 70" -> "County Road 70", "W of U.S.75" -> "west of US 75". */
function place(label: string): string {
  return label
    .replace(/^N of /, "north of ").replace(/^S of /, "south of ").replace(/^E of /, "east of ").replace(/^W of /, "west of ")
    .replace(/\bCo Rd\b/g, "County Road").replace(/\bC\.S\.A\.H\.\s?(\d+)/g, "County Road $1")
    .replace(/\bU\.S\.(\d+)/g, "US $1").replace(/\bT\.H\.(\d+)/g, "Highway $1")
    .replace(/\s*\([^)]*\)\s*/g, " ").trim();
}

export function describeStation(info: StationInfo, reading: [number | null, number | null] | undefined, ageS: number): Description {
  const where = place(info.label);
  const at = where ? (/^(north|south|east|west) of /.test(where) ? ` ${where}` : ` at ${where}`) : "";
  const title = `${routeName(info.route)} ${DIRS[info.dir] ?? info.dir}${at}.`;
  const [speed, flow] = reading ?? [null, null];
  let detail: string;
  if (speed === null) detail = "No speed reading right now.";
  else {
    detail = `${Math.round(speed)} mph, ${LEVEL_WORDS[level(speed, info.limit)]}. The limit is ${info.limit}.`;
    if (flow !== null && flow > 0) detail += ` About ${(Math.round(flow / 60) * 60).toLocaleString("en-US")} vehicles an hour.`;
  }
  return { title, detail, meta: `MnDOT sensor · updated ${ago(ageS)}` };
}
