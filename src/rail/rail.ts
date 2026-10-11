import { buildShape, decodePolyline, type Shape } from "../transit/data.ts";
import { dataUrl } from "../dataurl.ts";

/**
 * Baked by scripts/build-rail.mjs into public/data/rail.json: each active
 * Minnesota railroad line, with the trains a day on it (both directions,
 * as the operating railroad reported them to the Federal Railroad
 * Administration) and its top speed in mph.
 */
interface RailFile {
  lines: { rr: string; tpd: number; mph: number; len: number; line: string }[];
}

export interface RailLine {
  /** The operating railroad's reporting mark: BNSF, SOO (Canadian Pacific), UP, DME... */
  rr: string;
  trainsPerDay: number;
  topSpeedMph: number;
  shape: Shape;
}

export async function loadRail(url = dataUrl("rail.json")): Promise<RailLine[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load rail lines (${res.status}). Run: node scripts/build-rail.mjs`);
  return parseRail(await res.json());
}

export function parseRail(file: RailFile): RailLine[] {
  return file.lines.map((l, i) => ({
    rr: l.rr,
    trainsPerDay: l.tpd,
    topSpeedMph: l.mph,
    shape: buildShape(`rail-${i}`, l.rr, decodePolyline(l.line)),
  }));
}

const MPH_TO_MS = 0.44704;
/** Freight rarely runs at the posted top speed, and crawls through towns and yards. */
const SPEED_FRACTION = 0.7;
const MAX_SPEED_MS = 22;
const MIN_SPEED_MS = 5;
/** A freight train is about a mile long; they vary a good deal. */
const LENGTH_RANGE_M: [number, number] = [600, 1700];
/** Longest single step simulated at once: a tab returning from the background must not spawn a flood. */
const MAX_STEP_S = 2;
const MAX_TRAINS = 600;

/** How fast freight really runs on a line with this posted top speed. */
export function runSpeedMs(topSpeedMph: number): number {
  return Math.min(MAX_SPEED_MS, Math.max(MIN_SPEED_MS, topSpeedMph * SPEED_FRACTION * MPH_TO_MS));
}

/** Trains per second entering a line in one direction: half the day's trains each way. */
export function trainsPerSecond(trainsPerDay: number): number {
  return trainsPerDay / 2 / 86_400;
}

interface Track {
  line: RailLine;
  /** 1 runs along the line as drawn, -1 against it. */
  dir: 1 | -1;
  speedMs: number;
  countdown: number;
}

interface Train {
  track: Track;
  /** Distance of the front from the track's entry end; negative while it is still arriving. */
  head: number;
  length: number;
  speedMs: number;
}

/** A memoryless (exponential) wait for a process at this rate: organic spacing, not a timetable. */
function drawInterval(ratePerSecond: number): number {
  if (!(ratePerSecond > 0)) return Infinity;
  return -Math.log(1 - Math.random()) / ratePerSecond;
}

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

const randomLength = () => LENGTH_RANGE_M[0] + Math.random() * (LENGTH_RANGE_M[1] - LENGTH_RANGE_M[0]);

/** A point `d` meters along the shape's path in its drawn direction. */
function pointAt(shape: Shape, d: number): [number, number] {
  const { path, cum } = shape;
  let lo = 0, hi = path.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid - 1;
  }
  const span = cum[lo + 1] - cum[lo];
  const t = span > 0 ? Math.min(1, Math.max(0, (d - cum[lo]) / span)) : 0;
  return [path[lo][0] + (path[lo + 1][0] - path[lo][0]) * t, path[lo][1] + (path[lo + 1][1] - path[lo][1]) * t];
}

/** The stretch of the shape between two distances along it, in drawn order. */
export function slice(shape: Shape, from: number, to: number): [number, number][] {
  const a = Math.max(0, Math.min(from, to)), b = Math.min(shape.length, Math.max(from, to));
  if (b <= a) return [];
  const out: [number, number][] = [pointAt(shape, a)];
  for (let i = 0; i < shape.path.length; i++) if (shape.cum[i] > a && shape.cum[i] < b) out.push(shape.path[i]);
  out.push(pointAt(shape, b));
  return out;
}

export interface TrainShape {
  /** Tail to head: the head is the last point. */
  path: [number, number][];
  line: RailLine;
}

/**
 * Synthetic freight trains on every reported line, at the real frequency.
 * Railroads don't publish where their trains are, but they do report how
 * many run on each line a day. Each direction of a line spawns trains at
 * half that rate, as a Poisson process (never a metronome), and runs them
 * end to end at a plausible freight speed. It's an average day, not today's
 * schedule: the numbers are real, the positions are made up.
 */
export class TrainFlow {
  readonly lines: RailLine[];
  private tracks: Track[] = [];
  private trains: Train[] = [];
  /** The trains on the map this tick, tail to head. */
  shapes: TrainShape[] = [];

  constructor(lines: RailLine[]) {
    this.lines = lines;
    for (const line of lines) {
      if (!(line.trainsPerDay > 0) || line.shape.length < 100) continue;
      const speedMs = runSpeedMs(line.topSpeedMph);
      const rate = trainsPerSecond(line.trainsPerDay);
      for (const dir of [1, -1] as const) {
        const track: Track = { line, dir, speedMs, countdown: drawInterval(rate) };
        this.tracks.push(track);
        // The line is not empty at the start: place the trains already on it, tail still arriving or head already leaving.
        const here = poisson((rate * (line.shape.length + LENGTH_RANGE_M[1])) / speedMs);
        for (let k = 0; k < here; k++) {
          const length = randomLength();
          // Uniform along the line from just entering to just leaving; any whose tail has already cleared are dropped on the first tick.
          this.trains.push({ track, head: Math.random() * (line.shape.length + length), length, speedMs: speedMs * (0.9 + Math.random() * 0.2) });
        }
      }
    }
    this.fill();
  }

  advance(dtS: number) {
    dtS = Math.min(dtS, MAX_STEP_S);
    let n = 0;
    const trains = this.trains;
    for (let i = 0; i < trains.length; i++) {
      const t = trains[i];
      t.head += t.speedMs * dtS;
      // Gone once the tail has cleared the end of the line.
      if (t.head - t.length < t.track.line.shape.length) trains[n++] = t;
    }
    trains.length = n;
    for (const track of this.tracks) {
      if (trains.length >= MAX_TRAINS) break;
      track.countdown -= dtS;
      while (track.countdown <= 0 && trains.length < MAX_TRAINS) {
        const speedMs = track.speedMs * (0.9 + Math.random() * 0.2);
        trains.push({ track, head: -track.countdown * speedMs, length: randomLength(), speedMs });
        track.countdown += drawInterval(trainsPerSecond(track.line.trainsPerDay));
      }
    }
    this.fill();
  }

  private fill() {
    this.shapes = [];
    for (const t of this.trains) {
      const { shape } = t.track.line;
      const tail = t.head - t.length;
      // Entering or leaving: only the part still on the line is drawn.
      const path = slice(shape, t.track.dir === 1 ? tail : shape.length - t.head, t.track.dir === 1 ? t.head : shape.length - tail);
      if (path.length < 2) continue;
      this.shapes.push({ path: t.track.dir === 1 ? path : path.reverse(), line: t.track.line });
    }
  }
}
