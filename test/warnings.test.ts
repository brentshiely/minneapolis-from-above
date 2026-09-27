import { test } from "node:test";
import assert from "node:assert/strict";
import { toResponse, type Geometry } from "../functions/api/warnings.ts";
import { describeWarning, legend, pulse, rgbCss, severityRank, warningColor, previewWarning, type Warning } from "../src/weather/warnings.ts";

// --- server: filtering and zone resolution -----------------------------------

const METRO_POLYGON: Geometry = {
  type: "Polygon",
  coordinates: [[[-93.4, 44.9], [-93.1, 44.9], [-93.1, 45.1], [-93.4, 45.1], [-93.4, 44.9]]],
};
const FAR_NORTH_POLYGON: Geometry = {
  type: "Polygon",
  coordinates: [[[-95.0, 47.0], [-94.8, 47.0], [-94.8, 47.2], [-95.0, 47.2], [-95.0, 47.0]]],
};

test("a convective warning with its own polygon over the metro is kept", async () => {
  const body = await toResponse([
    { id: "a1", geometry: METRO_POLYGON, properties: { event: "Tornado Warning", severity: "Extreme", headline: "Take shelter now.", expires: "2026-01-01T00:00:00Z" } },
  ]);
  assert.equal(body.w.length, 1);
  assert.equal(body.w[0].event, "Tornado Warning");
  assert.equal(body.w[0].geometry, METRO_POLYGON);
});

test("a polygon warning far outside the metro is dropped", async () => {
  const body = await toResponse([
    { id: "a2", geometry: FAR_NORTH_POLYGON, properties: { event: "Tornado Warning", severity: "Extreme", headline: "Far north.", expires: "2026-01-01T00:00:00Z" } },
  ]);
  assert.equal(body.w.length, 0);
});

test("a zone-based alert (no geometry) resolves to its metro zones' boundaries", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("MNZ060")) return new Response(JSON.stringify({ geometry: METRO_POLYGON }), { status: 200 });
      throw new Error("unexpected zone fetch: " + url);
    }) as typeof fetch;
    const body = await toResponse([
      {
        id: "a3", geometry: null,
        properties: {
          event: "Winter Storm Warning", severity: "Moderate", headline: "8 to 12 inches expected.",
          expires: "2026-01-01T00:00:00Z",
          affectedZones: ["https://api.weather.gov/zones/forecast/MNZ060", "https://api.weather.gov/zones/forecast/MNZ091"],
        },
      },
    ]);
    assert.equal(body.w.length, 1, "only the metro zone (MNZ060) resolves; MNZ091 isn't in the metro list");
    assert.equal(body.w[0].event, "Winter Storm Warning");
    assert.deepEqual(body.w[0].geometry, METRO_POLYGON);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a zone-based alert entirely outside the metro is dropped with no zone fetch", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error("should not fetch any zone"); }) as typeof fetch;
    const body = await toResponse([
      {
        id: "a4", geometry: null,
        properties: {
          event: "Heat Advisory", severity: "Minor", headline: "Hot in the north woods.",
          expires: "2026-01-01T00:00:00Z",
          affectedZones: ["https://api.weather.gov/zones/forecast/MNZ091"],
        },
      },
    ]);
    assert.equal(body.w.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a failed zone lookup is skipped, not a thrown error", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    const body = await toResponse([
      {
        id: "a5", geometry: null,
        properties: {
          event: "Winter Weather Advisory", severity: "Minor", headline: "A few inches.",
          expires: "2026-01-01T00:00:00Z",
          affectedZones: ["https://api.weather.gov/zones/forecast/MNZ060"],
        },
      },
    ]);
    assert.equal(body.w.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- client: color, severity, legend, pulse, hover text ----------------------

test("known event types get their own color; an unlisted one still gets a fallback", () => {
  assert.deepEqual(warningColor("Tornado Warning"), [255, 0, 0]);
  assert.deepEqual(warningColor("Some New Alert Type NWS Just Invented"), [230, 180, 90]);
});

test("rgbCss renders a valid CSS color function", () => {
  assert.equal(rgbCss([255, 0, 0]), "rgb(255, 0, 0)");
});

test("severity ranks Extreme ahead of Severe ahead of Minor, unknowns last", () => {
  assert.ok(severityRank("Extreme") < severityRank("Severe"));
  assert.ok(severityRank("Severe") < severityRank("Moderate"));
  assert.ok(severityRank("Moderate") < severityRank("Minor"));
  assert.ok(severityRank("Minor") < severityRank("something NWS never sends"));
});

test("pulse breathes between roughly 0.44 and 1, never fully off", () => {
  const samples = Array.from({ length: 200 }, (_, i) => pulse(i * 0.1));
  assert.ok(Math.min(...samples) > 0.4 && Math.min(...samples) < 0.5);
  assert.ok(Math.max(...samples) > 0.95 && Math.max(...samples) <= 1.0001);
});

const w = (event: string, severity: string): Warning => ({ id: `${event}-${severity}`, event, severity, headline: `${event} headline`, expires: 0, geometry: { type: "Polygon", coordinates: [] } });

test("legend lists each distinct event type once, most severe first", () => {
  const items = legend([w("Winter Weather Advisory", "Minor"), w("Tornado Warning", "Extreme"), w("Tornado Warning", "Extreme"), w("Severe Thunderstorm Warning", "Severe")]);
  assert.deepEqual(items.map((i) => i.event), ["Tornado Warning", "Severe Thunderstorm Warning", "Winter Weather Advisory"]);
});

test("legend is empty when nothing is active", () => {
  assert.deepEqual(legend([]), []);
});

test("describeWarning uses the headline as the plain-language detail", () => {
  const d = describeWarning(w("Tornado Warning", "Extreme"));
  assert.equal(d.title, "Tornado Warning.");
  assert.equal(d.detail, "Tornado Warning headline");
  assert.match(d.meta, /National Weather Service/);
});

test("previewWarning serves a synthetic snapshot for known specs and nothing for unknown ones", () => {
  const tornado = previewWarning("tornado");
  assert.ok(tornado);
  assert.equal(tornado!.w[0].event, "Tornado Warning");
  assert.equal(previewWarning("not-a-real-preset"), undefined);
  assert.equal(previewWarning(""), undefined);
});
