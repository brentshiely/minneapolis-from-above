#!/usr/bin/env node
// Bakes MnDOT's freeway sensor layout into public/data/freeways.json:
// every metro freeway corridor (interstates, US and state trunk highways)
// as a polyline per direction, each stretch tied to its nearest sensor
// station. The sensors are only a third to half a mile apart, so the line
// between them is followed along OpenStreetMap's own carriageway for that
// direction (the same data the basemap draws) rather than straight across;
// where that can't be done it falls back to a straight line nudged to the
// right (see scripts/lib/roadsnap.mjs).
//
//   node scripts/build-mndot.mjs            download the layout and the roads, then build
//   node scripts/build-mndot.mjs --cached   reuse .cache/mndot/ (config.xml.gz and osm/)
//
// MnDOT's layout changes rarely; re-run when stations are added.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { buildGraph, dist, offsetRight, refTokens, simplify, snappable, snapRun } from "./lib/roadsnap.mjs";

const CONFIG_URL = "https://data.dot.state.mn.us/iris_xml/metro_config.xml.gz";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "mndot", "config.xml.gz");
const OUT = join(ROOT, "public", "data", "freeways.json");

/** The metro plus St. Cloud, Rochester and Duluth, a little wider so corridors run off the edge. */
const BOX = { minLon: -94.4, maxLon: -91.8, minLat: 43.8, maxLat: 47.0 };
/** A stretch further than this from any station has no reading to show. */
const MAX_STATION_M = 1600;
/** Where a stretch can't be placed on the road: a straight line, drawn this far to the right of travel so opposite directions separate. */
const FALLBACK_OFFSET_M = 6;
/** Where one line serves both directions (an undivided highway), each is drawn this far to its right. */
const TWO_WAY_OFFSET_M = 4;
/** Douglas-Peucker tolerance in meters: well under a lane width. */
const SIMPLIFY_M = 1.5;
/** OSM data is fetched in tiles this many degrees on a side. */
const TILE_DEG = 0.25;
const OSM_CACHE = join(ROOT, ".cache", "mndot", "osm");
const OVERPASS = ["https://overpass.openstreetmap.fr/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

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
/** Every continuous run of mainline sensors, to be placed on the road once its OSM data is in. */
const runs = [];

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
    if (run.length >= 2) runs.push({ route, dir, run });
    run = [];
  };
  for (const n of nodes) {
    const inside = n.p[0] > BOX.minLon && n.p[0] < BOX.maxLon && n.p[1] > BOX.minLat && n.p[1] < BOX.maxLat;
    if (inside) run.push(n); else flush();
  }
  flush();
}

// --- OpenStreetMap highway lines -------------------------------------------------

const tileKey = (lon, lat) => `${Math.floor(lon / TILE_DEG)}_${Math.floor(lat / TILE_DEG)}`;

/** The tiles any run's sensors fall in, with a margin so a sensor near an edge sees the road across it. */
function neededTiles() {
  const tiles = new Map();
  const margin = 0.01;
  for (const { run } of runs) {
    for (const n of run) {
      for (const dx of [-margin, 0, margin]) {
        for (const dy of [-margin, 0, margin]) {
          const x = Math.floor((n.p[0] + dx) / TILE_DEG), y = Math.floor((n.p[1] + dy) / TILE_DEG);
          tiles.set(`${x}_${y}`, [x * TILE_DEG, y * TILE_DEG, (x + 1) * TILE_DEG, (y + 1) * TILE_DEG]);
        }
      }
    }
  }
  return tiles;
}

/** The road numbers of every route, as one regular expression for Overpass. */
function refPattern() {
  const nums = new Set();
  for (const { route } of runs) for (const t of refTokens(route)) nums.add(t.split(" ")[1]);
  return `(^|;)(I|US|MN) (${[...nums].sort().join("|")})(;|$)`;
}

async function fetchTile(key, [w, s, e, n], pattern) {
  const file = join(OSM_CACHE, `${key}.json`);
  if (process.argv.includes("--cached") && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).elements;
  const query = `[out:json][timeout:180];way["highway"~"^(motorway|trunk|primary|secondary)$"]["ref"~"${pattern}"](${s},${w},${n},${e});out geom;`;
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "minneapolis-from-above build script (+https://minneapolis-from-above.pages.dev)" },
        body: new URLSearchParams({ data: query }),
      });
      const text = await res.text();
      if (!res.ok || !text.startsWith("{")) throw new Error(`${url}: ${res.status} ${text.slice(0, 80).replace(/\s+/g, " ")}`);
      const body = JSON.parse(text);
      mkdirSync(OSM_CACHE, { recursive: true });
      writeFileSync(file, JSON.stringify(body));
      return body.elements;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw new Error(`OSM tile ${key} failed: ${lastErr}`);
}

async function loadRoads() {
  const tiles = neededTiles();
  const pattern = refPattern();
  console.log(`Fetching OpenStreetMap highways for ${tiles.size} tiles`);
  const ways = new Map();
  let i = 0;
  for (const [key, box] of tiles) {
    for (const el of await fetchTile(key, box, pattern)) if (el.type === "way") ways.set(el.id, el);
    process.stdout.write(`\r  tile ${++i}/${tiles.size}, ${ways.size} ways`);
  }
  process.stdout.write("\n");
  return [...ways.values()];
}

const roadWays = await loadRoads();
/** One graph per route (its refs only), built on first use. */
const graphs = new Map();
const graphFor = (route) => {
  const tokens = refTokens(route);
  const key = tokens.join("|");
  if (!graphs.has(key)) graphs.set(key, buildGraph(roadWays, tokens));
  return graphs.get(key);
};
/**
 * Every freeway-numbered road at once, for where a route's own roads don't
 * fit: MnDOT calls the stretch of I-394 west of Wayzata "I-394" while OSM
 * numbers it US 12, and a bridge can carry another state's number.
 */
let broadGraph;
const anyGraph = () => (broadGraph ??= buildGraph(roadWays, [...new Set(runs.flatMap(({ route }) => refTokens(route)))]));

// --- Corridors ---------------------------------------------------------------------

const tally = { snapped: 0, fallback: 0, meters: { snapped: 0, fallback: 0 } };
const byRoute = {};

function buildRun(route, dir, run) {
  // Cumulative distance along the run, and where its stations sit.
  const cum = [0];
  for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + dist(run[i - 1].p, run[i].p));
  const at = run.map((n, i) => ({ n, d: cum[i] })).filter(({ n }) => n.station_id);
  if (!at.length) return;
  for (const { n } of at) {
    stations[n.station_id] = { label: unescape(n.label ?? ""), limit: Number(n.s_limit ?? 55) || 55, lanes: Number(n.lanes ?? 0) || 0, route, dir };
  }
  // Each interval between sensors takes the station nearest its midpoint, if close enough.
  const seg = [];
  for (let i = 0; i < run.length - 1; i++) {
    const mid = (cum[i] + cum[i + 1]) / 2;
    let best = null, bestD = Infinity;
    for (const s of at) { const d = Math.abs(s.d - mid); if (d < bestD) { bestD = d; best = s.n.station_id; } }
    seg.push(bestD <= MAX_STATION_M ? best : "");
  }

  // Place each interval on the road: along OSM's carriageway where it can be followed.
  const straight = (i) => ({ path: [run[i].p, run[i + 1].p], snapped: false, twoWay: false });
  const own = snappable(route) ? snapRun(graphFor(route), run) : undefined;
  const broad = own?.some((iv) => !iv.snapped) ? snapRun(anyGraph(), run) : undefined;
  const placed = run.slice(1).map((n, i) => (own?.[i].snapped ? own[i] : broad?.[i].snapped ? { ...broad[i], viaBroad: true } : straight(i)));
  const parts = [];
  let cur;
  placed.forEach((iv, i) => {
    const path = iv.snapped ? (iv.twoWay ? offsetRight(iv.path, TWO_WAY_OFFSET_M) : iv.path) : offsetRight(iv.path, FALLBACK_OFFSET_M);
    const len = path.reduce((m, p, k) => (k ? m + dist(path[k - 1], p) : 0), 0);
    const r = (byRoute[route] ??= { snapped: 0, fallback: 0 });
    if (iv.viaBroad) tally.broad = (tally.broad ?? 0) + 1;
    if (iv.snapped) { tally.snapped++; tally.meters.snapped += len; r.snapped++; } else { tally.fallback++; tally.meters.fallback += len; r.fallback++; }
    if (!seg[i]) { cur = undefined; return; }
    if (cur && cur.station === seg[i]) {
      const last = cur.path[cur.path.length - 1];
      cur.path.push(...(dist(last, path[0]) < 0.5 ? path.slice(1) : path));
    } else {
      cur = { station: seg[i], path: [...path] };
      parts.push(cur);
    }
  });
  corridors.push({ route, dir, parts: parts.map((p) => [p.station, encodePolyline(simplify(p.path, SIMPLIFY_M))]) });
}

for (const { route, dir, run } of runs) buildRun(route, dir, run);

const out = { generated: new Date().toISOString(), stations, corridors };
const json = JSON.stringify(out);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);
const stretches = corridors.reduce((n, c) => n + c.parts.length, 0);
const pct = (a, b) => `${((100 * a) / (a + b || 1)).toFixed(0)}%`;
console.log(`corridors ${corridors.length}, stations ${Object.keys(stations).length}, stretches ${stretches}`);
console.log(`${tally.broad ?? 0} of those only fit another route's road number`);
console.log(`placed on the road: ${tally.snapped} of ${tally.snapped + tally.fallback} sensor-to-sensor intervals (${pct(tally.snapped, tally.fallback)}), ${(tally.meters.snapped / 1000).toFixed(0)} km of ${((tally.meters.snapped + tally.meters.fallback) / 1000).toFixed(0)} km (${pct(tally.meters.snapped, tally.meters.fallback)})`);
const worst = Object.entries(byRoute).filter(([, v]) => v.fallback).sort((a, b) => b[1].fallback - a[1].fallback).slice(0, 12);
if (worst.length) console.log("straight-line fallbacks by route:", worst.map(([r, v]) => `${r} ${v.fallback}/${v.snapped + v.fallback}`).join(", "));
console.log(`wrote ${OUT}: ${(json.length / 1024).toFixed(0)} KB (${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped)`);
