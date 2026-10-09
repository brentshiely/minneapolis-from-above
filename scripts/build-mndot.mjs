#!/usr/bin/env node
// Bakes MnDOT's freeway sensor layout into public/data/freeways.json:
// every metro freeway corridor (interstates, US and state trunk highways)
// as a polyline per direction, nudged to its own side of the road, with
// each stretch tied to its nearest sensor station.
//
//   node scripts/build-mndot.mjs            download the layout, then build
//   node scripts/build-mndot.mjs --cached   reuse .cache/mndot/config.xml.gz
//
// MnDOT's layout changes rarely; re-run when stations are added.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const CONFIG_URL = "https://data.dot.state.mn.us/iris_xml/metro_config.xml.gz";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "mndot", "config.xml.gz");
const OUT = join(ROOT, "public", "data", "freeways.json");

/** The metro plus St. Cloud, Rochester and Duluth, a little wider so corridors run off the edge. */
const BOX = { minLon: -94.4, maxLon: -91.8, minLat: 43.8, maxLat: 47.0 };
/** A stretch further than this from any station has no reading to show. */
const MAX_STATION_M = 1600;
/** Each direction drawn this far to its right, so opposite directions separate. */
const SIDE_OFFSET_M = 9;

async function loadConfig() {
  if (process.argv.includes("--cached") && existsSync(CACHE)) return gunzipSync(readFileSync(CACHE)).toString("utf8");
  const res = await fetch(CONFIG_URL, { headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" } });
  if (!res.ok) throw new Error(`MnDOT layout download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, buf);
  return gunzipSync(buf).toString("utf8");
}

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/(\w+)='([^']*)'/g)].map((m) => [m[1], m[2]]));
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Freeways and highways only: I-94, U.S.169, T.H.62 (not county roads or streets). */
const isHighway = (route) => /^(I-\d|U\.S\.\d|T\.H\.\d)/.test(route);

const M_PER_DEG = 111_320;
const dist = (a, b) => {
  const kx = Math.cos(((a[1] + b[1]) * Math.PI) / 360);
  return Math.hypot((b[0] - a[0]) * kx, b[1] - a[1]) * M_PER_DEG;
};

/** Shift a polyline `m` meters to the right of its direction of travel. */
function offsetRight(path, m) {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const kx = Math.cos((p[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * kx, dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    // Right of travel: rotate the direction a quarter turn clockwise.
    const rx = dy / len, ry = -dx / len;
    return [p[0] + (rx * m) / (M_PER_DEG * kx), p[1] + (ry * m) / M_PER_DEG];
  });
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

const xml = await loadConfig();
const stations = {};
const corridors = [];

for (const m of xml.matchAll(/<corridor ([^>]*)>([\s\S]*?)<\/corridor>/g)) {
  const { route: rawRoute, dir } = attrs(m[1]);
  const route = unescape(rawRoute);
  if (!isHighway(route)) continue;
  // Mainline points only: ramps (Exit, Entrance, Access) sit off the freeway.
  const nodes = [...m[2].matchAll(/<r_node ([^>]*?)\/?>/g)].map((n) => attrs(n[1]))
    .filter((n) => !["Exit", "Entrance", "Access", "Intersection"].includes(n.n_type ?? "Station") && n.active !== "f" && n.abandoned !== "t")
    .map((n) => ({ ...n, p: [Number(n.lon), Number(n.lat)] }))
    .filter((n) => Number.isFinite(n.p[0]) && Number.isFinite(n.p[1]));

  // Split into runs inside the box (a corridor can leave and re-enter).
  let run = [];
  const flush = () => {
    if (run.length >= 2) buildRun(route, dir, run);
    run = [];
  };
  for (const n of nodes) {
    const inside = n.p[0] > BOX.minLon && n.p[0] < BOX.maxLon && n.p[1] > BOX.minLat && n.p[1] < BOX.maxLat;
    if (inside) run.push(n); else flush();
  }
  flush();
}

function buildRun(route, dir, run) {
  // Cumulative distance along the run, and where its stations sit.
  const cum = [0];
  for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + dist(run[i - 1].p, run[i].p));
  const at = run.map((n, i) => ({ n, d: cum[i] })).filter(({ n }) => n.station_id);
  if (!at.length) return;
  for (const { n } of at) {
    stations[n.station_id] = { label: unescape(n.label ?? ""), limit: Number(n.s_limit ?? 55) || 55, lanes: Number(n.lanes ?? 0) || 0, route, dir };
  }
  // Each segment takes the station nearest its midpoint, if close enough.
  const seg = [];
  for (let i = 0; i < run.length - 1; i++) {
    const mid = (cum[i] + cum[i + 1]) / 2;
    let best = null, bestD = Infinity;
    for (const s of at) { const d = Math.abs(s.d - mid); if (d < bestD) { bestD = d; best = s.n.station_id; } }
    seg.push(bestD <= MAX_STATION_M ? best : "");
  }
  const path = offsetRight(run.map((n) => n.p), SIDE_OFFSET_M);
  corridors.push({ route, dir, line: encodePolyline(path), seg });
}

const out = { generated: new Date().toISOString(), stations, corridors };
const json = JSON.stringify(out);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);
const segs = corridors.reduce((n, c) => n + c.seg.length, 0);
console.log(`corridors ${corridors.length}, stations ${Object.keys(stations).length}, segments ${segs} (${corridors.reduce((n, c) => n + c.seg.filter((s) => s).length, 0)} with a station)`);
console.log(`wrote ${OUT}: ${(json.length / 1024).toFixed(0)} KB (${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped)`);
