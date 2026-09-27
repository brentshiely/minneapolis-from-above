#!/usr/bin/env node
// Bakes the Union of Concerned Scientists satellite database into
// public/data/ucs.json, keyed by NORAD catalog number: who operates each
// satellite, for whom, and what it's for. UCS last updated it in 2023;
// newer satellites fall back to CelesTrak's catalog alone.
//
//   node scripts/build-ucs.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const URL = "https://www.ucsusa.org/media/11490"; // tab-separated, official names
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "ucs.json");

const res = await fetch(URL, { headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" } });
if (!res.ok) throw new Error(`UCS download failed: ${res.status}`);
const text = new TextDecoder("windows-1252").decode(await res.arrayBuffer());
const [header, ...rows] = text.split(/\r?\n/).map((l) => l.split("\t"));
const col = (name) => {
  const i = header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  if (i < 0) throw new Error(`UCS column missing: ${name}`);
  return i;
};
const C = {
  country: col("Country of Operator/Owner"), operator: col("Operator/Owner"), users: col("Users"),
  purpose: col("Purpose"), detail: col("Detailed Purpose"), mass: col("Launch Mass (kg.)"),
  contractor: col("Contractor"), vehicle: col("Launch Vehicle"), norad: col("NORAD Number"),
};
const clean = (s) => (s ?? "").replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
const out = {};
for (const r of rows) {
  const norad = Number(clean(r[C.norad]));
  if (!Number.isInteger(norad) || norad <= 0) continue;
  const mass = Number(clean(r[C.mass]).replace(/,/g, ""));
  out[norad] = [
    clean(r[C.country]), clean(r[C.operator]), clean(r[C.users]), clean(r[C.purpose]), clean(r[C.detail]),
    Number.isFinite(mass) && mass > 0 ? mass : null, clean(r[C.contractor]), clean(r[C.vehicle]),
  ];
}
const json = JSON.stringify(out);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);
console.log(`satellites ${Object.keys(out).length}; wrote ${OUT}: ${(json.length / 1024).toFixed(0)} KB (${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped)`);
