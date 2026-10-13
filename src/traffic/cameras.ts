/**
 * MnDOT's IRIS traffic cameras: locations, plain-language descriptions,
 * and the live snapshot each one serves.
 */
import type { Description } from "../describe.ts";
import { routeName } from "./traffic.ts";

export interface CameraInfo {
  /** IRIS camera name, e.g. "C909" or "D6-C340" — also the snapshot id. */
  name: string;
  /** MnDOT's own description, e.g. "I-394 EB @ Hampshire Ave". */
  description: string;
  lon: number;
  lat: number;
}

/** Baked by scripts/build-cameras.mjs into public/data/cameras.json. */
export interface CamerasFile {
  generated: string;
  cameras: CameraInfo[];
}

const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/(\w+)='([^']*)'/g)].map((m) => [m[1], m[2]]));
const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** A camera's description names a freeway or highway ("I-394 EB @ Hampshire
 * Ave", not a local street like "Robert St NB @ Marie Ave" or a bench test
 * rig like "(RTMC Test Camera 7)"). */
const ON_A_HIGHWAY = /\b(I-\d+\w*|U\.S\.\d+\w*|T\.H\.\d+\w*)\b/;

/** The metro plus St. Cloud, Rochester and Duluth, a little wider than the map so nothing clips at the edge. */
const BOX = { minLon: -94.4, maxLon: -91.8, minLat: 43.8, maxLat: 47.0 };

/**
 * Parse every `<camera name='...' description='...' lon='...' lat='...'/>`
 * in MnDOT's IRIS config XML (the same file scripts/build-mndot.mjs reads
 * for freeway corridors), keeping only located cameras on a numbered
 * freeway or highway within the metro.
 */
export function parseCameras(xml: string): CameraInfo[] {
  const cameras: CameraInfo[] = [];
  for (const m of xml.matchAll(/<camera ([^>]*)\/>/g)) {
    const a = attrs(m[1]);
    if (!a.name || !a.lon || !a.lat) continue;
    const lon = Number(a.lon), lat = Number(a.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon <= BOX.minLon || lon >= BOX.maxLon || lat <= BOX.minLat || lat >= BOX.maxLat) continue;
    const description = unescape(a.description ?? "");
    if (!ON_A_HIGHWAY.test(description)) continue;
    cameras.push({ name: a.name, description, lon, lat });
  }
  return cameras;
}

/** "I-394 EB @ Hampshire Ave" -> "I-394 eastbound at Hampshire Ave." */
function plainLocation(description: string): string {
  const m = /^(I-\d+\w*|U\.S\.\d+\w*|T\.H\.\d+\w*)\s*(NB|SB|EB|WB)?\s*@?\s*(.*)$/.exec(description);
  if (!m) return description;
  const [, route, dir, rest] = m;
  const DIRS: Record<string, string> = { NB: "northbound", SB: "southbound", EB: "eastbound", WB: "westbound" };
  const where = rest.replace(/^@\s*/, "").trim();
  const bearing = dir ? ` ${DIRS[dir]}` : "";
  return where ? `${routeName(route)}${bearing} at ${where}.` : `${routeName(route)}${bearing}.`;
}

/**
 * MnDOT's public snapshot, refreshed every few seconds by the CARS program,
 * fetched through our own server (functions/api/image.ts) so MnDOT never
 * sees the visitor.
 */
export function snapshotUrl(name: string): string {
  return `/api/image?cam=${encodeURIComponent(name)}`;
}

export function describeCamera(cam: CameraInfo, atMs = Date.now()): Description {
  return {
    title: plainLocation(cam.description),
    meta: "MnDOT traffic camera",
    // Busted every 10 s so a tooltip left open picks up a newer frame,
    // without refetching on every render frame.
    image: `${snapshotUrl(cam.name)}&t=${Math.floor(atMs / 10_000)}`,
  };
}
