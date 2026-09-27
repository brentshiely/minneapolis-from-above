/**
 * MnDOT freeway incidents, in plain language.
 */
import { ago, type Description } from "../describe.ts";
import type { Incident, IncidentsResponse } from "../../functions/api/incidents.ts";

export type { Incident, IncidentsResponse };

const TYPE_WORD: Record<string, string> = {
  INCIDENT_CRASH: "Crash", INCIDENT_STALL: "Stalled vehicle", INCIDENT_HAZARD: "Road hazard",
  INCIDENT_ROADWORK: "Road work", INCIDENT_CONSTRUCTION: "Construction",
};
export const incidentWord = (type: string): string => TYPE_WORD[type] ?? "Incident";

/** "T.H.101" and "U.S.169" both read as "Highway 101" / "Highway 169" locally. */
export function formatRoad(road: string): string {
  const m = /^(?:T\.H\.|U\.S\.)(\d+)$/.exec(road);
  return m ? `Highway ${m[1]}` : road;
}

const DIR_WORD: Record<string, string> = { EB: "eastbound", WB: "westbound", NB: "northbound", SB: "southbound" };
export const dirWord = (dir: string): string => DIR_WORD[dir] ?? dir;

export function describeIncident(x: Incident, nowS: number): Description {
  const road = formatRoad(x.road);
  const where = x.location ? ` near ${x.location}` : "";
  const title = `${x.detail || incidentWord(x.type)} on ${road} ${dirWord(x.dir)}${where}.`;
  return { title, detail: `Reported ${ago(nowS - x.at)}.`, meta: road };
}

const PREVIEW: Record<string, Incident> = {
  crash: { id: "preview-crash", type: "INCIDENT_CRASH", road: "I-494", dir: "EB", location: "12th Ave", position: [-93.258, 44.862], at: 0 },
  stall: { id: "preview-stall", type: "INCIDENT_STALL", road: "I-35W", dir: "NB", position: [-93.187, 45.013], at: 0 },
  hazard: { id: "preview-hazard", type: "INCIDENT_HAZARD", detail: "Vehicle Fire", road: "I-35W", dir: "NB", position: [-93.049, 45.203], at: 0 },
  roadwork: { id: "preview-roadwork", type: "INCIDENT_ROADWORK", road: "T.H.62", dir: "WB", location: "Hwy 100", position: [-93.33, 44.9], at: 0 },
};

/** `?incident=crash` (or stall, hazard, roadwork) previews one, timestamped to read as "just now". */
export function previewIncidents(spec: string): IncidentsResponse | undefined {
  const preset = PREVIEW[spec.trim().toLowerCase()];
  if (!preset) return undefined;
  const t = Math.floor(Date.now() / 1000);
  return { t, incidents: [{ ...preset, at: t - 12 * 60 }] };
}
