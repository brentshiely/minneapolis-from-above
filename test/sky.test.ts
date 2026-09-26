import { test } from "node:test";
import assert from "node:assert/strict";
import { blendPair, mixColor } from "../src/color.ts";
import { planeColor, vehicleColor, routeColor } from "../src/palette.ts";
import { skyClock } from "../src/sky.ts";
import type { RouteInfo } from "../src/transit/data.ts";

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};

test("color blending hits both ends and the middle", () => {
  assert.equal(mixColor("#000000", "#ffffff", 0), "#000000");
  assert.equal(mixColor("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mixColor("#000000", "#ffffff", 0.5), "#808080");
});

test("the base map passes through a blue hour, not grey", () => {
  const mid = blendPair(["#070b10", "#eceee9"], 0.42) as string;
  const n = parseInt(mid.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  assert.ok(b > r + 20, `blue hour should be blue, got ${mid}`);
  assert.equal(blendPair(["#070b10", "#eceee9"], 0), "#070b10");
  assert.equal(blendPair(["#070b10", "#eceee9"], 1), "#eceee9");
  assert.equal(blendPair([0.6, 1], 0.5), 0.8, "numbers blend linearly");
});

const bus: RouteInfo = { name: "21", long: "", mode: "bus", color: "#771473", sort: 0 };
const blue: RouteInfo = { name: "Blue Line", long: "", mode: "rail", color: "#00539F", sort: 0 };

test("vehicles are light at night and dark by day, so they stand out on each map", () => {
  const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  assert.ok(luminance(hex(vehicleColor(bus, 0))) > 0.7, "night bus glows");
  assert.ok(luminance(hex(vehicleColor(bus, 1))) < 0.5, "day bus is ink");
  assert.ok(luminance(hex(vehicleColor(blue, 1))) < luminance(hex(vehicleColor(blue, 0))));
  assert.ok(luminance(hex(routeColor(bus, 1))) < 0.6);
});

test("planes stay pale through most of dawn, then turn dark", () => {
  const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  assert.ok(luminance(hex(planeColor(0.5))) > 0.8, "still pale at mid-dusk");
  assert.ok(luminance(hex(planeColor(1))) < 0.25, "dark by day");
});

test("?at=HH:MM starts the sky clock at that Minneapolis time, and it keeps running", () => {
  const clock = skyClock("?at=13:30");
  const t = clock();
  const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
  assert.equal(local, "13:30");
  const real = skyClock("");
  assert.ok(Math.abs(real().getTime() - Date.now()) < 50);
  assert.ok(Math.abs(skyClock("?at=nonsense")().getTime() - Date.now()) < 50, "bad values fall back to now");
});
