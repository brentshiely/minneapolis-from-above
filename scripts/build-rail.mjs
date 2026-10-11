#!/usr/bin/env node
// Bakes MnDOT's Minnesota rail network into public/data/rail.json: every
// active railroad line in the map's box as a polyline, with the trains a day
// that run on it (as the operating railroad reported them to the Federal
// Railroad Administration) and the line's top speed. The map runs synthetic
// freight trains along these at that real frequency.
//
// MnDOT publishes the network as segments cut at every grade crossing; this
// joins them back into continuous lines wherever exactly two segments of the
// same railroad meet, so a train can run the whole way between junctions.
//
//   node scripts/build-rail.mjs            download the network, then build
//   node scripts/build-rail.mjs --cached   reuse .cache/rail/network.json
//
// The data changes rarely (the newest crossing records are a few years old).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dist, simplify } from "./lib/roadsnap.mjs";
import { encodePolyline } from "./lib/polyline.mjs";

const SERVICE = "https://services.arcgis.com/04HiymDgLlsbhaV4/ArcGIS/rest/services/MN_Rail_Network/FeatureServer/3/query";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "rail", "network.json");
const OUT = join(ROOT, "public", "data", "rail.json");

/** The metro plus St. Cloud, Rochester and Duluth, a little wider so lines run off the edge. */
const BOX = { minLon: -94.4, maxLon: -91.8, minLat: 43.8, maxLat: 47.0 };
const SIMPLIFY_M = 2;
/** Where a line has no posted speed, assume this (mph): a slow industrial or yard track. */
const DEFAULT_MPH = 25;
const PAGE = 1000;
/** A shorter fragment is a stub or a data glitch, not a line a train could run along. */
const MIN_LINE_M = 100;

async function loadNetwork() {
  if (process.argv.includes("--cached") && existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8"));
  const features = [];
  for (let offset = 0; ; offset += PAGE) {
    const qs = new URLSearchParams({
      where: "1=1", outFields: "RAILROAD,RRSUBDIV,MAXSPD,TOTALTRAIN", outSR: "4326", f: "json",
      resultOffset: String(offset), resultRecordCount: String(PAGE),
    });
    const res = await fetch(`${SERVICE}?${qs}`, { headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" } });
    if (!res.ok) throw new Error(`MnDOT rail download failed: ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`MnDOT rail download failed: ${JSON.stringify(body.error)}`);
    features.push(...body.features);
    if (!body.exceededTransferLimit && body.features.length < PAGE) break;
  }
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(features));
  return features;
}

const inBox = (p) => p[0] > BOX.minLon && p[0] < BOX.maxLon && p[1] > BOX.minLat && p[1] < BOX.maxLat;
/** An endpoint to about a meter, so segments cut at a crossing find each other. */
const key = (p) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;

const features = await loadNetwork();

// One segment per path; skip lines no train is reported on.
const segs = [];
for (const f of features) {
  const a = f.attributes;
  if (!a.TOTALTRAIN || a.TOTALTRAIN <= 0) continue;
  for (const path of f.geometry?.paths ?? []) {
    if (path.length < 2 || !path.some(inBox)) continue;
    let len = 0;
    for (let i = 1; i < path.length; i++) len += dist(path[i - 1], path[i]);
    segs.push({ path, rr: a.RAILROAD || "?", tpd: a.TOTALTRAIN, mph: a.MAXSPD > 0 ? a.MAXSPD : DEFAULT_MPH, len, used: false });
  }
}

const ends = new Map();
const addEnd = (k, s) => { const l = ends.get(k); if (l) l.push(s); else ends.set(k, [s]); };
for (const s of segs) { addEnd(key(s.path[0]), s); addEnd(key(s.path[s.path.length - 1]), s); }

/** The one other segment of the same railroad meeting `s` at point `p`, if the join is just two segments. */
function neighbor(p, s) {
  const here = ends.get(key(p));
  if (!here || here.length !== 2) return undefined;
  const o = here[0] === s ? here[1] : here[0];
  return o !== s && !o.used && o.rr === s.rr ? o : undefined;
}

const chains = [];
for (const seed of segs) {
  if (seed.used) continue;
  seed.used = true;
  const parts = [seed];
  let path = seed.path.slice();
  // Grow forward from the tail, then backward from the head.
  for (const side of ["tail", "head"]) {
    for (;;) {
      const p = side === "tail" ? path[path.length - 1] : path[0];
      const o = neighbor(p, side === "tail" ? parts[parts.length - 1] : parts[0]);
      if (!o) break;
      o.used = true;
      if (side === "tail") {
        const next = key(o.path[0]) === key(p) ? o.path : o.path.slice().reverse();
        path = path.concat(next.slice(1));
        parts.push(o);
      } else {
        const prev = key(o.path[o.path.length - 1]) === key(p) ? o.path : o.path.slice().reverse();
        path = prev.slice(0, -1).concat(path);
        parts.unshift(o);
      }
    }
  }
  chains.push({ path, parts });
}

const out = [];
for (const { path, parts } of chains) {
  const len = parts.reduce((n, s) => n + s.len, 0);
  if (len < MIN_LINE_M) continue;
  const mean = (f) => parts.reduce((n, s) => n + f(s) * s.len, 0) / len;
  // The railroad with the most track on the line names it.
  const byRr = new Map();
  for (const s of parts) byRr.set(s.rr, (byRr.get(s.rr) ?? 0) + s.len);
  const rr = [...byRr.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const line = simplify(path, SIMPLIFY_M);
  out.push({ rr, tpd: Math.round(mean((s) => s.tpd) * 10) / 10, mph: Math.round(mean((s) => s.mph)), len: Math.round(len), line: encodePolyline(line) });
}
out.sort((a, b) => b.len - a.len);

writeFileSync(OUT, JSON.stringify({ lines: out }));
const km = out.reduce((n, c) => n + c.len, 0) / 1000;
console.log(`${out.length} lines from ${segs.length} segments, ${km.toFixed(0)} km; longest ${(out[0].len / 1000).toFixed(1)} km; wrote ${OUT}`);
