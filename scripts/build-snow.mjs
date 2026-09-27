#!/usr/bin/env node
// Bakes both cities' snow emergency routes into public/data/snow-routes.json:
// the streets each city clears first and signs for snow emergency parking,
// joined into long lines, simplified, and polyline-encoded.
//
//   Minneapolis: Public Works street centerlines flagged as snow emergency
//     routes (SNOW_EMERGENCY_ROUTE = 'Y'), the same streets that carry the red
//     "Snow Emergency Route" signs.
//     https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/PW_Street_Centerline/FeatureServer/0
//   Saint Paul: the Night Plow Routes layer of the city's official Snow
//     Emergency Parking Map (the streets and sides of streets signed
//     "NIGHT PLOW ROUTE").
//     https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Winter_Street_Parking_Night_Plow_View/FeatureServer/0
//
//   node scripts/build-snow.mjs            download both layers, then build
//   node scripts/build-snow.mjs --cached   reuse .cache/snow/*.json
//
// Routes change rarely; re-run before each winter.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "snow");
const OUT = join(ROOT, "public", "data", "snow-routes.json");
const UA = { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" };

const SOURCES = {
  mpls: {
    url: "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/PW_Street_Centerline/FeatureServer/0",
    // Ramps are flagged along with the streets they serve; they aren't parked on.
    where: "SNOW_EMERGENCY_ROUTE = 'Y' AND SYMBOL_NAME NOT LIKE 'RAMP%'",
    fields: "STREET_O_NAME",
  },
  stp: {
    url: "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Winter_Street_Parking_Night_Plow_View/FeatureServer/0",
    where: "PlowRoute = 'Night Plow Route'",
    fields: "PlowRoute",
  },
};

/** Douglas–Peucker tolerance: a few meters is invisible at city zoom. */
const SIMPLIFY_M = 4;
/** Segment ends closer than this are the same intersection. */
const JOIN_M = 2;

/** Every feature of an ArcGIS layer as GeoJSON-ish paths, a page at a time. */
async function download(key) {
  const file = join(CACHE, `${key}.json`);
  if (process.argv.includes("--cached") && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const { url, where, fields } = SOURCES[key];
  const features = [];
  for (let offset = 0; ; offset += 1000) {
    const q = new URLSearchParams({
      where, outFields: fields, outSR: "4326", geometryPrecision: "6", f: "json",
      resultOffset: String(offset), resultRecordCount: "1000", orderByFields: "OBJECTID",
    });
    const res = await fetch(`${url}/query?${q}`, { headers: UA });
    if (!res.ok) throw new Error(`${key} download failed: ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`${key} download failed: ${JSON.stringify(body.error)}`);
    for (const f of body.features) features.push({ name: f.attributes.STREET_O_NAME ?? "", paths: f.geometry?.paths ?? [] });
    if (!body.exceededTransferLimit && body.features.length < 1000) break;
  }
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify(features));
  return features;
}

const M_PER_DEG = 111_320;
const KX = Math.cos((44.96 * Math.PI) / 180);
const toM = ([lon, lat]) => [lon * M_PER_DEG * KX, lat * M_PER_DEG];

/** Distance in meters from p to the segment a–b (all in meters). */
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function simplify(path) {
  if (path.length < 3) return path;
  const m = path.map(toM);
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack = [[0, path.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bestD = SIMPLIFY_M;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(m[k], m[i], m[j]);
      if (d > bestD) { bestD = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return path.filter((_, i) => keep[i]);
}

/**
 * Join segments that meet end to end into long lines, so a route is a
 * handful of polylines rather than one per block. Only segments with the
 * same street name join, so each line keeps its name.
 */
function chain(segments) {
  const key = (p) => `${Math.round(toM(p)[0] / JOIN_M)},${Math.round(toM(p)[1] / JOIN_M)}`;
  const byName = new Map();
  for (const s of segments) {
    if (s.path.length < 2) continue;
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s.path);
  }
  const lines = [];
  for (const [name, paths] of byName) {
    const ends = new Map();
    const add = (k, i) => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); };
    paths.forEach((p, i) => { add(key(p[0]), i); add(key(p[p.length - 1]), i); });
    const used = new Uint8Array(paths.length);
    const take = (k) => {
      const i = (ends.get(k) ?? []).find((x) => !used[x]);
      if (i === undefined) return undefined;
      used[i] = 1;
      const p = paths[i];
      return key(p[0]) === k ? p : [...p].reverse();
    };
    for (let i = 0; i < paths.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      let line = [...paths[i]];
      // Grow forward from the tail, then backward from the head.
      for (let next; (next = take(key(line[line.length - 1]))); ) line = line.concat(next.slice(1));
      for (let prev; (prev = take(key(line[0]))); ) line = [...prev].reverse().concat(line.slice(1));
      lines.push({ name, path: line });
    }
  }
  return lines;
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

/** "LYNDALE AVE S" → "Lyndale Ave S", "38TH ST E" → "38th St E". */
const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
export const streetName = (raw) => raw.trim().split(/\s+/).map((w) => {
  if (DIRECTIONS.has(w)) return w;
  if (/^\d/.test(w)) return w.toLowerCase();
  return w.charAt(0) + w.slice(1).toLowerCase();
}).join(" ");

const out = { generated: new Date().toISOString(), mpls: [], stp: [] };
for (const key of ["mpls", "stp"]) {
  const features = await download(key);
  const segments = features.flatMap((f) => f.paths.map((path) => ({ name: key === "mpls" ? streetName(f.name) : "", path })));
  const lines = chain(segments);
  // Names repeat along a route; store each once and point at it.
  const names = [...new Set(lines.map((l) => l.name))];
  out[key] = {
    names,
    lines: lines.map((l) => [names.indexOf(l.name), encodePolyline(simplify(l.path))]).filter(([, enc]) => enc.length > 4),
  };
  console.log(`${key}: ${features.length} segments → ${out[key].lines.length} lines, ${names.length} names`);
}

const json = JSON.stringify(out);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);
console.log(`wrote ${OUT}: ${(json.length / 1024).toFixed(0)} KB (${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped)`);
