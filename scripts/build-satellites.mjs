#!/usr/bin/env node
// Snapshots CelesTrak's orbits for every active satellite into
// public/data/satellites.tle, the fallback when the live endpoint can't
// reach CelesTrak. Orbits stay usable for days, so a snapshot per deploy
// is plenty. CelesTrak allows one download of a group per two hours; if
// it declines, the existing snapshot is kept.
//
//   node scripts/build-satellites.mjs
import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "satellites.tle");

const res = await fetch(URL, { headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" } });
const text = await res.text();
const lines = text.split(/\r?\n/).filter(Boolean);
if (!res.ok || lines.length < 3 || !lines[1].startsWith("1 ")) {
  const kept = existsSync(OUT) ? ` Keeping the snapshot from ${statSync(OUT).mtime.toISOString()}.` : " No snapshot yet.";
  console.warn(`CelesTrak declined (${res.status}: ${text.slice(0, 80).trim()}).${kept}`);
  process.exit(0);
}
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`satellites ${lines.length / 3}; wrote ${OUT}: ${(text.length / 1024).toFixed(0)} KB`);
