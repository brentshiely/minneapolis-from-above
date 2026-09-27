import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, toResponse } from "../functions/api/wildlife.ts";
import { describeSighting, FADE_DAYS, previewWildlife, sightingStrength } from "../src/wildlife/sightings.ts";

test("toResponse keeps a usable-license photo, drops one with no license, and skips rows with no coordinates", () => {
  const body = toResponse([
    {
      id: 1, observed_on: "2026-09-27", taxon: { preferred_common_name: "American Toad" }, geojson: { coordinates: [-93.3, 44.9] },
      photos: [{ url: "https://x/photos/1/square.jpg", license_code: "cc-by-nc", attribution: "(c) Sean Ford" }],
    },
    {
      id: 2, observed_on: "2026-09-27", taxon: { preferred_common_name: "Fly Agaric" }, geojson: { coordinates: [-93.35, 44.88] },
      photos: [{ url: "https://x/photos/2/square.jpg", license_code: null, attribution: "(c) someone" }],
    },
    { id: 3, observed_on: "2026-09-27", taxon: { name: "No Coords" } },
  ]);
  assert.equal(body.sightings.length, 2);
  const toad = body.sightings.find((s) => s.id === 1)!;
  assert.equal(toad.species, "American Toad");
  assert.equal(toad.photo?.url, "https://x/photos/1/medium.jpg");
  const mushroom = body.sightings.find((s) => s.id === 2)!;
  assert.equal(mushroom.species, "Fly Agaric");
  assert.equal(mushroom.photo, undefined);
});

test("toResponse falls back to the scientific name when there's no common name", () => {
  const body = toResponse([{ id: 1, observed_on: "2026-09-27", taxon: { name: "Anaxyrus americanus" }, geojson: { coordinates: [0, 0] } }]);
  assert.equal(body.sightings[0].species, "Anaxyrus americanus");
});

test("handler returns JSON with a cache header, and a clear 502 when upstream fails", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ results: [] }))) as typeof fetch;
    const ok = await onRequestGet();
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control")!, /max-age=900/);

    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);

    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- client: fading and phrasing ----------------------------------------------

test("sightingStrength is full when just seen, fades linearly, and bottoms out at 0", () => {
  const s = { id: 1, species: "Fox", observedAt: 0, position: [0, 0] as [number, number] };
  assert.equal(sightingStrength(s, 0), 1);
  assert.ok(sightingStrength(s, FADE_DAYS * 86_400 * 0.5) < 1);
  assert.equal(sightingStrength(s, FADE_DAYS * 86_400 * 2), 0);
});

test("describeSighting reads plainly and carries the photo through as the image", () => {
  const d = describeSighting({ id: 1, species: "Red Fox", observedAt: 0, position: [0, 0], photo: { url: "https://x/photo.jpg", attribution: "me" } }, 3600);
  assert.equal(d.title, "Red Fox.");
  assert.match(d.detail!, /Seen /);
  assert.equal(d.image, "https://x/photo.jpg");
});

test("previewWildlife serves a recent sighting for the known spec and nothing else", () => {
  const body = previewWildlife("recent");
  assert.ok(body);
  assert.equal(body!.sightings.length, 1);
  assert.equal(previewWildlife("not-a-real-spec"), undefined);
  assert.equal(previewWildlife(""), undefined);
});
