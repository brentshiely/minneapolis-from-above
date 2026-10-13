/**
 * Real aerial photography over the drawn street map, up close and only
 * by day. Source: USGS NAIP (National Agriculture Imagery Program) via
 * the National Map's ImageServer — public domain, 60cm-1m resolution,
 * refreshed every 2-3 years per state. `{bbox-epsg-3857}` is MapLibre's
 * own placeholder for an ArcGIS export-image endpoint: it fills in each
 * tile's real Web Mercator bounds, no XYZ tile cache required. The
 * service already answers with `access-control-allow-origin: *` and a
 * 12-hour cache-control, so tiles are fetched straight from the browser
 * with no Cloudflare proxy needed.
 */
import type { Map } from "maplibre-gl";

export const IMAGERY_SOURCE_ID = "naip";
export const IMAGERY_LAYER_ID = "aerial-imagery";

const NAIP_TILE_URL = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage"
  + "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=jpg&f=image";

/** Below this zoom the imagery is fully faded out; not worth requesting. */
const FADE_START_ZOOM = 14;
/** At and above this zoom, daylight is the only remaining factor. */
const FADE_END_ZOOM = 16;

/** 0 zoomed out (whole metro), ramping to 1 once the view is close enough to read a photo. */
export function zoomFactor(zoom: number): number {
  return Math.min(1, Math.max(0, (zoom - FADE_START_ZOOM) / (FADE_END_ZOOM - FADE_START_ZOOM)));
}

/** Imagery only shows by day, and only up close: the two factors multiply. */
export function imageryOpacity(daylight: number, zoom: number): number {
  return daylight * zoomFactor(zoom);
}

/**
 * Adds the imagery below `beforeId` (typically the first road/rail line
 * layer), so it covers the drawn land, water and building fills but sits
 * under roads, transit lines and labels, which stay legible on top of it.
 */
export function addAerialImagery(map: Map, beforeId?: string) {
  map.addSource(IMAGERY_SOURCE_ID, {
    type: "raster",
    tiles: [NAIP_TILE_URL],
    // 512 px tiles: the same detail on screen from a quarter of the requests
    // (the USGS server drops some under bursts), so the zoom limits sit one lower.
    tileSize: 512,
    minzoom: 11,
    maxzoom: 18,
    attribution: "Imagery: USGS NAIP",
  });
  map.addLayer({
    id: IMAGERY_LAYER_ID,
    type: "raster",
    source: IMAGERY_SOURCE_ID,
    paint: { "raster-opacity": 0, "raster-fade-duration": 300 },
  }, beforeId);
}

export function setImageryOpacity(map: Map, daylight: number, zoom: number) {
  if (!map.getLayer(IMAGERY_LAYER_ID)) return;
  map.setPaintProperty(IMAGERY_LAYER_ID, "raster-opacity", imageryOpacity(daylight, zoom));
}
