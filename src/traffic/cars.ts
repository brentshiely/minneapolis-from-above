/**
 * Sparse, synthetic dots gliding along the freeway network, standing in
 * for the real cars MnDOT's sensors can only count, not track. Each
 * stretch spawns dots at a rate scaled down from its real flow, and every
 * dot glides at that stretch's real speed reading -- so the pace and
 * frequency of movement reflect the live data, without drawing anywhere
 * near the real number of vehicles.
 */
import { buildShape, type Shape } from "../transit/data.ts";
import { headingAt, pointAt } from "../live/geometry.ts";
import type { Freeways, Stretch } from "./freeways.ts";
import type { Readings } from "./traffic.ts";

/** One dot stands in for this many real vehicles: keeps the flow readable, never a swarm. */
const CARS_PER_DOT = 220;
/** However heavy the real flow, never more than this many dots gliding on one stretch at once. */
const MAX_PER_STRETCH = 2;

const MPH_TO_MS = 0.44704;

interface Lane {
  shape: Shape;
  station: string;
  /** Seconds until this stretch is due to spawn its next dot; Infinity while it has no reading. */
  countdown: number;
}

interface Car {
  lane: Lane;
  dist: number;
  speedMs: number;
}

export interface CarDot {
  position: [number, number];
  heading: number;
}

/** A memoryless (exponential) interarrival time for a Poisson process at this rate: organic spacing, not a metronome. */
function drawInterval(ratePerSecond: number): number {
  if (!(ratePerSecond > 0)) return Infinity;
  return -Math.log(1 - Math.random()) / ratePerSecond;
}

export class CarFlow {
  private lanes: Lane[];
  private cars: Car[] = [];

  constructor(freeways: Freeways) {
    this.lanes = freeways.stretches.map((s: Stretch, i) => ({
      shape: buildShape(`car-${i}`, s.station, s.path),
      station: s.station,
      countdown: Infinity,
    }));
  }

  /** Spawn, glide and cull every dot by one tick. No-op with nothing to draw from (no readings yet). */
  advance(dtS: number, readings: Readings) {
    this.cars = this.cars.filter((c) => {
      c.dist += c.speedMs * dtS;
      return c.dist < c.lane.shape.length;
    });
    const perLane = new Map<Lane, number>();
    for (const c of this.cars) perLane.set(c.lane, (perLane.get(c.lane) ?? 0) + 1);

    for (const lane of this.lanes) {
      const reading = readings[lane.station];
      const speedMph = reading?.[0], flowVph = reading?.[1];
      if (speedMph == null || !flowVph) { lane.countdown = Infinity; continue; }
      if (lane.countdown === Infinity) lane.countdown = drawInterval(flowVph / 3600 / CARS_PER_DOT);
      lane.countdown -= dtS;
      if (lane.countdown > 0) continue;
      lane.countdown += drawInterval(flowVph / 3600 / CARS_PER_DOT);
      if ((perLane.get(lane) ?? 0) >= MAX_PER_STRETCH) continue;
      this.cars.push({ lane, dist: 0, speedMs: Math.max(2, speedMph * MPH_TO_MS) });
    }
  }

  list(): CarDot[] {
    return this.cars.map((c) => ({
      position: pointAt(c.lane.shape, c.dist),
      heading: headingAt(c.lane.shape, c.dist),
    }));
  }
}
