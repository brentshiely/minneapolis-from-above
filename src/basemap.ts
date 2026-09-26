// Pinned to MapLibre 5: deck.gl 9.4's map integration reads map.transform,
// which MapLibre 6 removed. Revisit when deck.gl supports 6.
import { Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/** Frames the seven-county core: Minneapolis–Saint Paul plus inner suburbs. */
export const METRO_CENTER: [number, number] = [-93.18, 44.96];
export const METRO_BOUNDS: [[number, number], [number, number]] = [[-94.15, 44.55], [-92.55, 45.35]];

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/**
 * Night palette applied over OpenFreeMap's dark style. The base map should
 * recede so moving vehicles carry the picture: land near-black, water a
 * lit-from-below blue, roads a faint warm grey like sodium light at a distance.
 */
const NIGHT: Record<string, Record<string, unknown>> = {
  background: { "background-color": "#070b10" },
  water: { "fill-color": "#0c1a2a" },
  waterway: { "line-color": "#0f2236" },
  landuse_residential: { "fill-color": "#0a0f15", "fill-opacity": 0.6 },
  landcover_wood: { "fill-pattern": undefined, "fill-color": "#0a130f", "fill-opacity": 0.6 },
  landuse_park: { "fill-color": "#0b1511" },
  building: { "fill-color": "#10161d", "fill-outline-color": "#161e27" },
  highway_minor: { "line-color": "#161c22" },
  highway_path: { "line-color": "#12181e" },
  highway_major_casing: { "line-color": "#0b0f14" },
  highway_major_inner: { "line-color": "#1f252b" },
  highway_major_subtle: { "line-color": "#1a2026" },
  highway_motorway_casing: { "line-color": "#0b0f14" },
  highway_motorway_inner: { "line-color": "#2a2621" },
  highway_motorway_subtle: { "line-color": "#221f1b" },
  "aeroway-runway": { "line-color": "#1b2229" },
  "aeroway-taxiway": { "line-color": "#141a20" },
  "aeroway-area": { "fill-color": "#0d1318" },
};

const LABEL_COLOR = "#5d6b78";
const LABEL_HALO = "#070b10";

export function createBaseMap(container: HTMLElement): Map {
  const map = new Map({
    container,
    style: STYLE_URL,
    center: METRO_CENTER,
    zoom: 10.3,
    minZoom: 8.5,
    maxZoom: 18.5,
    maxBounds: METRO_BOUNDS,
    maxPitch: 60,
    attributionControl: { compact: true },
    fadeDuration: 0,
  });

  map.on("style.load", () => {
    for (const layer of map.getStyle().layers) {
      const paint = NIGHT[layer.id];
      if (paint) for (const [k, v] of Object.entries(paint)) map.setPaintProperty(layer.id, k as never, v as never);
      if (layer.type === "symbol") {
        map.setPaintProperty(layer.id, "text-color", LABEL_COLOR);
        map.setPaintProperty(layer.id, "text-halo-color", LABEL_HALO);
      }
    }
    // Railway and oneway arrows compete with live transit; drop them.
    for (const id of ["road_oneway", "road_oneway_opposite", "railway_transit", "railway_transit_dashline"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    }
  });

  return map;
}
