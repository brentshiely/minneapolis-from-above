/**
 * Cloudflare Pages Function: GET /api/games
 *
 * Whether a Minnesota pro team is playing right now, and the score, from
 * each league's own free scoreboard: MLB's statsapi (Twins), NHL's
 * api-web (Wild), and ESPN's public scoreboard JSON for the rest
 * (Vikings, Timberwolves, Minnesota United) — all answer with an open
 * CORS header already, but proxied here for the same edge-cache and
 * resilience reasons every other feed in this project is. Only games
 * actually in progress are returned; the map has nothing to show for a
 * scheduled or finished game.
 */
const UA = "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)";
const TTL_S = 30;

export type Venue = "twins" | "vikings" | "wolves" | "wild" | "united";

export interface GameStatus {
  venue: Venue;
  team: string;
  opponent: string;
  home: boolean;
  ourScore: number;
  oppScore: number;
  /** Plain-language game state, e.g. "Top of the 7th", "4:05 left in the 2nd". */
  detail: string;
}

export interface GamesResponse {
  /** POSIX seconds this answer was made. */
  t: number;
  games: GameStatus[];
}

const get = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { headers: { "user-agent": UA }, cf: { cacheTtl: TTL_S, cacheEverything: true } } as RequestInit);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

const ORDINAL: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th", 7: "7th", 8: "8th", 9: "9th" };

async function twins(): Promise<GameStatus | undefined> {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - 86_400_000), end = new Date(today.getTime() + 86_400_000);
  const body = await get(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=142&startDate=${fmt(start)}&endDate=${fmt(end)}&hydrate=linescore`) as {
    dates?: { games?: {
      status?: { detailedState?: string };
      teams?: { away?: { team?: { name?: string }; score?: number }; home?: { team?: { name?: string }; score?: number } };
      linescore?: { currentInning?: number; inningState?: string };
    }[] }[];
  };
  for (const d of body.dates ?? []) {
    for (const g of d.games ?? []) {
      if (g.status?.detailedState !== "In Progress") continue;
      const home = g.teams?.home?.team?.name === "Minnesota Twins";
      const us = home ? g.teams?.home : g.teams?.away;
      const opp = home ? g.teams?.away : g.teams?.home;
      if (!us || !opp) continue;
      const inn = g.linescore?.currentInning;
      const detail = inn ? `${g.linescore?.inningState ?? ""} of the ${ORDINAL[inn] ?? `${inn}th`}`.trim() : "In progress";
      return { venue: "twins", team: "Twins", opponent: (opp.team?.name ?? "").replace(/^.* (?=\S+$)/, ""), home, ourScore: us.score ?? 0, oppScore: opp.score ?? 0, detail };
    }
  }
  return undefined;
}

/** ESPN's public scoreboard JSON: same shape for NFL, NBA and MLS. */
async function espn(venue: Venue, team: string, sportPath: string): Promise<GameStatus | undefined> {
  const body = await get(`https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard`) as {
    events?: { competitions?: { status?: { type?: { state?: string; shortDetail?: string } }; competitors?: { team?: { abbreviation?: string; shortDisplayName?: string }; score?: string; homeAway?: string }[] }[] }[];
  };
  for (const e of body.events ?? []) {
    for (const c of e.competitions ?? []) {
      if (c.status?.type?.state !== "in") continue;
      const us = c.competitors?.find((x) => x.team?.abbreviation === "MIN");
      const opp = c.competitors?.find((x) => x.team?.abbreviation !== "MIN");
      if (!us || !opp) continue;
      return {
        venue, team, opponent: opp.team?.shortDisplayName ?? "opponent", home: us.homeAway === "home",
        ourScore: Number(us.score ?? 0), oppScore: Number(opp.score ?? 0), detail: c.status?.type?.shortDetail ?? "In progress",
      };
    }
  }
  return undefined;
}

async function wild(): Promise<GameStatus | undefined> {
  const body = await get("https://api-web.nhle.com/v1/score/now") as {
    games?: { gameState?: string; awayTeam?: { abbrev?: string; commonName?: { default?: string }; score?: number }; homeTeam?: { abbrev?: string; commonName?: { default?: string }; score?: number }; clock?: { timeRemaining?: string; inIntermission?: boolean }; periodDescriptor?: { number?: number; periodType?: string } }[];
  };
  for (const g of body.games ?? []) {
    if (g.gameState !== "LIVE" && g.gameState !== "CRIT") continue;
    const home = g.homeTeam?.abbrev === "MIN";
    const us = home ? g.homeTeam : g.awayTeam;
    const opp = home ? g.awayTeam : g.homeTeam;
    if (us?.abbrev !== "MIN" || !opp) continue;
    const period = g.periodDescriptor?.number;
    const kind = g.periodDescriptor?.periodType === "OT" ? "overtime" : period && period > 3 ? "overtime" : period ? `the ${ORDINAL[period] ?? `${period}th`} period` : undefined;
    const detail = g.clock?.inIntermission ? `Intermission after ${kind ?? "the period"}` : kind ? `${g.clock?.timeRemaining ?? ""} left in ${kind}`.trim() : "In progress";
    return { venue: "wild", team: "Wild", opponent: opp.commonName?.default ?? "opponent", home, ourScore: us.score ?? 0, oppScore: opp.score ?? 0, detail };
  }
  return undefined;
}

export const onRequestGet = async (): Promise<Response> => {
  const results = await Promise.allSettled([
    twins(),
    espn("vikings", "Vikings", "football/nfl"),
    espn("wolves", "Timberwolves", "basketball/nba"),
    espn("united", "Minnesota United", "soccer/usa.1"),
    wild(),
  ]);
  const games = results.filter((r): r is PromiseFulfilledResult<GameStatus | undefined> => r.status === "fulfilled")
    .map((r) => r.value).filter((g): g is GameStatus => !!g);
  const body: GamesResponse = { t: Math.floor(Date.now() / 1000), games };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${TTL_S}` },
  });
};
