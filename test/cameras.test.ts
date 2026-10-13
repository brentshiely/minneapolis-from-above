import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describeCamera, parseCameras, snapshotUrl } from "../src/traffic/cameras.ts";

// A trimmed real subset of MnDOT's metro_config.xml.gz: a few cameras that
// should survive filtering (on a numbered highway, located, in the metro),
// and a few that shouldn't (a local street, an unlocated test rig, a bench
// test camera).
const gz = readFileSync(new URL("./fixtures/mndot-config-sample.xml.gz", import.meta.url));

test("parses located cameras on a freeway or highway", () => {
  const cams = parseCameras(new TextDecoder().decode(gunzipSync(gz)));
  assert.deepEqual(
    cams.map((c) => c.name).sort(),
    ["C702", "C908", "C909"],
  );
});

test("drops cameras with no location, off a local street, or off the metro", () => {
  const cams = parseCameras(new TextDecoder().decode(gunzipSync(gz)));
  const names = cams.map((c) => c.name);
  assert.ok(!names.includes("CTEST-Rise4"), "unlocated test rig");
  assert.ok(!names.includes("C700"), "local street, not a highway");
  assert.ok(!names.includes("C701"), "bench test camera");
  assert.ok(!names.includes("D6-C340"), "outside the metro box");
});

test("keeps a camera's exact location", () => {
  const cams = parseCameras(new TextDecoder().decode(gunzipSync(gz)));
  const c909 = cams.find((c) => c.name === "C909")!;
  assert.equal(c909.lon, -93.3652);
  assert.equal(c909.lat, 44.97115);
  assert.equal(c909.description, "I-394 EB @ Hampshire Ave");
});

test("describes a camera in plain language, with its live snapshot", () => {
  const d = describeCamera({ name: "C909", description: "I-394 EB @ Hampshire Ave", lon: -93.3652, lat: 44.97115 }, 12_340_000);
  assert.equal(d.title, "I-394 eastbound at Hampshire Ave.");
  assert.equal(d.meta, "MnDOT traffic camera");
  assert.equal(d.image, "/api/image?cam=C909&t=1234");

  const noCrossStreet = describeCamera({ name: "C1", description: "I-94 WB", lon: 0, lat: 0 });
  assert.equal(noCrossStreet.title, "I-94 westbound.");
});

test("the snapshot URL uses the camera's IRIS name, unencoded characters aside", () => {
  assert.equal(snapshotUrl("C909"), "/api/image?cam=C909");
  assert.equal(snapshotUrl("D6-C340"), "/api/image?cam=D6-C340");
});

test("the baked camera file covers hundreds of freeway cameras", () => {
  const file = JSON.parse(readFileSync(new URL("../public/data/cameras.json", import.meta.url), "utf8"));
  assert.ok(file.cameras.length > 500, `${file.cameras.length} cameras`);
  for (const c of file.cameras.slice(0, 20)) {
    assert.ok(Number.isFinite(c.lon) && Number.isFinite(c.lat));
    assert.ok(c.name);
  }
});
