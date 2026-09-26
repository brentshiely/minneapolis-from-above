import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import { distM } from "../transit/data.ts";
import { sameWater, type Gauge } from "./gauges.ts";

type LonLat = [number, number];

/** How far from the cursor a named river line may be (the Mississippi is ~300 m wide). */
const RIVER_SEARCH_M = 700;
/** Gauges further than this along a river are too far away to speak for this spot. */
const MAX_GAUGE_KM = 40;
/** Shoreline gauges (like Gray's Bay) sit at the lake's edge; allow this much slack. */
const SHORE_SLACK_M = 250;

function metersPerPixel(map: MapLibreMap, lat: number): number {
  return (156_543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.getZoom();
}

function distToSegment(p: LonLat, a: LonLat, b: LonLat): number {
  const kx = Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * kx, ay = a[1] - p[1], bx = (b[0] - p[0]) * kx, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy) * 111_320;
}

function distToLines(p: LonLat, f: MapGeoJSONFeature): number {
  const g = f.geometry;
  const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
  let best = Infinity;
  for (const line of lines) for (let i = 1; i < line.length; i++) best = Math.min(best, distToSegment(p, line[i - 1] as LonLat, line[i] as LonLat));
  return best;
}

function inRing(p: LonLat, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygons(p: LonLat, features: MapGeoJSONFeature[]): boolean {
  for (const f of features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) if (inRing(p, poly[0]) && !poly.slice(1).some((hole) => inRing(p, hole))) return true;
  }
  return false;
}

/** Is `p`, or anywhere within `slack` meters of it, inside the polygons? */
function nearPolygons(p: LonLat, features: MapGeoJSONFeature[], slack: number): boolean {
  if (inPolygons(p, features)) return true;
  const dLat = slack / 111_320, dLon = slack / (111_320 * Math.cos((p[1] * Math.PI) / 180));
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    if (inPolygons([p[0] + dLon * Math.cos(a), p[1] + dLat * Math.sin(a)], features)) return true;
  }
  return false;
}

/**
 * Which lake outline each lake gauge sits on, by the map's water feature
 * id. Recorded whenever the gauge's area is loaded (the whole metro is on
 * screen at startup), so hovering far from the gauge still matches.
 */
const lakeOfGauge = new Map<string, unknown>();

/** Returns how many lake gauges are still unplaced. */
export function learnLakeGauges(map: MapLibreMap, gauges: Gauge[]): number {
  const pending = gauges.filter((g) => /^lake\b/i.test(g.body) && !lakeOfGauge.has(g.lid));
  if (!pending.length) return 0;
  const lakes = map.querySourceFeatures("openmaptiles", { sourceLayer: "water", filter: ["==", ["get", "class"], "lake"] }) as MapGeoJSONFeature[];
  for (const g of pending) {
    const f = lakes.find((l) => nearPolygons([g.lon, g.lat], [l], SHORE_SLACK_M));
    if (f) lakeOfGauge.set(g.lid, f.properties.id);
  }
  return pending.filter((g) => !lakeOfGauge.has(g.lid)).length;
}

/** For tests and debugging: which lake id each lake gauge was matched to. */
export const learnedLakes = () => Object.fromEntries(lakeOfGauge);

/**
 * The gauge that speaks for the water under the cursor, if any: a lake's
 * own gauge, or the nearest gauge on the named river the cursor is over.
 */
export function gaugeAt(map: MapLibreMap, x: number, y: number, lngLat: LonLat, gauges: Gauge[]): Gauge | undefined {
  const here = map.queryRenderedFeatures([x, y], { layers: ["water", "waterway"] });
  if (!here.length) return undefined;

  // Lakes: the lake's own gauge, on the same outline.
  const lake = here.find((f) => f.layer.id === "water" && f.properties.class === "lake");
  if (lake) {
    const own = gauges.find((g) => lakeOfGauge.get(g.lid) === lake.properties.id)
      // Not learned yet: fall back to the outline pieces loaded right now.
      ?? gauges
        .filter((g) => /^lake\b/i.test(g.body) && !lakeOfGauge.has(g.lid) && distM([g.lon, g.lat], lngLat) < MAX_GAUGE_KM * 1000)
        .find((g) => nearPolygons([g.lon, g.lat],
          map.querySourceFeatures("openmaptiles", { sourceLayer: "water", filter: ["==", ["get", "id"], lake.properties.id] }) as MapGeoJSONFeature[],
          SHORE_SLACK_M));
    // A lake without a gauge of its own says nothing, rather than borrowing
    // a nearby creek's reading.
    return own;
  }

  // Rivers and creeks: the nearest named river line, then its nearest gauge.
  const r = Math.max(12, Math.min(220, RIVER_SEARCH_M / metersPerPixel(map, lngLat[1])));
  const lines = map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers: ["waterway"] })
    .filter((f) => typeof f.properties.name === "string" && f.properties.name);
  let river: string | undefined, riverDist = Infinity;
  for (const f of lines) {
    const d = distToLines(lngLat, f);
    if (d < riverDist) { riverDist = d; river = f.properties.name as string; }
  }
  if (!river || riverDist > RIVER_SEARCH_M) return undefined;
  let best: Gauge | undefined, bestD = Infinity;
  for (const g of gauges) {
    if (!sameWater(g.body, river)) continue;
    const d = distM([g.lon, g.lat], lngLat);
    if (d < bestD) { bestD = d; best = g; }
  }
  return best && bestD < MAX_GAUGE_KM * 1000 ? best : undefined;
}
