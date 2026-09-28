#!/usr/bin/env node
// Bakes the Duluth Transit Authority's static GTFS feed into
// public/data/dta-transit.json, in the exact same shape build-gtfs.mjs
// produces for Metro Transit -- src/transit/data.ts merges the two at
// load time into one Transit object, so every route, shape and vehicle
// downstream (Fleet, hover, route highlight) needs no DTA-specific code
// at all. Every route id, shape id and trip id is prefixed "dta-" so
// nothing can collide with Metro Transit's own ids once merged.
//
// DTA's trips.txt, unlike Metro Transit's, has no trip_headsign or
// `direction` column (only a numeric direction_id, which is agency-defined
// and doesn't reliably mean north/south/east/west). Each shape's headsign
// is inferred instead from its trips' most common final stop -- the
// standard fallback GTFS consumers use when trip_headsign is absent --
// and its compass direction is computed from the shape's own start and
// end points.
//
//   node scripts/build-dta-gtfs.mjs            download the feed, then build
//   node scripts/build-dta-gtfs.mjs --cached   reuse .cache/dta-gtfs.zip if present
//
// Re-run when DTA publishes a new feed, or when live vehicles stop
// resolving to shapes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8, gzipSync } from "fflate";

const GTFS_URL = "https://duluthtransit.com/gtf/google_transit.zip";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "dta-gtfs.zip");
const OUT = join(ROOT, "public", "data", "dta-transit.json");
const ID_PREFIX = "dta-";
/** Douglas-Peucker tolerance in meters: well under a lane width. */
const SIMPLIFY_M = 1.5;

async function loadZip() {
  if (process.argv.includes("--cached") && existsSync(CACHE)) {
    console.log("Using cached", CACHE);
    return readFileSync(CACHE);
  }
  console.log("Downloading", GTFS_URL);
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`DTA GTFS download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, buf);
  return buf;
}

/** Minimal CSV reader: GTFS fields may be quoted and contain commas. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map(h => h.replace(/^﻿/, "").trim());
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// --- geometry ----------------------------------------------------------------

const M_PER_DEG_LAT = 111_320;

/** Iterative Douglas-Peucker on [lon, lat] points using a local flat projection. */
function simplify(points, tolM) {
  if (points.length < 3) return points;
  const kx = M_PER_DEG_LAT * Math.cos((points[0][1] * Math.PI) / 180);
  const xy = points.map(([lon, lat]) => [lon * kx, lat * M_PER_DEG_LAT]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = tolM * tolM;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1, idx = -1;
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Google encoded polyline, 5-digit precision, [lon, lat] input. */
function encodePolyline(points) {
  let out = "", pLat = 0, pLon = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of points) {
    const la = Math.round(lat * 1e5), lo = Math.round(lon * 1e5);
    out += enc(la - pLat) + enc(lo - pLon);
    pLat = la; pLon = lo;
  }
  return out;
}

/** Compass octant from a shape's start to its end point: the nearest of the four the app knows (NB/SB/EB/WB). */
function shapeDirection(line) {
  const [lon0, lat0] = line[0], [lon1, lat1] = line[line.length - 1];
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const dx = (lon1 - lon0) * kx, dy = lat1 - lat0;
  return Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? "EB" : "WB") : (dy >= 0 ? "NB" : "SB");
}

// --- build ---------------------------------------------------------------------

const files = unzipSync(new Uint8Array(await loadZip()), {
  filter: (f) => ["routes.txt", "trips.txt", "shapes.txt", "stop_times.txt", "stops.txt", "feed_info.txt"].includes(f.name),
});
const read = (name) => parseCsv(strFromU8(files[name]));

const feedInfo = files["feed_info.txt"] ? read("feed_info.txt")[0] : {};
const routeRows = read("routes.txt");
const tripRows = read("trips.txt");
const shapeRows = read("shapes.txt");
const stopTimeRows = read("stop_times.txt");
const stopRows = read("stops.txt");

const routes = {};
for (const r of routeRows) {
  routes[ID_PREFIX + r.route_id] = {
    name: r.route_short_name || r.route_long_name,
    long: r.route_long_name || r.route_desc || "",
    mode: "bus", // DTA runs buses only, no light or commuter rail.
    color: "#" + (r.route_color || "007684").toUpperCase(),
    sort: Number(r.route_sort_order) || 9999,
  };
}

// Each trip's final stop, the standard fallback destination when
// trip_headsign (which DTA's feed doesn't have) is absent.
const stopName = new Map(stopRows.map((s) => [s.stop_id, s.stop_name]));
const lastStopSeq = new Map(), lastStopId = new Map();
for (const st of stopTimeRows) {
  const seq = Number(st.stop_sequence);
  if (!(seq > (lastStopSeq.get(st.trip_id) ?? -1))) continue;
  lastStopSeq.set(st.trip_id, seq);
  lastStopId.set(st.trip_id, st.stop_id);
}
const headsignOf = (tripId) => stopName.get(lastStopId.get(tripId)) ?? "";

// Group shape points, then order by sequence.
const rawShapes = new Map();
for (const s of shapeRows) {
  let pts = rawShapes.get(s.shape_id);
  if (!pts) rawShapes.set(s.shape_id, (pts = []));
  pts.push([Number(s.shape_pt_sequence), Number(s.shape_pt_lon), Number(s.shape_pt_lat)]);
}

// Each shape's route and most common final-stop headsign come from the trips that use it.
const shapeRoute = new Map();
const shapeSigns = new Map();
for (const t of tripRows) {
  if (!t.shape_id) continue;
  if (!shapeRoute.has(t.shape_id)) shapeRoute.set(t.shape_id, t.route_id);
  let counts = shapeSigns.get(t.shape_id);
  if (!counts) shapeSigns.set(t.shape_id, (counts = new Map()));
  const head = headsignOf(t.trip_id);
  counts.set(head, (counts.get(head) ?? 0) + 1);
}
const commonHeadsign = (shapeId) => {
  const counts = shapeSigns.get(shapeId);
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best[0];
};

const shapes = [];
const shapeIndex = new Map();
let rawPts = 0, keptPts = 0;
for (const [id, pts] of rawShapes) {
  if (!shapeRoute.has(id)) continue; // unused by any trip
  pts.sort((a, b) => a[0] - b[0]);
  const line = pts.map(([, lon, lat]) => [lon, lat]);
  const simple = simplify(line, SIMPLIFY_M);
  rawPts += line.length; keptPts += simple.length;
  shapeIndex.set(id, shapes.length);
  shapes.push({
    id: ID_PREFIX + id,
    route: ID_PREFIX + shapeRoute.get(id),
    head: commonHeadsign(id),
    dir: shapeDirection(line),
    line: encodePolyline(simple),
  });
}

const trips = {};
let unresolved = 0;
for (const t of tripRows) {
  const idx = shapeIndex.get(t.shape_id);
  if (idx === undefined) { unresolved++; continue; }
  trips[ID_PREFIX + t.trip_id] = idx;
}

const out = {
  generated: new Date().toISOString(),
  feed: { version: feedInfo.feed_version || "", start: feedInfo.feed_start_date || "", end: feedInfo.feed_end_date || "" },
  routes,
  shapes,
  trips,
};
const json = JSON.stringify(out);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log(`routes ${Object.keys(routes).length}, shapes ${shapes.length}, trips ${Object.keys(trips).length} (${unresolved} without shape)`);
console.log(`shape points ${rawPts} -> ${keptPts} after ${SIMPLIFY_M} m simplification`);
console.log(`wrote ${OUT}: ${kb(json.length)} (${kb(gzipSync(Buffer.from(json)).length)} gzipped)`);
