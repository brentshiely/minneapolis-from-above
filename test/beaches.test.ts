import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, toResponse } from "../functions/api/beaches.ts";
import { describeBeach, previewBeaches } from "../src/water/beaches.ts";

test("toResponse keeps only beaches actually in season (open or closed), and slugs an id", () => {
  const body = toResponse([
    { attributes: { Beach: "Main Beach", Lake: "Lake Nokomis", Water_Quality_Status: "Open" }, geometry: { x: -93.24, y: 44.9 } },
    { attributes: { Beach: "East Beach", Secondary_name: "Hidden Beach", Lake: "Cedar Lake", Water_Quality_Status: "Closed", Reason: "High E. coli" }, geometry: { x: -93.3, y: 44.96 } },
    { attributes: { Beach: "Wirth Beach", Lake: "Wirth Lake", Water_Quality_Status: "Testing_Done_for_Season" }, geometry: { x: -93.3, y: 44.98 } },
    { attributes: { Beach: "No Geometry Beach", Lake: "Lake X", Water_Quality_Status: "Open" } },
  ]);
  assert.equal(body.beaches.length, 2);
  const main = body.beaches.find((b) => b.id === "lake-nokomis-main-beach")!;
  assert.ok(main, "expected a slugged id for Main Beach / Lake Nokomis");
  assert.equal(main.status, "open");
  const east = body.beaches.find((b) => b.name.includes("Hidden Beach"))!;
  assert.equal(east.name, "East Beach (Hidden Beach)");
  assert.equal(east.status, "closed");
  assert.equal(east.reason, "High E. coli");
});

test("handler returns JSON with a cache header, and a clear 502 when upstream fails", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      features: [{ attributes: { Beach: "Main Beach", Lake: "Lake Nokomis", Water_Quality_Status: "Open" }, geometry: { x: -93.24, y: 44.9 } }],
    }))) as typeof fetch;
    const ok = await onRequestGet();
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control")!, /max-age=600/);
    const body = await ok.json() as { beaches: unknown[] };
    assert.equal(body.beaches.length, 1);

    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);

    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("describeBeach reads plainly for both an open and a closed beach", () => {
  const open = describeBeach({ id: "a", name: "Main Beach", lake: "Lake Nokomis", status: "open", position: [0, 0] });
  assert.equal(open.title, "Main Beach, Lake Nokomis.");
  assert.equal(open.detail, "Open for swimming.");

  const closed = describeBeach({ id: "b", name: "32nd Street Beach", lake: "Bde Maka Ska", status: "closed", reason: "High E. coli", position: [0, 0] });
  assert.equal(closed.detail, "Closed: High E. coli.");

  const closedNoReason = describeBeach({ id: "c", name: "Thomas Beach", lake: "Bde Maka Ska", status: "closed", position: [0, 0] });
  assert.equal(closedNoReason.detail, "Closed.");
});

test("previewBeaches serves open and closed and nothing for an unknown spec", () => {
  assert.equal(previewBeaches("open")!.beaches[0].status, "open");
  assert.equal(previewBeaches("closed")!.beaches[0].status, "closed");
  assert.equal(previewBeaches("not-a-real-status"), undefined);
  assert.equal(previewBeaches(""), undefined);
});
