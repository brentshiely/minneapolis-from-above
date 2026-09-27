import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/games.ts";
import { describeGame, previewGames, VENUES } from "../src/sports/games.ts";

test("every venue has a name and a position inside the metro", () => {
  for (const v of Object.values(VENUES)) {
    assert.ok(v.name.length > 0);
    const [lon, lat] = v.position;
    assert.ok(lon > -94 && lon < -92.5, `${v.name} lon out of range`);
    assert.ok(lat > 44.5 && lat < 45.3, `${v.name} lat out of range`);
  }
});

test("describeGame reads as a plain score line with the venue and home/away in the meta", () => {
  const d = describeGame({ venue: "twins", team: "Twins", opponent: "Guardians", home: true, ourScore: 3, oppScore: 2, detail: "Top of the 7th" });
  assert.equal(d.title, "Twins 3, Guardians 2.");
  assert.equal(d.detail, "Top of the 7th");
  assert.equal(d.meta, "Target Field · home game");
});

test("previewGames serves each known venue and nothing for an unknown spec", () => {
  for (const key of ["twins", "vikings", "wolves", "wild", "united"]) {
    const body = previewGames(key);
    assert.ok(body, key);
    assert.equal(body!.games[0].venue, key);
  }
  assert.equal(previewGames("not-a-real-team"), undefined);
  assert.equal(previewGames(""), undefined);
});

test("handler tolerates every upstream failing at once (each league is fetched independently)", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    const res = await onRequestGet();
    assert.equal(res.status, 200);
    const body = await res.json() as { games: unknown[] };
    assert.deepEqual(body.games, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("handler surfaces a live MLB game and ignores a pre-game one", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes("statsapi.mlb.com")) {
        return new Response(JSON.stringify({
          dates: [{ games: [{
            status: { detailedState: "In Progress" },
            teams: { home: { team: { name: "Minnesota Twins" }, score: 3 }, away: { team: { name: "Cleveland Guardians" }, score: 2 } },
            linescore: { currentInning: 7, inningState: "Top" },
          }] }],
        }), { status: 200 });
      }
      // Every other league: no games in progress.
      if (u.includes("api-web.nhle.com")) return new Response(JSON.stringify({ games: [] }), { status: 200 });
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    }) as typeof fetch;
    const res = await onRequestGet();
    const body = await res.json() as { games: { venue: string; ourScore: number; oppScore: number; detail: string }[] };
    assert.equal(body.games.length, 1);
    assert.equal(body.games[0].venue, "twins");
    assert.equal(body.games[0].ourScore, 3);
    assert.equal(body.games[0].oppScore, 2);
    assert.equal(body.games[0].detail, "Top of the 7th");
  } finally {
    globalThis.fetch = realFetch;
  }
});
