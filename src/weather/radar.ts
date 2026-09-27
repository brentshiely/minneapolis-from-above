/**
 * Live NEXRAD radar reflectivity, looping through the last half hour so
 * rain and snow visibly slide across the map. Iowa Environmental
 * Mesonet's tile cache serves each frame as a real {z}/{x}/{y} tile at
 * `nexrad-n0q-m{NN}m-900913` ("N minutes ago"), refreshed roughly every
 * five minutes. IEM answers the browser directly (open CORS), but
 * MapLibre's own fetch()+createImageBitmap() tile loader throws
 * "the source image could not be decoded" on IEM's response — a plain
 * <img> tag or a manual fetch decodes the identical, standard PNG bytes
 * without issue, so this is something about IEM's response specifically
 * tripping up MapLibre's loader, not a bad image. Proxied through
 * /api/radar-tile (functions/api/radar-tile.ts) to sidestep it.
 */
import type { Map } from "maplibre-gl";

/**
 * Oldest to newest, five minutes apart, a bit over the last half hour.
 * Stops at 5 rather than 0: IEM's mosaic for "right now" is often still
 * being generated and 404s more often than not, while 5-minutes-ago is
 * reliably there.
 */
export const FRAME_OFFSETS_MIN = [30, 25, 20, 15, 10, 5];
const FRAME_S = 0.6;
/** A longer pause on "now" before the loop restarts, so it reads as current. */
const HOLD_S = 1.6;
const CYCLE_S = FRAME_OFFSETS_MIN.length * FRAME_S + HOLD_S;
/** Visible but never hides the streets and vehicles under it. */
const BASE_ALPHA = 0.55;

export function radarTileUrl(offsetMin: number, bust: number): string {
  const nn = String(offsetMin).padStart(2, "0");
  return `/api/radar-tile?m=${nn}&z={z}&x={x}&y={y}&v=${bust}`;
}

/** Which frame index is showing at a given time (seconds), looping forever. */
export function currentFrame(now: number): number {
  const t = ((now % CYCLE_S) + CYCLE_S) % CYCLE_S;
  return Math.min(FRAME_OFFSETS_MIN.length - 1, Math.floor(t / FRAME_S));
}

/** IEM refreshes its mosaic roughly every 5 minutes; a matching cache-bust bucket. */
export function cacheBust(nowMs: number): number {
  return Math.floor(nowMs / (5 * 60_000));
}

const layerId = (i: number) => `radar-${i}`;

/** Adds one source/layer per frame, all transparent until `setRadarFrame` picks one. */
export function addRadarLayers(map: Map, beforeId?: string) {
  const bust = cacheBust(Date.now());
  FRAME_OFFSETS_MIN.forEach((offset, i) => {
    map.addSource(layerId(i), {
      type: "raster",
      tiles: [radarTileUrl(offset, bust)],
      tileSize: 256,
      minzoom: 3,
      maxzoom: 10,
      attribution: "Radar: Iowa Environmental Mesonet",
    });
    map.addLayer({
      id: layerId(i),
      type: "raster",
      source: layerId(i),
      paint: { "raster-opacity": 0, "raster-fade-duration": 0 },
    }, beforeId);
  });
}

/** Shows exactly one frame (the rest at zero opacity) so the loop reads as motion, not a crossfade smear. */
export function setRadarFrame(map: Map, activeIndex: number) {
  FRAME_OFFSETS_MIN.forEach((_, i) => {
    if (!map.getLayer(layerId(i))) return;
    map.setPaintProperty(layerId(i), "raster-opacity", i === activeIndex ? BASE_ALPHA : 0);
  });
}

/**
 * Each frame's URL is relative ("5 minutes ago"), so the same URL means a
 * different image 5 minutes later; MapLibre won't know to ask again on
 * its own. Called periodically to force a refetch of every frame.
 */
export function refreshRadarTiles(map: Map) {
  const bust = cacheBust(Date.now());
  FRAME_OFFSETS_MIN.forEach((offset, i) => {
    const src = map.getSource(layerId(i)) as { setTiles?: (t: string[]) => void } | undefined;
    src?.setTiles?.([radarTileUrl(offset, bust)]);
  });
}
