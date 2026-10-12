/**
 * Terrain relief: the bluffs, river gorge, glacial hills and lake basins,
 * shaded as if lit from the northwest. Source: USGS 3DEP bare-earth
 * elevation, which is built from airborne lidar (Minnesota's is 1 m
 * resolution), shaded on the server by its own "Hillshade Gray" function.
 * Same pattern as the aerial imagery: an ArcGIS export-image endpoint that
 * MapLibre fills with each tile's bounds, answering with
 * `access-control-allow-origin: *`, so no proxy is needed.
 */
import type { Map } from "maplibre-gl";

export const RELIEF_SOURCE_ID = "relief";
export const RELIEF_LAYER_ID = "terrain-relief";

const RELIEF_TILE_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
  + "?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&f=image"
  + "&renderingRule=%7B%22rasterFunction%22%3A%22Hillshade%20Gray%22%7D";

/** Below this zoom the shading is too fine to read and isn't requested. */
const FADE_START_ZOOM = 9.5;
/** At and above this zoom the shading is at full strength. */
const FADE_END_ZOOM = 12;
/** Aerial photography takes over by day from here, and carries its own shadows. */
const HAND_OFF_START_ZOOM = 14;
const HAND_OFF_END_ZOOM = 16;

/** 0 zoomed out, ramping to 1 once the view is close enough to read the land's shape. */
export function reliefZoomFactor(zoom: number): number {
  return Math.min(1, Math.max(0, (zoom - FADE_START_ZOOM) / (FADE_END_ZOOM - FADE_START_ZOOM)));
}

/** By day the photo replaces the shading as it fades in; at night there is no photo. */
export function reliefHandOff(daylight: number, zoom: number): number {
  const photo = daylight * Math.min(1, Math.max(0, (zoom - HAND_OFF_START_ZOOM) / (HAND_OFF_END_ZOOM - HAND_OFF_START_ZOOM)));
  return 1 - photo;
}

/** Subtle on the pale day map; a touch stronger at night, where the dimmed grey is mostly a faint rim light. */
const DAY_OPACITY = 0.55;
const NIGHT_OPACITY = 0.7;
/** Flat ground is a light grey in the source; scaled down at night so it doesn't wash the dark map out. */
const NIGHT_BRIGHTNESS_MAX = 0.22;

export function reliefOpacity(daylight: number, zoom: number): number {
  const strength = NIGHT_OPACITY + (DAY_OPACITY - NIGHT_OPACITY) * daylight;
  return strength * reliefZoomFactor(zoom) * reliefHandOff(daylight, zoom);
}

export function reliefBrightnessMax(daylight: number): number {
  return NIGHT_BRIGHTNESS_MAX + (1 - NIGHT_BRIGHTNESS_MAX) * daylight;
}

/** Added below `beforeId` (and below the aerial photo's own layer), so roads, rail and labels stay on top. */
export function addRelief(map: Map, beforeId?: string) {
  map.addSource(RELIEF_SOURCE_ID, {
    type: "raster",
    tiles: [RELIEF_TILE_URL],
    tileSize: 256,
    minzoom: 9,
    maxzoom: 17,
    attribution: "Relief: USGS 3DEP lidar",
  });
  map.addLayer({
    id: RELIEF_LAYER_ID,
    type: "raster",
    source: RELIEF_SOURCE_ID,
    paint: { "raster-opacity": 0, "raster-fade-duration": 300 },
  }, beforeId);
}

export function setReliefOpacity(map: Map, daylight: number, zoom: number, shown: boolean) {
  if (!map.getLayer(RELIEF_LAYER_ID)) return;
  map.setPaintProperty(RELIEF_LAYER_ID, "raster-opacity", shown ? reliefOpacity(daylight, zoom) : 0);
  map.setPaintProperty(RELIEF_LAYER_ID, "raster-brightness-max", reliefBrightnessMax(daylight));
}
