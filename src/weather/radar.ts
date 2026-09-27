/**
 * Live NEXRAD radar reflectivity: just the current picture, no loop —
 * this is a passive, ambient map, not a weather app to watch play out.
 * Iowa Environmental Mesonet's tile cache serves it as a real
 * {z}/{x}/{y} tile at `nexrad-n0q-m05m-900913` ("5 minutes ago"; IEM's
 * mosaic for "right now" is often still generating and 404s more than
 * it succeeds, while 5-minutes-ago is reliably there), refreshed every
 * five minutes to match. IEM answers the browser directly (open CORS),
 * but MapLibre's own fetch()+createImageBitmap() tile loader throws
 * "the source image could not be decoded" on IEM's response — a plain
 * <img> tag or a manual fetch decodes the identical, standard PNG bytes
 * without issue, so this is something about IEM's response specifically
 * tripping up MapLibre's loader, not a bad image. Proxied through
 * /api/radar-tile (functions/api/radar-tile.ts) to sidestep it.
 */
import type { Map } from "maplibre-gl";

/** Reliably available, unlike "right now" (see above). */
const OFFSET_MIN = 5;
const LAYER_ID = "radar";
/** Visible but never hides the streets and vehicles under it. */
const BASE_ALPHA = 0.55;

export function radarTileUrl(bust: number): string {
  const nn = String(OFFSET_MIN).padStart(2, "0");
  return `/api/radar-tile?m=${nn}&z={z}&x={x}&y={y}&v=${bust}`;
}

/** IEM refreshes its mosaic roughly every 5 minutes; a matching cache-bust bucket. */
export function cacheBust(nowMs: number): number {
  return Math.floor(nowMs / (5 * 60_000));
}

/** Adds the one current-radar source/layer. */
export function addRadarLayer(map: Map, beforeId?: string) {
  map.addSource(LAYER_ID, {
    type: "raster",
    tiles: [radarTileUrl(cacheBust(Date.now()))],
    tileSize: 256,
    minzoom: 3,
    maxzoom: 10,
    attribution: "Radar: Iowa Environmental Mesonet",
  });
  map.addLayer({
    id: LAYER_ID,
    type: "raster",
    source: LAYER_ID,
    paint: { "raster-opacity": BASE_ALPHA, "raster-fade-duration": 300 },
  }, beforeId);
}

/**
 * The URL is relative ("5 minutes ago"), so the same URL means a
 * different image 5 minutes later; MapLibre won't know to ask again on
 * its own. Called periodically to force a refetch.
 */
export function refreshRadarTile(map: Map) {
  const src = map.getSource(LAYER_ID) as { setTiles?: (t: string[]) => void } | undefined;
  src?.setTiles?.([radarTileUrl(cacheBust(Date.now()))]);
}
