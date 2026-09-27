import { ScatterplotLayer } from "@deck.gl/layers";
import type { GameStatus } from "../sports/games.ts";
import { VENUES } from "../sports/games.ts";
import { FINGER } from "./hover.ts";

export interface GamesFrame {
  games: GameStatus[];
  /** Page-clock seconds, for the glow's gentle pulse. */
  now: number;
}

/** A soft glow (and a generous hit area) at each venue currently playing a game. Empty on an ordinary day. */
export function gamesLayers(f: GamesFrame) {
  if (!f.games.length) return [];
  const pulse = 0.65 + 0.35 * Math.sin(f.now * 1.6);
  const data = f.games.map((g) => ({ ...g, position: VENUES[g.venue].position }));
  return [
    new ScatterplotLayer<GameStatus & { position: [number, number] }>({
      id: "games-glow",
      data,
      getPosition: (g) => g.position,
      getFillColor: [232, 122, 64, Math.round(90 * pulse)],
      getLineColor: [232, 150, 90, Math.round(160 * pulse)],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.5,
      getRadius: 22,
      radiusUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getFillColor: pulse, getLineColor: pulse },
    }),
    new ScatterplotLayer<GameStatus & { position: [number, number] }>({
      id: "pick-games",
      data,
      pickable: true,
      getPosition: (g) => g.position,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 16 * FINGER,
      parameters: { depthCompare: "always" },
    }),
  ];
}
