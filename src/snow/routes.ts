import { decodePolyline } from "../transit/data.ts";
import type { City } from "./rules.ts";

/** Baked by scripts/build-snow.mjs into public/data/snow-routes.json. */
interface SnowRoutesFile {
  mpls: { names: string[]; lines: [number, string][] };
  stp: { names: string[]; lines: [number, string][] };
}

/** One stretch of a snow emergency route. */
export interface SnowRoute {
  city: City;
  /** Street name, when the city's data has one (Minneapolis does). */
  name: string;
  path: [number, number][];
}

export type SnowRoutes = Record<City, SnowRoute[]>;

export function parseSnowRoutes(file: SnowRoutesFile): SnowRoutes {
  const read = (city: City) => file[city].lines.map(([i, line]) => ({ city, name: file[city].names[i] ?? "", path: decodePolyline(line) }));
  return { mpls: read("mpls"), stp: read("stp") };
}

export async function loadSnowRoutes(url = "/data/snow-routes.json"): Promise<SnowRoutes> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load snow emergency routes (${res.status}). Run: node scripts/build-snow.mjs`);
  return parseSnowRoutes(await res.json());
}
