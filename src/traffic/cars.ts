/**
 * Synthetic vehicles on every measured freeway, at the real traffic volume.
 * MnDOT's sensors report each station's average speed and flow per lane
 * every 30 seconds but never track individual cars, so positions are made
 * up -- the numbers are not:
 *
 *   vehicles per second = flow (veh/hr/lane) x lanes / 3600
 *
 * e.g. 3 lanes at 1,200 veh/hr/lane is 3,600 veh/hr: 1 car a second, 60 a
 * minute, in that direction. Each stretch spawns cars at that rate as a
 * Poisson process (organic spacing, never a metronome) and glides each at
 * the stretch's real speed, so the density on screen is flow / speed --
 * sparse when free, packed and crawling when stop-and-go.
 */
import { buildShape, type Shape } from "../transit/data.ts";
import type { Freeways, Stretch } from "./freeways.ts";
import type { Readings } from "./traffic.ts";

const MPH_TO_MS = 0.44704;
/** Slowest a car is drawn crawling, so a dead-stopped sensor doesn't pin cars (and their count) forever. */
const MIN_SPEED_MS = 2;
/** Each car drives a little faster or slower than the stretch's average. */
const SPEED_SPREAD = 0.06;
/** A hard ceiling on cars drawn at once, so a bad reading can never swamp the frame. */
const MAX_CARS = 60_000;
/** Longest single step simulated at once: a tab returning from the background must not spawn a flood. */
const MAX_STEP_S = 2;
/** When a station's lane count is missing, assume this many. */
const DEFAULT_LANES = 2;

/** Real vehicles per second passing a station, in its direction of travel. */
export function vehiclesPerSecond(flowPerLane: number, lanes: number): number {
  return (flowPerLane * (lanes || DEFAULT_LANES)) / 3600;
}

interface Lane {
  shape: Shape;
  station: string;
  lanes: number;
  /** Seconds until this stretch spawns its next car; Infinity while it has no reading. */
  countdown: number;
  /** Whether the stretch has been populated with the cars already on it. */
  seeded: boolean;
}

interface Car {
  lane: Lane;
  dist: number;
  speedMs: number;
  /** Segment of the lane's shape the car is on; only ever moves forward. */
  seg: number;
}

export interface CarDot {
  position: [number, number];
}

/** A memoryless (exponential) interarrival time for a Poisson process at this rate: organic spacing, not a metronome. */
function drawInterval(ratePerSecond: number): number {
  if (!(ratePerSecond > 0)) return Infinity;
  return -Math.log(1 - Math.random()) / ratePerSecond;
}

/** A Poisson draw: exact for small means, the normal approximation for large ones. */
function poisson(mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 30) {
    const u = 1 - Math.random(), v = Math.random();
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
  }
  const limit = Math.exp(-mean);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > limit);
  return k - 1;
}

const jitter = () => 1 + (Math.random() * 2 - 1) * SPEED_SPREAD;

export class CarFlow {
  private lanes: Lane[];
  private cars: Car[] = [];
  /** Two buffers swapped every tick, so the GPU upload always sees a new array. */
  private buffers: [Float32Array, Float32Array] = [new Float32Array(0), new Float32Array(0)];
  private front = 0;
  /** Flat [lon, lat, lon, lat, ...] for the cars drawn this tick; read `count` pairs. */
  positions: Float32Array = this.buffers[0];
  count = 0;

  constructor(freeways: Freeways) {
    this.lanes = freeways.stretches.map((s: Stretch, i) => ({
      shape: buildShape(`car-${i}`, s.station, s.path),
      station: s.station,
      lanes: freeways.stations[s.station]?.lanes ?? 0,
      countdown: Infinity,
      seeded: false,
    }));
  }

  /** Spawn, glide and cull every car by one tick. No-op with nothing to draw from (no readings yet). */
  advance(dtS: number, readings: Readings) {
    dtS = Math.min(dtS, MAX_STEP_S);
    const cars = this.cars;
    let n = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      c.dist += c.speedMs * dtS;
      if (c.dist < c.lane.shape.length) cars[n++] = c;
    }
    cars.length = n;

    for (const lane of this.lanes) {
      const reading = readings[lane.station];
      const speedMph = reading?.[0], flowVph = reading?.[1];
      if (speedMph == null || !flowVph) { lane.countdown = Infinity; continue; }
      const speedMs = Math.max(MIN_SPEED_MS, speedMph * MPH_TO_MS);
      const rate = vehiclesPerSecond(flowVph, lane.lanes);
      if (cars.length >= MAX_CARS) continue;

      if (!lane.seeded) {
        // First reading: the road is already full of traffic, not empty.
        lane.seeded = true;
        const here = poisson((rate * lane.shape.length) / speedMs);
        for (let k = 0; k < here; k++) cars.push({ lane, dist: Math.random() * lane.shape.length, speedMs: speedMs * jitter(), seg: 0 });
      }
      if (lane.countdown === Infinity) lane.countdown = drawInterval(rate);
      lane.countdown -= dtS;
      while (lane.countdown <= 0 && cars.length < MAX_CARS) {
        // Enter partway into this tick, as if arriving the moment the countdown ran out.
        const s = speedMs * jitter();
        cars.push({ lane, dist: -lane.countdown * s, speedMs: s, seg: 0 });
        lane.countdown += drawInterval(rate);
      }
    }
    this.fill();
  }

  /** Write every car's position into the spare buffer and swap it to the front. */
  private fill() {
    const need = this.cars.length * 2;
    const back = 1 - this.front;
    if (this.buffers[back].length < need) this.buffers[back] = new Float32Array(Math.max(need, this.buffers[back].length * 2, 1024));
    const out = this.buffers[back];
    let o = 0;
    for (const c of this.cars) {
      const { path, cum, length } = c.lane.shape;
      const d = c.dist < 0 ? 0 : c.dist > length ? length : c.dist;
      let i = c.seg;
      while (i < path.length - 2 && cum[i + 1] <= d) i++;
      c.seg = i;
      const span = cum[i + 1] - cum[i];
      const t = span > 0 ? (d - cum[i]) / span : 0;
      const a = path[i], b = path[i + 1];
      out[o++] = a[0] + (b[0] - a[0]) * t;
      out[o++] = a[1] + (b[1] - a[1]) * t;
    }
    this.front = back;
    this.positions = out;
    this.count = this.cars.length;
  }

  list(): CarDot[] {
    const out: CarDot[] = [];
    for (let i = 0; i < this.count; i++) out.push({ position: [this.positions[2 * i], this.positions[2 * i + 1]] });
    return out;
  }
}
