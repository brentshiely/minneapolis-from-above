import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, previewWeather, type NwsObservation } from "../src/weather/classify.ts";

const real = JSON.parse(readFileSync(new URL("./fixtures/nws-light-rain.json", import.meta.url), "utf8")).properties;

const obs = (over: Partial<NwsObservation>): NwsObservation => ({
  timestamp: "2026-01-15T18:00:00+00:00",
  textDescription: "",
  temperature: { value: -5 },
  windSpeed: { value: 20 },
  windDirection: { value: 300 },
  visibility: { value: 16093 },
  presentWeather: [],
  cloudLayers: [],
  ...over,
});

test("a real NWS observation: light rain under overcast skies", () => {
  const w = classify(real);
  assert.equal(w.summary, "61°F, light rain");
  assert.equal(w.precip, "rain");
  assert.equal(w.intensity, "light");
  assert.equal(w.cloudCover, 1);
  assert.equal(w.visibilityMi, 9);
  assert.equal(w.windMph, 0, "calm (null wind) reads as 0");
});

test("snow, with wind blowing it the way the wind goes", () => {
  const w = classify(obs({ textDescription: "Heavy Snow", presentWeather: [{ intensity: "heavy", weather: "snow", rawString: "+SN" }] }));
  assert.equal(w.summary, "23°F, heavy snow");
  assert.equal(w.precip, "snow");
  assert.equal(w.windToward, 120, "a northwest wind blows toward the southeast");
  assert.equal(w.windMph, 12);
});

test("mixed precipitation and thunderstorms", () => {
  assert.equal(classify(obs({ textDescription: "Rain and Snow", presentWeather: [{ weather: "rain", rawString: "RA" }, { weather: "snow", rawString: "SN" }] })).summary, "23°F, rain and snow");
  const storm = classify(obs({ temperature: { value: 24 }, textDescription: "Thunderstorm, Heavy Rain", presentWeather: [{ intensity: "heavy", weather: "thunderstorms", rawString: "+TSRA" }] }));
  assert.equal(storm.summary, "75°F, thunderstorms");
  assert.ok(storm.thunder);
  assert.equal(storm.precip, "rain");
});

test("fog, mist and haze come from visibility", () => {
  assert.equal(classify(obs({ textDescription: "Fog", visibility: { value: 400 } })).summary, "23°F, fog");
  assert.equal(classify(obs({ textDescription: "Mist", visibility: { value: 4000 } })).summary, "23°F, misty");
  assert.equal(classify(obs({ textDescription: "Haze", visibility: { value: 4000 } })).summary, "23°F, hazy");
});

test("clouds, from clear to overcast", () => {
  const sky = (amount: string) => classify(obs({ cloudLayers: [{ amount }] })).summary;
  assert.equal(sky("CLR"), "23°F, clear");
  assert.equal(sky("SCT"), "23°F, partly cloudy");
  assert.equal(sky("BKN"), "23°F, mostly cloudy");
  assert.equal(sky("OVC"), "23°F, overcast");
  assert.equal(classify(obs({ cloudLayers: [{ amount: "FEW" }, { amount: "OVC" }] })).cloudCover, 1, "the thickest layer wins");
});

test("missing values don't break the summary", () => {
  const w = classify({ textDescription: "Clear" });
  assert.equal(w.summary, "clear");
  assert.equal(w.tempF, null);
  assert.equal(w.visibilityMi, null);
});

test("previews for testing effects", () => {
  assert.equal(previewWeather("heavy-snow")!.precip, "snow");
  assert.equal(previewWeather("heavy-snow")!.intensity, "heavy");
  assert.ok(previewWeather("storm")!.thunder);
  assert.equal(previewWeather("fog")!.summary, "45°F, fog");
  assert.equal(previewWeather("partly-cloudy")!.cloudCover, 0.45);
  assert.equal(previewWeather(""), undefined);
});
