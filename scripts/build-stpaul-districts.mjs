#!/usr/bin/env node
// Bakes Saint Paul's 17 district council boundaries into
// public/data/stpaul-districts.json: each one's centroid and an
// area-equivalent radius, keyed by district number. Saint Paul's crime
// data (unlike Minneapolis's) carries no point geometry, only a
// district number -- this lets a crime event be placed at a plausible
// spot inside its real district instead of at one shared pin.
//
//   node scripts/build-stpaul-districts.mjs
//
// District boundaries almost never change; re-run only if Saint Paul
// redraws them.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const URL = "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/District_Councils/FeatureServer/0/query"
  + "?where=1%3D1&outFields=districtnumber,planningdistrictname&outSR=4326&f=geojson";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "data", "stpaul-districts.json");

const M_PER_DEG = 111_320;

/** Centroid and area of a simple polygon ring, in local flat meters. */
function ringCentroidAndArea(ring, kx) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = [ring[i][0] * kx, ring[i][1] * M_PER_DEG];
    const [x1, y1] = [ring[i + 1][0] * kx, ring[i + 1][1] * M_PER_DEG];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a /= 2;
  return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
}

async function main() {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Saint Paul district boundaries download failed: ${res.status}`);
  const geo = await res.json();

  const out = {};
  for (const f of geo.features) {
    const num = f.properties.districtnumber;
    const ring = f.geometry.coordinates[0]; // confirmed: simple Polygon, one ring, no holes
    const kx = M_PER_DEG * Math.cos((ring[0][1] * Math.PI) / 180);
    const { area, cx, cy } = ringCentroidAndArea(ring, kx);
    out[num] = {
      name: f.properties.planningdistrictname,
      center: [cx / kx, cy / M_PER_DEG],
      radiusM: Math.round(Math.sqrt(area / Math.PI)),
    };
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${Object.keys(out).length} districts to ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
