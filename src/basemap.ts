// Pinned to MapLibre 5: deck.gl 9.4's map integration reads map.transform,
// which MapLibre 6 removed. Revisit when deck.gl supports 6.
import { Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { blendPair, through3, type Pair } from "./color.ts";

/** Frames the seven-county core: Minneapolis–Saint Paul plus inner suburbs. */
export const METRO_CENTER: [number, number] = [-93.18, 44.96];
/**
 * What the first view must show, whatever the screen's shape: both
 * downtowns, the U and MSP. A tall phone fits it by zooming out a little.
 */
export const CORE_BOUNDS: [[number, number], [number, number]] = [[-93.38, 44.86], [-93.03, 45.02]];
/** Sharper than 2x costs a phone a lot of GPU for detail nobody can see. */
export const MAX_PIXEL_RATIO = 2;
export const METRO_BOUNDS: [[number, number], [number, number]] = [[-94.15, 44.55], [-92.55, 45.35]];

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";


/**
 * The base map's two looks, painted over OpenFreeMap's dark style.
 *
 * Night recedes so moving vehicles carry the picture: land near-black,
 * water a lit-from-below blue, roads a faint warm grey like sodium light
 * at a distance. Day is a quiet printed-map look: warm off-white land,
 * soft blue water, pale green parks, white streets and cream highways,
 * so the saturated vehicles still read first.
 */
const SKY: Record<string, Record<string, Pair>> = {
  background: { "background-color": ["#070b10", "#eceee9"] },
  water: { "fill-color": ["#0c1a2a", "#a9c7dd"] },
  waterway: { "line-color": ["#0f2236", "#a9c7dd"] },
  landcover_ice_shelf: { "fill-color": ["#070b10", "#eceee9"] },
  landcover_glacier: { "fill-color": ["#070b10", "#eceee9"] },
  landuse_residential: { "fill-color": ["#0a0f15", "#e5e6e1"], "fill-opacity": [0.6, 1] },
  landcover_wood: { "fill-color": ["#0a130f", "#cfe0c3"], "fill-opacity": [0.6, 0.75] },
  landuse_park: { "fill-color": ["#0b1511", "#d3e5c8"] },
  building: { "fill-color": ["#10161d", "#dadad3"], "fill-outline-color": ["#161e27", "#cacac2"] },
  "aeroway-taxiway": { "line-color": ["#141a20", "#d6d6d0"] },
  "aeroway-runway-casing": { "line-color": ["#0b0f14", "#c6c6bf"] },
  "aeroway-area": { "fill-color": ["#0d1318", "#e0e0da"] },
  "aeroway-runway": { "line-color": ["#1b2229", "#c1c1ba"] },
  road_area_pier: { "fill-color": ["#070b10", "#eceee9"] },
  road_pier: { "line-color": ["#070b10", "#eceee9"] },
  highway_path: { "line-color": ["#12181e", "#f6f6f2"] },
  highway_minor: { "line-color": ["#161c22", "#ffffff"] },
  highway_major_casing: { "line-color": ["#0b0f14", "#d2d0c6"] },
  highway_major_inner: { "line-color": ["#1f252b", "#ffffff"] },
  highway_major_subtle: { "line-color": ["#1a2026", "#f3f2ec"] },
  highway_motorway_casing: { "line-color": ["#0b0f14", "#d8bd87"] },
  highway_motorway_inner: { "line-color": ["#2a2621", "#f5e1b4"] },
  highway_motorway_subtle: { "line-color": ["#221f1b", "#eedaae"] },
  railway: { "line-color": ["#1a1f25", "#c8c8c2"] },
  railway_dashline: { "line-color": ["#070b10", "#eceee9"] },
  railway_minor: { "line-color": ["#1a1f25", "#c8c8c2"] },
  railway_minor_dashline: { "line-color": ["#070b10", "#eceee9"] },
  boundary_state: { "line-color": ["#2a3139", "#b8b8c3"] },
  "boundary_country_z0-4": { "line-color": ["#2a3139", "#b8b8c3"] },
  "boundary_country_z5-": { "line-color": ["#2a3139", "#b8b8c3"] },
};

/**
 * Labels get explicit night, blue-hour and day colors: blending text and
 * halo toward the same midpoint would erase the contrast between them.
 */
const LABEL: Record<string, [string, string, string]> = {
  "text-color": ["#5d6b78", "#aebccb", "#56606a"],
  "text-halo-color": ["#070b10", "#1c2838", "#ffffff"],
};

/** Layers to leave out entirely: they compete with live transit. */
const HIDDEN = ["road_oneway", "road_oneway_opposite", "railway_transit", "railway_transit_dashline"];

/** Repaint the base map for a daylight level from 0 (night) to 1 (day). */
export function paintSky(map: Map, d: number) {
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol") {
      for (const [prop, [n, t, dy]] of Object.entries(LABEL)) map.setPaintProperty(layer.id, prop as never, through3(n, t, dy, d) as never);
      continue;
    }
    const paint = SKY[layer.id];
    if (!paint) continue;
    for (const [prop, pair] of Object.entries(paint)) {
      map.setPaintProperty(layer.id, prop as never, blendPair(pair, d) as never);
    }
  }
}

export function createBaseMap(container: HTMLElement, initialDaylight = 0): Map {
  const map = new Map({
    container,
    style: STYLE_URL,
    // Fit the core to this screen, but never closer than the classic metro view.
    bounds: CORE_BOUNDS,
    fitBoundsOptions: { padding: 24, maxZoom: 10.3 },
    pixelRatio: Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO),
    minZoom: 8.5,
    maxZoom: 18.5,
    maxBounds: METRO_BOUNDS,
    maxPitch: 60,
    attributionControl: { compact: true },
    fadeDuration: 0,
  });

  map.on("style.load", () => {
    // The style's wood texture is a dark-mode pattern; flat color reads better in both.
    if (map.getLayer("landcover_wood")) map.setPaintProperty("landcover_wood", "fill-pattern", undefined);
    for (const id of HIDDEN) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    paintSky(map, initialDaylight);
  });

  return map;
}
