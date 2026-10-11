import { test } from "node:test";
import assert from "node:assert/strict";
import { fromEsri, fromPhoton, merge, onRequestGet, type Place } from "../functions/api/geocode.ts";

const place = (label: string, kind: Place["kind"], lon = -93.2, lat = 44.9): Place => ({ label, kind, lon, lat, zoom: 15 });

test("fromEsri splits an address into a label and a short detail, and calls it an address", () => {
  const [a] = fromEsri([{ address: "1600 98th St W, Bloomington, Minnesota, 55431", score: 99.8, location: { x: -93.3, y: 44.83 } }]);
  assert.equal(a.label, "1600 98th St W");
  assert.equal(a.detail, "Bloomington, MN 55431");
  assert.equal(a.kind, "address");
  assert.equal(a.zoom, 17);
});

test("fromEsri tells intersections, named places and bare city centers apart, and drops weak matches", () => {
  const out = fromEsri([
    { address: "Lake St W & Hennepin Ave, Minneapolis, Minnesota, 55408", score: 99.8, location: { x: -93.298, y: 44.948 } },
    { address: "Mall of America", score: 100, location: { x: -93.24, y: 44.854 } },
    { address: "Minneapolis", score: 79.13, location: { x: -93.26, y: 44.96 } }, // under the cutoff
    { address: "Bloomington", score: 82, location: { x: -93.31, y: 44.83 } },
    { address: "No point", score: 100 },
  ]);
  assert.deepEqual(out.map((p) => [p.label, p.kind]), [["Lake St W & Hennepin Ave", "intersection"], ["Mall of America", "place"], ["Bloomington", "area"]]);
});

test("fromPhoton: streets, named landmarks, bare addresses and neighborhoods; Wisconsin is dropped", () => {
  const f = (properties: object, c: [number, number] = [-93.27, 44.98]) => ({ properties, geometry: { coordinates: c } });
  const out = fromPhoton([
    f({ name: "Nicollet Mall", type: "street", city: "Minneapolis", state: "Minnesota" }),
    f({ name: "Uptown Pizza", type: "house", housenumber: "1", street: "West Lake Street", city: "Minneapolis", state: "Minnesota" }),
    f({ housenumber: "3035", street: "Poppler Ln", type: "house", city: "Eagan", state: "Minnesota" }),
    f({ name: "Uptown", type: "locality", city: "Minneapolis", state: "Minnesota" }),
    f({ name: "Hudson", type: "city", state: "Wisconsin" }),
    f({ type: "house" }), // nothing to call it
  ]);
  assert.deepEqual(out.map((p) => [p.label, p.kind]), [
    ["Nicollet Mall", "street"], ["Uptown Pizza", "place"], ["3035 Poppler Ln", "address"], ["Uptown", "area"],
  ]);
  assert.equal(out[1].detail, "West Lake Street, Minneapolis");
});

test("merge: an exact name first, then address, intersection, place, street, area", () => {
  const out = merge("uptown",
    [place("Some Cafe", "place"), place("1 Main St", "address", -93.1), place("Lake & Hennepin", "intersection", -93.15)],
    [place("Uptown", "area", -93.3), place("Main", "street", -93.05)],
  );
  assert.deepEqual(out.map((p) => p.label), ["Uptown", "1 Main St", "Lake & Hennepin", "Some Cafe", "Main"]);
});

test("merge counts the same place found by two sources once, and a long street once", () => {
  const out = merge("x",
    [place("Mall of America", "place", -93.2388, 44.8543)],
    [place("Mall of America", "place", -93.2421, 44.8546), place("Nicollet Mall", "street", -93.2686, 44.9812), place("Nicollet Mall", "street", -93.2777, 44.9706)],
  );
  assert.equal(out.filter((p) => p.label === "Mall of America").length, 1);
  assert.equal(out.filter((p) => p.label === "Nicollet Mall").length, 1);
});

test("merge returns at most six", () => {
  const many = Array.from({ length: 20 }, (_, i) => place(`Place ${i}`, "place", -93 + i * 0.01));
  assert.equal(merge("x", many).length, 6);
});

test("handler rejects a missing or too-short query without calling anything", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
  try {
    for (const q of ["", "a", " a ", "x".repeat(121)]) {
      assert.equal((await onRequestGet({ request: new Request(`http://x/api/geocode?q=${encodeURIComponent(q)}`) })).status, 400, JSON.stringify(q));
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("handler merges the sources, caches a full answer for a day, and a partial one for a minute", async () => {
  const realFetch = globalThis.fetch;
  const esri = { candidates: [{ address: "1600 98th St W, Bloomington, Minnesota, 55431", score: 99, location: { x: -93.3, y: 44.83 } }] };
  try {
    globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).includes("photon") ? { features: [] } : esri))) as typeof fetch;
    const full = await onRequestGet({ request: new Request("http://x/api/geocode?q=1600+w+98th+st") });
    assert.equal(full.status, 200);
    assert.match(full.headers.get("cache-control")!, /max-age=86400/);
    assert.equal(((await full.json()) as { results: unknown[] }).results.length, 1, "the same address from both Esri locators is one result");

    globalThis.fetch = (async (url: string) => { if (String(url).includes("photon")) throw new Error("down"); return new Response(JSON.stringify(esri)); }) as typeof fetch;
    const partial = await onRequestGet({ request: new Request("http://x/api/geocode?q=1600+w+98th+st") });
    assert.equal(partial.status, 200, "one source down still answers with the others");
    assert.match(partial.headers.get("cache-control")!, /max-age=60\b/);

    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.equal((await onRequestGet({ request: new Request("http://x/api/geocode?q=anything") })).status, 502);
  } finally { globalThis.fetch = realFetch; }
});
