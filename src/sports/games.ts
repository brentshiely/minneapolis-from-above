/**
 * The five Minnesota pro venues, and a plain-language score for whichever
 * ones have a game in progress right now. The map only ever shows a
 * venue glowing while its team is actually playing — nothing scheduled
 * or finished.
 */
import type { Description } from "../describe.ts";
import type { GameStatus, GamesResponse, Venue } from "../../functions/api/games.ts";

export type { GameStatus, GamesResponse, Venue };

export const VENUES: Record<Venue, { name: string; position: [number, number] }> = {
  twins: { name: "Target Field", position: [-93.2776, 44.9817] },
  vikings: { name: "U.S. Bank Stadium", position: [-93.2575, 44.9736] },
  wolves: { name: "Target Center", position: [-93.276, 44.9795] },
  wild: { name: "Xcel Energy Center", position: [-93.1017, 44.9447] },
  united: { name: "Allianz Field", position: [-93.1657, 44.9531] },
};

export function describeGame(g: GameStatus): Description {
  const venue = VENUES[g.venue].name;
  return {
    title: `${g.team} ${g.ourScore}, ${g.opponent} ${g.oppScore}.`,
    detail: g.detail,
    meta: `${venue} · ${g.home ? "home" : "away"} game`,
  };
}

const PREVIEW: Record<string, GameStatus> = {
  twins: { venue: "twins", team: "Twins", opponent: "Guardians", home: true, ourScore: 3, oppScore: 2, detail: "Top of the 7th" },
  vikings: { venue: "vikings", team: "Vikings", opponent: "Packers", home: true, ourScore: 17, oppScore: 14, detail: "4:05 - 4th Quarter" },
  wolves: { venue: "wolves", team: "Timberwolves", opponent: "Nuggets", home: true, ourScore: 88, oppScore: 91, detail: "6:40 - 4th Quarter" },
  wild: { venue: "wild", team: "Wild", opponent: "Blackhawks", home: true, ourScore: 2, oppScore: 1, detail: "8:12 left in the 3rd period" },
  united: { venue: "united", team: "Minnesota United", opponent: "Sporting KC", home: true, ourScore: 1, oppScore: 1, detail: "67'" },
};

/** `?game=twins` (or vikings, wolves, wild, united) previews a live score without waiting for a real one. */
export function previewGames(spec: string): GamesResponse | undefined {
  const g = PREVIEW[spec.trim().toLowerCase()];
  if (!g) return undefined;
  return { t: Math.floor(Date.now() / 1000), games: [g] };
}
