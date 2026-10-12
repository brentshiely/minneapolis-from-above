import type { AmtrakResponse, AmtrakRow } from "../../functions/api/amtrak.ts";
import type { Description } from "../describe.ts";
import { ago } from "../describe.ts";
import { headingAt, project } from "../live/geometry.ts";
import { slice, type RailLine } from "./rail.ts";

export type { AmtrakResponse, AmtrakRow };

const MPH_TO_MS = 0.44704;
/** A train is only placed on a line if its position is this close to it, in meters. */
const SNAP_M = 400;
/** The reported position can be minutes old; run it forward at the reported speed, but no further than this. */
const MAX_EXTRAPOLATE_S = 150;
/** A new report corrects the drawn position gradually, with this time constant (seconds). */
const CORRECT_TAU_S = 8;
/** A long-distance train is about eight cars. */
const TRAIN_LENGTH_M = 250;
/** Gone this long (seconds) after its last report. */
const STALE_S = 15 * 60;

const COMPASS: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

export interface AmtrakTrain {
  row: AmtrakRow;
  /** Tail to head; the head is the last point. */
  path: [number, number][];
  /** Whether the train is on a known line (otherwise it is drawn as a point at its reported position). */
  onLine: boolean;
}

interface State {
  row: AmtrakRow;
  line?: RailLine;
  /** Along `line`'s drawn direction: +1, or -1 when the train runs against it. */
  dir: 1 | -1;
  /** Meters along the line at the report's time. */
  dist: number;
  /** Correction in meters still to fade out, as of `errAt`. */
  err: number;
  errAt: number;
  /** Where it was drawn last tick. */
  shown?: number;
  /** Whether the rail lines had loaded when this was placed; if not, it is placed again once they have. */
  placedOnLines: boolean;
}

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** The nearest line to a point within SNAP_M, and how far along it the point falls. */
export function snapToRail(lines: RailLine[], p: [number, number]): { line: RailLine; dist: number } | undefined {
  let best: { line: RailLine; dist: number; offset: number } | undefined;
  for (const line of lines) {
    const hit = project(line.shape, p);
    if (hit.offset <= SNAP_M && (!best || hit.offset < best.offset)) best = { line, dist: hit.dist, offset: hit.offset };
  }
  return best;
}

/**
 * Amtrak's trains, as reported a minute or so apart: each is put on the rail
 * line it is on and run along it at its reported speed between reports, so
 * it glides instead of jumping. (The tracker's positions can be several
 * minutes old, so this is a best estimate, not a live fix.)
 */
export class AmtrakFleet {
  private states = new Map<string, State>();
  /** The trains drawn this tick. */
  trains: AmtrakTrain[] = [];

  private lines: () => RailLine[];

  constructor(lines: () => RailLine[]) { this.lines = lines; }

  update(rows: AmtrakRow[], nowS: number) {
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.id);
      this.states.set(row.id, this.place(row, this.states.get(row.id), nowS));
    }
    for (const id of [...this.states.keys()]) if (!seen.has(id)) this.states.delete(id);
  }

  /** Put a report on its rail line, easing from where the train was last drawn. */
  private place(row: AmtrakRow, prev: State | undefined, nowS: number): State {
    const lines = this.lines();
    const snap = snapToRail(lines, [row.lon, row.lat]);
    const state: State = { row, dir: 1, dist: 0, err: 0, errAt: nowS, line: snap?.line, placedOnLines: lines.length > 0 };
    if (!snap) return state;
    state.dist = snap.dist;
    const heading = COMPASS[row.heading];
    if (heading !== undefined) state.dir = angleDiff(headingAt(snap.line.shape, snap.dist), heading) <= 90 ? 1 : -1;
    else if (prev?.line === snap.line) state.dir = prev.dir;
    if (prev?.line === snap.line && prev.shown !== undefined) {
      state.err = prev.shown - this.predicted(state, nowS);
      if (Math.abs(state.err) > 5000) state.err = 0;
    }
    return state;
  }

  private predicted(s: State, nowS: number): number {
    if (!s.line) return 0;
    const elapsed = Math.min(MAX_EXTRAPOLATE_S, Math.max(0, nowS - s.row.at));
    return Math.min(s.line.shape.length, Math.max(0, s.dist + s.dir * s.row.mph * MPH_TO_MS * elapsed));
  }

  advance(nowS: number) {
    const out: AmtrakTrain[] = [];
    for (let s of this.states.values()) {
      if (nowS - s.row.at > STALE_S) continue;
      // The first report can arrive before the rail lines have loaded.
      if (!s.placedOnLines && this.lines().length) { s = this.place(s.row, undefined, nowS); this.states.set(s.row.id, s); }
      if (!s.line) { out.push({ row: s.row, path: [[s.row.lon, s.row.lat], [s.row.lon, s.row.lat]], onLine: false }); continue; }
      const err = s.err * Math.exp(-(nowS - s.errAt) / CORRECT_TAU_S);
      const head = Math.min(s.line.shape.length, Math.max(0, this.predicted(s, nowS) + err));
      s.shown = head;
      const path = s.dir === 1 ? slice(s.line.shape, head - TRAIN_LENGTH_M, head) : slice(s.line.shape, head, head + TRAIN_LENGTH_M).reverse();
      if (path.length >= 2) out.push({ row: s.row, path, onLine: true });
    }
    this.trains = out;
  }
}

/** "8 minutes late", "on time". */
export function lateness(late: number | null): string | undefined {
  if (late === null) return undefined;
  if (Math.abs(late) <= 5) return "on time";
  return late > 0 ? `${late} minutes late` : `${-late} minutes early`;
}

export function describeAmtrak(r: AmtrakRow, nowS: number): Description {
  const to = r.to ? `, bound for ${r.to}` : "";
  const bits = [
    `Train ${r.num}${r.from ? ` from ${r.from}` : ""}.`,
    r.mph > 0 ? `Running ${r.mph} mph.` : "Stopped.",
    r.next ? `Next stop ${r.next}${lateness(r.late) ? `, ${lateness(r.late)}` : ""}.` : "",
  ].filter(Boolean);
  return {
    title: `Amtrak's ${r.route}${to}.`,
    detail: bits.join(" "),
    meta: `Amtrak train ${r.num} · position reported ${ago(nowS - r.at)} · via Amtraker`,
  };
}
