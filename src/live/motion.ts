import type { Shape } from "../transit/data.ts";
import { distM } from "../transit/data.ts";
import { bearing, headingAt, pointAt, project, type LonLat } from "./geometry.ts";

/**
 * How a vehicle's drawn position moves between GPS fixes.
 *
 * On a shape: each fix is projected to a distance along the route, and the
 * drawn position advances along the shape toward it at a steady speed,
 * timed to arrive about when the next fix is due. So a bus rounds real
 * corners, and it never runs backwards: a fix behind the drawn position
 * holds the vehicle in place instead.
 *
 * Off a shape (no trip match, or a detour): the drawn position slides in a
 * straight line to the fix over the same glide time, facing the way the
 * feed says the vehicle is pointing (the glide's own direction only when the
 * feed gives none, since a glide cuts corners the vehicle doesn't).
 */

/** A fix farther than this from the route means the vehicle is off it. */
export const OFF_ROUTE_M = 80;
/** Further ahead than this and gliding would look like teleporting anyway. */
export const JUMP_AHEAD_M = 3000;
/** Further behind than this is either a GPS glitch or a drawn position that was wrong... */
export const JUMP_BACK_M = 400;
/** ...and this many such fixes in a row means the drawn position was wrong. */
export const BACK_STRIKES = 3;
/** Gliding faster than ~125 km/h reads as a glitch; cap it. */
export const MAX_SPEED_MS = 35;
/** Glide time bounds in seconds; the actual time tracks each vehicle's fix interval. */
export const GLIDE_MIN_S = 8;
export const GLIDE_MAX_S = 40;
export const GLIDE_DEFAULT_S = 15;

export class Motion {
  shape: Shape | undefined;
  /** Drawn distance along the shape (shape mode). */
  dist = 0;
  /** Distance of the latest fix along the shape (shape mode). */
  target = 0;
  /** Meters per second along the shape (shape mode). */
  speed = 0;

  /** Drawn position. */
  pos: LonLat;
  heading = 0;

  // Straight-line mode.
  private from: LonLat;
  private to: LonLat;
  private t = 1;
  private duration = GLIDE_DEFAULT_S;

  private lastFixTime: number;
  /** The bearing the feed reported with the latest fix, if any. */
  private reported: number | undefined;
  /** Counts discontinuous jumps, so the fleet can crossfade them. */
  teleports = 0;
  /** Consecutive fixes far behind the drawn position. */
  private backStrikes = 0;

  constructor(shape: Shape | undefined, fix: LonLat, fixTime: number, reportedBearing?: number | null) {
    this.lastFixTime = fixTime;
    this.reported = reportedBearing ?? undefined;
    if (this.reported !== undefined) this.heading = this.reported;
    this.pos = [fix[0], fix[1]];
    this.from = this.pos;
    this.to = this.pos;
    if (shape) {
      const p = project(shape, fix);
      if (p.offset <= OFF_ROUTE_M) {
        this.shape = shape;
        this.dist = this.target = p.dist;
        this.pos = pointAt(shape, p.dist);
        this.heading = headingAt(shape, p.dist);
      }
    }
  }

  get onShape() { return this.shape !== undefined; }

  /** Seconds to glide toward this fix, from the gap since the previous one. */
  private glideFor(fixTime: number): number {
    const interval = fixTime - this.lastFixTime;
    if (!(interval > 0)) return GLIDE_DEFAULT_S;
    return Math.min(GLIDE_MAX_S, Math.max(GLIDE_MIN_S, interval));
  }

  onFix(shape: Shape | undefined, fix: LonLat, fixTime: number, reportedBearing?: number | null) {
    if (fixTime <= this.lastFixTime && shape === this.shape) return; // same fix again
    this.reported = reportedBearing ?? undefined;
    const glide = this.glideFor(fixTime);
    this.lastFixTime = Math.max(this.lastFixTime, fixTime);

    if (shape) {
      const sameShape = shape === this.shape;
      const p = project(shape, fix, sameShape
        ? { dist: this.target, back: JUMP_BACK_M + 200, ahead: JUMP_AHEAD_M + 1000, maxOffset: OFF_ROUTE_M }
        : undefined);

      if (p.offset <= OFF_ROUTE_M) {
        if (sameShape) {
          this.glideAlong(p.dist, glide);
          return;
        }
        // Entering a shape (new trip, or back from a detour or layover).
        const here = project(shape, this.pos);
        if (here.offset <= OFF_ROUTE_M && p.dist >= here.dist - JUMP_BACK_M) {
          // Drawn on the new shape already: carry on along it from here.
          this.shape = shape;
          this.dist = this.target = here.dist;
          this.speed = 0;
          this.glideAlong(p.dist, glide);
          return;
        }
        // Drawn off the shape: slide straight to the fix's spot on it, and
        // pick the shape up from there on the next fix.
        this.shape = undefined;
        this.glideStraight(pointAt(shape, p.dist), glide);
        return;
      }
    }

    // No shape, or too far from it: straight-line mode.
    this.shape = undefined;
    this.glideStraight(fix, glide);
  }

  private glideAlong(targetDist: number, glide: number) {
    const shape = this.shape!;
    const delta = targetDist - this.dist;
    if (delta < -JUMP_BACK_M) {
      // Far behind: usually a one-off GPS glitch that corrects on the next
      // fix. Hold through it; only a run of them means we're really wrong.
      if (++this.backStrikes >= BACK_STRIKES) {
        this.backStrikes = 0;
        this.teleport(shape, targetDist);
      } else {
        this.target = this.dist;
        this.speed = 0;
      }
      return;
    }
    this.backStrikes = 0;
    if (delta > JUMP_AHEAD_M) {
      this.teleport(shape, targetDist);
    } else if (delta <= 0) {
      // Behind the drawn position, or not moving: hold rather than reverse.
      this.target = this.dist;
      this.speed = 0;
    } else {
      this.target = targetDist;
      this.speed = Math.min(MAX_SPEED_MS, delta / glide);
    }
  }

  private teleport(shape: Shape, dist: number) {
    this.teleports++;
    this.dist = this.target = dist;
    this.speed = 0;
    this.pos = pointAt(shape, dist);
    this.heading = headingAt(shape, dist);
  }

  private glideStraight(fix: LonLat, glide: number) {
    this.from = [this.pos[0], this.pos[1]];
    this.to = [fix[0], fix[1]];
    const d = distM(this.from, this.to);
    if (d > JUMP_AHEAD_M) {
      this.teleports++;
      this.pos = this.to;
      this.t = 1;
      return;
    }
    if (d > 1) this.heading = this.reported ?? bearing(this.from, this.to);
    this.t = 0;
    // Same speed cap as on a shape.
    this.duration = Math.max(glide, d / MAX_SPEED_MS);
  }

  /** Jump straight to the latest fix (reduced motion). */
  settle() {
    if (this.shape) {
      if (this.dist === this.target) return;
      this.dist = this.target;
      this.pos = pointAt(this.shape, this.dist);
      this.heading = headingAt(this.shape, this.dist);
    } else if (this.t < 1) {
      this.t = 1;
      this.pos = [this.to[0], this.to[1]];
    }
  }

  /** Move the drawn position forward by `dtS` seconds. */
  advance(dtS: number) {
    if (this.shape) {
      if (this.speed <= 0 || this.dist >= this.target) return;
      this.dist = Math.min(this.target, this.dist + this.speed * dtS);
      this.pos = pointAt(this.shape, this.dist);
      this.heading = headingAt(this.shape, this.dist);
    } else if (this.t < 1) {
      this.t = Math.min(1, this.t + dtS / this.duration);
      this.pos = [this.from[0] + (this.to[0] - this.from[0]) * this.t, this.from[1] + (this.to[1] - this.from[1]) * this.t];
    }
  }
}
