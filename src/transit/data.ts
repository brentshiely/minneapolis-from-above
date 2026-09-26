/** Baked by scripts/build-gtfs.mjs into public/data/transit.json. */
export type Mode = "rail" | "brt" | "bus";

export interface RouteInfo {
  name: string;
  long: string;
  mode: Mode;
  color: string;
  sort: number;
}

export interface TransitFile {
  generated: string;
  feed: { version: string; start: string; end: string };
  routes: Record<string, RouteInfo>;
  /** `head` is the destination sign, `dir` the direction (NB, SB, EB, WB). */
  shapes: { id: string; route: string; head: string; dir: string; line: string }[];
  trips: Record<string, number>;
}

/** A route shape ready for snapping and interpolation. */
export interface Shape {
  id: string;
  route: string;
  /** Destination sign most trips on this shape show, e.g. "Selby-Lake / Lake & France". */
  headsign: string;
  /** NB, SB, EB or WB. */
  direction: string;
  /** [lon, lat] vertices. */
  path: [number, number][];
  /** Cumulative distance in meters at each vertex; cum[0] = 0. */
  cum: Float64Array;
  length: number;
}

export interface Transit {
  file: TransitFile;
  routes: Record<string, RouteInfo>;
  shapes: Shape[];
  shapeForTrip(tripId: string | undefined): Shape | undefined;
}

export const M_PER_DEG_LAT = 111_320;

/** Decode a Google encoded polyline (5-digit precision) to [lon, lat]. */
export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let result = 0, shift = 0, b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    out.push([lon / 1e5, lat / 1e5]);
  }
  return out;
}

/** Meters between two [lon, lat] points; flat-earth is exact enough at metro scale. */
export function distM(a: readonly [number, number], b: readonly [number, number]): number {
  const kx = M_PER_DEG_LAT * Math.cos(((a[1] + b[1]) * Math.PI) / 360);
  const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

export function buildShape(id: string, route: string, path: [number, number][], headsign = "", direction = ""): Shape {
  const cum = new Float64Array(path.length);
  for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + distM(path[i - 1], path[i]);
  return { id, route, headsign, direction, path, cum, length: cum[path.length - 1] ?? 0 };
}

export function parseTransit(file: TransitFile): Transit {
  const shapes = file.shapes.map((s) => buildShape(s.id, s.route, decodePolyline(s.line), s.head ?? "", s.dir ?? ""));
  return {
    file,
    routes: file.routes,
    shapes,
    shapeForTrip(tripId) {
      if (!tripId) return undefined;
      const idx = file.trips[tripId];
      return idx === undefined ? undefined : shapes[idx];
    },
  };
}

export async function loadTransit(url = "/data/transit.json"): Promise<Transit> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load route data (${res.status}). Run: node scripts/build-gtfs.mjs`);
  return parseTransit(await res.json());
}
