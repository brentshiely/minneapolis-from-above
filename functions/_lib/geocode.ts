/**
 * Batch geocoding for feeds that publish an address but no point.
 *
 * Both geocoders are free and keyless: the US Census Bureau's (any US
 * address, matched against TIGER address ranges) and an Esri GeocodeServer
 * (a city's or county's own locator, where one exists). Each takes a whole
 * batch in a single request, so a feed costs one extra subrequest however
 * many addresses it has. Addresses that don't match are simply absent from
 * the result and the caller falls back to something coarser.
 */

export type LonLat = [number, number];
export interface GeocodeInput { id: string; street: string }

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const CENSUS_BATCH = 9000; // the service takes 10,000 per file
const ESRI_BATCH = 1000; // the locator's MaxBatchSize

/** One line of the Census batch CSV, honoring quoted fields (the coordinates are "lon,lat"). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Census batch result lines -> id -> point, keeping only matches. */
export function parseCensus(csv: string): Map<string, LonLat> {
  const out = new Map<string, LonLat>();
  for (const line of csv.split(/\r?\n/)) {
    if (!line) continue;
    const f = parseCsvLine(line);
    // id, input, Match|No_Match|Tie, Exact|Non_Exact, matched address, "lon,lat", tiger id, side
    if (f[2] !== "Match" || !f[5]) continue;
    const [x, y] = f[5].split(",").map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) out.set(f[0], [x, y]);
  }
  return out;
}

export async function censusBatch(inputs: GeocodeInput[], city: string, state: string): Promise<Map<string, LonLat>> {
  const out = new Map<string, LonLat>();
  for (let i = 0; i < inputs.length; i += CENSUS_BATCH) {
    const rows = inputs.slice(i, i + CENSUS_BATCH).map((a) => `${a.id},"${a.street.replace(/"/g, "")}",${city},${state},`).join("\n");
    const form = new FormData();
    form.append("addressFile", new Blob([rows], { type: "text/csv" }), "addresses.csv");
    form.append("benchmark", "Public_AR_Current");
    const res = await fetch(CENSUS_URL, { method: "POST", body: form });
    if (!res.ok) throw new Error(`census ${res.status}`);
    for (const [k, v] of parseCensus(await res.text())) out.set(k, v);
  }
  return out;
}

/** Lowest locator score still trusted as the right address. */
const MIN_SCORE = 85;

interface EsriLocation { attributes?: { ResultID?: number; Score?: number }; location?: { x?: number; y?: number } }

/** Esri geocodeAddresses result -> id -> point, keeping only confident matches. */
export function parseEsri(locations: EsriLocation[], ids: string[]): Map<string, LonLat> {
  const out = new Map<string, LonLat>();
  for (const l of locations) {
    const n = l.attributes?.ResultID;
    const x = l.location?.x, y = l.location?.y;
    if (n == null || x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    if ((l.attributes?.Score ?? 0) < MIN_SCORE) continue;
    const id = ids[n - 1];
    if (id !== undefined) out.set(id, [x, y]);
  }
  return out;
}

/** `locator` is a GeocodeServer URL; its single "Address" field takes the whole street address. */
export async function esriBatch(locator: string, inputs: GeocodeInput[]): Promise<Map<string, LonLat>> {
  const out = new Map<string, LonLat>();
  for (let i = 0; i < inputs.length; i += ESRI_BATCH) {
    const chunk = inputs.slice(i, i + ESRI_BATCH);
    const records = chunk.map((a, n) => ({ attributes: { OBJECTID: n + 1, Address: a.street } }));
    const res = await fetch(`${locator}/geocodeAddresses`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ addresses: JSON.stringify({ records }), outSR: "4326", f: "json" }),
    });
    if (!res.ok) throw new Error(`geocoder ${res.status}`);
    const body = (await res.json()) as { locations?: EsriLocation[] };
    for (const [k, v] of parseEsri(body.locations ?? [], chunk.map((a) => a.id))) out.set(k, v);
  }
  return out;
}
