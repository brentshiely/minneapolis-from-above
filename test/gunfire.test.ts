import { test } from "node:test";
import assert from "node:assert/strict";
import { gunfireEvents, labelFor, onRequestGet } from "../functions/api/gunfire.ts";
import { describeGunfire, FADE_DAYS, gunfireStrength } from "../src/gunfire/gunfire.ts";

const row = (o: Partial<{ id: number; num: string; problem: string; at: number; division: string; x: number; y: number }> = {}) => ({
  attributes: { OBJECTID: o.id ?? 1, Master_Incident_Number: o.num ?? "26-100", Problem: o.problem ?? "Sound of Shots Fired (P)", Response_Date: o.at ?? 1_700_000_000_000, Division: o.division ?? "Precinct 4" },
  geometry: { x: o.x ?? -93.30067798, y: o.y ?? 44.99520997 },
});

test("labelFor puts each dispatch problem in plain words", () => {
  assert.equal(labelFor("Sound of Shots Fired (P)"), "Shots fired reported");
  assert.equal(labelFor("ShotSpotter Activation (P)"), "ShotSpotter detected gunfire");
  assert.equal(labelFor("Shooting Report Only (P)"), "Shooting reported");
  assert.equal(labelFor("Shooting (PFE)"), "Shooting");
  assert.equal(labelFor("Gunshot Wound (P1)"), "Gunshot Wound", "a new type keeps its wording, minus the priority code");
});

test("gunfireEvents keeps complete rows, drops incomplete ones, and masks the point to a block", () => {
  const out = gunfireEvents([
    row(),
    { attributes: { OBJECTID: 2, Master_Incident_Number: "26-101", Problem: "Shooting (PFE)", Response_Date: 0 } }, // no point
    { ...row({ id: 3 }), attributes: { OBJECTID: 3, Problem: "Shooting (PFE)", Response_Date: 0 } }, // no incident number
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Shots fired reported");
  assert.equal(out[0].precinct, "Precinct 4");
  assert.equal(out[0].reportedAt, 1_700_000_000);
  assert.notDeepEqual(out[0].position, [-93.30067798, 44.99520997]);
  assert.ok(Math.abs(out[0].position[0] + 93.30067798) <= 0.001 && Math.abs(out[0].position[1] - 44.99520997) <= 0.001);
});

test("a call outside any precinct has no precinct", () => {
  assert.equal(gunfireEvents([row({ division: "Out of Jurisdiction" })])[0].precinct, undefined);
  assert.equal(gunfireEvents([row({ division: "Precinct 4 North PSA" })])[0].precinct, "Precinct 4", "PSA suffix is dropped");
});

test("ids are unique per row even if an incident number repeats", () => {
  const [a, b] = gunfireEvents([row({ id: 1 }), row({ id: 2 })]);
  assert.notEqual(a.id, b.id);
});

test("strength fades from 1 to 0 over the fade window and never goes negative", () => {
  const e = gunfireEvents([row({ at: 0 })])[0];
  assert.equal(gunfireStrength(e, 0), 1);
  assert.ok(Math.abs(gunfireStrength(e, (FADE_DAYS / 2) * 86_400) - 0.5) < 1e-9);
  assert.equal(gunfireStrength(e, FADE_DAYS * 86_400), 0);
  assert.equal(gunfireStrength(e, 9 * 86_400), 0);
});

test("describeGunfire names the kind of call, the precinct and how long ago", () => {
  const e = gunfireEvents([row({ at: 0 })])[0];
  const d = describeGunfire(e, 3 * 3600);
  assert.equal(d.title, "Shots fired reported, Precinct 4.");
  assert.match(d.detail!, /Reported 3 hours ago in Minneapolis/);
  assert.match(d.meta, /approximate/);
});

test("handler returns events with a half-hour cache, and a clear error when Minneapolis is down", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ features: [row()] }))) as typeof fetch;
    const ok = await onRequestGet();
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control")!, /max-age=1800/);
    assert.equal(((await ok.json()) as { events: unknown[] }).events.length, 1);

    globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: 400 } }))) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502, "an Esri error body is a failure, not an empty map");
  } finally {
    globalThis.fetch = realFetch;
  }
});
