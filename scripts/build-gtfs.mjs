#!/usr/bin/env node
// Bakes Metro Transit's static GTFS feed into public/data/transit.json:
// every route (name, mode, color), every route shape as a simplified
// encoded polyline, and a trip_id -> shape index so a live vehicle's trip
// resolves to the path it is driving.
//
//   node scripts/build-gtfs.mjs            download the feed, then build
//   node scripts/build-gtfs.mjs --cached   reuse .cache/gtfs.zip if present
//
// Re-run when Metro Transit publishes a new feed (roughly quarterly), or
// when live vehicles stop resolving to shapes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8, gzipSync } from "fflate";

const GTFS_URL = "https://svc.metrotransit.org/mtgtfs/gtfs.zip";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "gtfs.zip");
const OUT = join(ROOT, "public", "data", "transit.json");
/** Douglas-Peucker tolerance in meters: well under a lane width. */
const SIMPLIFY_M = 1.5;

async function loadZip() {
  if (process.argv.includes("--cached") && existsSync(CACHE)) {
    console.log("Using cached", CACHE);
    return readFileSync(CACHE);
  }
  console.log("Downloading", GTFS_URL);
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`GTFS download failed: ${res.status} ${res.statusText}`);
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

/**
 * Mode drives how strongly a route draws and how its vehicles look.
 * rail: light rail and commuter rail. brt: the METRO bus rapid transit
 * lines (A-E, Gold, Orange, Red). bus: everything else.
 */
function modeOf(route) {
  const type = Number(route.route_type);
  if (type === 0 || type === 1 || type === 2) return "rail";
  if (/^METRO /.test(route.route_long_name)) return "brt";
  return "bus";
}

// --- geometry --------------------------------------------------------------

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

// --- build -----------------------------------------------------------------

const files = unzipSync(new Uint8Array(await loadZip()), {
  filter: (f) => ["routes.txt", "trips.txt", "shapes.txt", "feed_info.txt"].includes(f.name),
});
const read = (name) => parseCsv(strFromU8(files[name]));

const feedInfo = files["feed_info.txt"] ? read("feed_info.txt")[0] : {};
const routeRows = read("routes.txt");
const tripRows = read("trips.txt");
const shapeRows = read("shapes.txt");

const routes = {};
for (const r of routeRows) {
  routes[r.route_id] = {
    name: r.route_short_name || r.route_long_name.replace(/^METRO /, ""),
    long: r.route_long_name || r.route_desc || "",
    mode: modeOf(r),
    color: "#" + (r.route_color || "771473").toUpperCase(),
    sort: Number(r.route_sort_order) || 9999,
  };
}

// Group shape points, then order by sequence.
const rawShapes = new Map();
for (const s of shapeRows) {
  let pts = rawShapes.get(s.shape_id);
  if (!pts) rawShapes.set(s.shape_id, (pts = []));
  pts.push([Number(s.shape_pt_sequence), Number(s.shape_pt_lon), Number(s.shape_pt_lat)]);
}

// Each shape's route, and its most common destination sign and direction,
// come from the trips that use it.
const shapeRoute = new Map();
const shapeSigns = new Map();
for (const t of tripRows) {
  if (!t.shape_id) continue;
  if (!shapeRoute.has(t.shape_id)) shapeRoute.set(t.shape_id, t.route_id);
  let counts = shapeSigns.get(t.shape_id);
  if (!counts) shapeSigns.set(t.shape_id, (counts = new Map()));
  const key = `${t.trip_headsign}\t${t.direction}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const signOf = (shapeId) => {
  const [best] = [...shapeSigns.get(shapeId).entries()].sort((a, b) => b[1] - a[1]);
  const [head, dir] = best[0].split("\t");
  return { head, dir };
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
  shapes.push({ id, route: shapeRoute.get(id), ...signOf(id), line: encodePolyline(simple) });
}

const trips = {};
let unresolved = 0;
for (const t of tripRows) {
  const idx = shapeIndex.get(t.shape_id);
  if (idx === undefined) { unresolved++; continue; }
  trips[t.trip_id] = idx;
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
