/**
 * Cloudflare Pages Function: GET /api/gunfire
 *
 * Recent gunfire calls from Minneapolis Police's open data (an Esri
 * FeatureServer, free, no key, CORS-open): callers reporting shots fired,
 * ShotSpotter sensor activations, and shootings. These are calls for
 * service, not confirmed offenses, so they're their own layer rather than
 * part of the crime events. Updated daily; most records are under a day old.
 *
 * Like the crime feeds, each point is snapped to a block-sized cell so it
 * can't be traced to a door.
 */
const URL = "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/Shots_Fired/FeatureServer/0/query";
const TTL_S = 1800;
/** The layer fades out client-side over a couple of days; no point asking further back. */
const LOOKBACK_DAYS = 3;
/** Roughly a city block: 0.001 degrees is about 110 m north-south and 80 m east-west here. */
const BLOCK_DEG = 0.001;

export interface GunfireEvent {
  id: string;
  /** Plain-language kind of call. */
  label: string;
  /** POSIX seconds. */
  reportedAt: number;
  position: [number, number];
  /** "Precinct 3", when the call was inside a precinct. */
  precinct?: string;
}

export interface GunfireResponse {
  t: number;
  events: GunfireEvent[];
}

interface Feature {
  attributes: { OBJECTID?: number; Master_Incident_Number?: string; Problem?: string; Response_Date?: number; Division?: string };
  geometry?: { x?: number; y?: number };
}

/** The dispatch problem types, in plain words. Anything new keeps its own wording, minus the priority code. */
export function labelFor(problem: string): string {
  if (/shotspotter/i.test(problem)) return "ShotSpotter detected gunfire";
  if (/sound of shots/i.test(problem)) return "Shots fired reported";
  if (/shooting report only/i.test(problem)) return "Shooting reported";
  if (/^shooting/i.test(problem)) return "Shooting";
  return problem.replace(/\s*\([^)]*\)\s*$/, "").trim() || "Gunfire reported";
}

export function gunfireEvents(features: Feature[]): GunfireEvent[] {
  const out: GunfireEvent[] = [];
  for (const { attributes: a, geometry: g } of features) {
    if (a.OBJECTID == null || !a.Master_Incident_Number || a.Response_Date == null || !a.Problem || g?.x == null || g?.y == null) continue;
    const precinct = /^Precinct \d+/.exec(a.Division ?? "")?.[0];
    out.push({
      id: `gf-${a.Master_Incident_Number}-${a.OBJECTID}`,
      label: labelFor(a.Problem),
      reportedAt: Math.floor(a.Response_Date / 1000),
      position: [(Math.floor(g.x / BLOCK_DEG) + 0.5) * BLOCK_DEG, (Math.floor(g.y / BLOCK_DEG) + 0.5) * BLOCK_DEG],
      precinct,
    });
  }
  return out;
}

/** Esri's query API wants this literal form for a date comparison. */
const sinceWhere = (sinceMs: number) =>
  encodeURIComponent(`Response_Date >= TIMESTAMP '${new Date(sinceMs).toISOString().slice(0, 19).replace("T", " ")}'`);

export const onRequestGet = async (): Promise<Response> => {
  const now = Date.now();
  try {
    const res = await fetch(
      `${URL}?where=${sinceWhere(now - LOOKBACK_DAYS * 86_400_000)}&outFields=OBJECTID,Master_Incident_Number,Problem,Response_Date,Division`
      + "&outSR=4326&orderByFields=Response_Date+DESC&resultRecordCount=1000&f=json",
      {
        headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
        cf: { cacheTtl: TTL_S, cacheEverything: true },
      } as RequestInit,
    );
    if (!res.ok) return json({ error: `Minneapolis's gunfire feed returned ${res.status}.` }, 502);
    const body = (await res.json()) as { features?: Feature[]; error?: unknown };
    if (body.error) return json({ error: "Minneapolis's gunfire feed returned an error." }, 502);
    return json({ t: Math.floor(now / 1000), events: gunfireEvents(body.features ?? []) }, 200, `public, max-age=${TTL_S}`);
  } catch {
    return json({ error: "Minneapolis's gunfire feed is unreachable." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
