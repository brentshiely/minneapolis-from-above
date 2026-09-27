#!/usr/bin/env node
// Bakes MnDOT's IRIS traffic camera locations into public/data/cameras.json.
// Parsing lives in src/traffic/cameras.ts (shared with the unit tests); this
// script just downloads the config and writes the file.
//
//   node scripts/build-cameras.mjs            download the layout, then build
//   node scripts/build-cameras.mjs --cached   reuse .cache/mndot/config.xml.gz
//
// Same source file as scripts/build-mndot.mjs, so they share a cache: run
// one with --cached right after the other and it won't re-download.
// MnDOT's camera list changes rarely; re-run when cameras are added or moved.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parseCameras } from "../src/traffic/cameras.ts";

const CONFIG_URL = "https://data.dot.state.mn.us/iris_xml/metro_config.xml.gz";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "mndot", "config.xml.gz");
const OUT = join(ROOT, "public", "data", "cameras.json");

async function loadConfig() {
  if (process.argv.includes("--cached") && existsSync(CACHE)) return gunzipSync(readFileSync(CACHE)).toString("utf8");
  const res = await fetch(CONFIG_URL, { headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" } });
  if (!res.ok) throw new Error(`MnDOT layout download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, buf);
  return gunzipSync(buf).toString("utf8");
}

const xml = await loadConfig();
const cameras = parseCameras(xml);
const out = { generated: new Date().toISOString(), cameras };
const json = JSON.stringify(out);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);
console.log(`cameras ${cameras.length}`);
console.log(`wrote ${OUT}: ${(json.length / 1024).toFixed(0)} KB`);
