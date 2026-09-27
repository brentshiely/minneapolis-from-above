#!/usr/bin/env node
// Snapshots CelesTrak's tracked debris clouds into public/data/debris.tle,
// the fallback when the live endpoint can't reach CelesTrak: the 2007
// Fengyun-1C anti-satellite test, the 2009 Iridium 33 / Cosmos 2251
// collision, and the 2021 Cosmos 1408 anti-satellite test. CelesTrak
// allows one download per group per two hours; if any group is declined,
// the existing snapshot is kept.
//
//   node scripts/build-debris.mjs
import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEBRIS_GROUPS = ["fengyun-1c-debris", "cosmos-2251-debris", "iridium-33-debris", "cosmos-1408-debris"];
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "debris.tle");

const parts = [];
for (const g of DEBRIS_GROUPS) {
  const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, {
    headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
  });
  const text = await res.text();
  if (!res.ok || !/^1 \d/m.test(text)) {
    const kept = existsSync(OUT) ? ` Keeping the snapshot from ${statSync(OUT).mtime.toISOString()}.` : " No snapshot yet.";
    console.warn(`CelesTrak declined ${g} (${res.status}: ${text.slice(0, 60).trim()}).${kept}`);
    process.exit(0);
  }
  parts.push(text.split(/\r?\n/).filter(Boolean).join("\n"));
}
writeFileSync(OUT, parts.join("\n") + "\n");
console.log(`debris ${parts.join("\n").split("\n").length / 3} pieces; wrote ${OUT}`);
