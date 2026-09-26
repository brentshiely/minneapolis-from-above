import type { Mode, Transit } from "../transit/data.ts";
import type { VehicleRow } from "./feed.ts";
import { Motion } from "./motion.ts";

/** Anything drawn as a vehicle dot: a live vehicle or a fading ghost. */
export interface Drawable {
  routeId: string;
  mode: Mode;
  position: [number, number];
  /** 0-1 opacity. */
  alpha: number;
}

export interface Vehicle extends Drawable {
  id: string;
  tripId: string;
  motion: Motion;
  /** POSIX seconds of the latest GPS fix. */
  fixTime: number;
  /** Feed time of the latest snapshot that included this vehicle. */
  seenAt: number;
  /** Page-clock seconds when the vehicle (re)appeared; drives its fade-in. */
  appearAt: number;
}

/** Where a vehicle was just before it teleported, fading out. */
interface Ghost extends Drawable {
  since: number;
}

/** New vehicles and teleports fade in over this long. */
export const FADE_IN_S = 1.2;
/** Ghosts left behind by a teleport fade out over this long. */
export const GHOST_S = 1.2;
/** Vehicles unheard from this long start to fade... */
export const STALE_FADE_S = 120;
/** ...and are gone by this long. */
export const STALE_S = 180;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Every vehicle currently on the map, keyed by vehicle id. */
export class Fleet {
  readonly vehicles = new Map<string, Vehicle>();
  private ghosts: Ghost[] = [];
  private transit: Transit;
  /** Latest feed time applied. */
  feedTime = 0;

  constructor(transit: Transit) {
    this.transit = transit;
  }

  /** Apply a feed snapshot at page-clock time `now`. Missing vehicles are kept until pruned. */
  update(feedTime: number, rows: VehicleRow[], now = 0) {
    this.feedTime = Math.max(this.feedTime, feedTime);
    for (const [id, tripId, routeId, lat, lon, fixTime] of rows) {
      const mode = this.transit.routes[routeId]?.mode ?? "bus";
      const shape = this.transit.shapeForTrip(tripId);
      const v = this.vehicles.get(id);
      if (v) {
        const before = v.motion.teleports;
        const from = v.position;
        v.motion.onFix(shape, [lon, lat], fixTime);
        if (v.motion.teleports !== before) {
          this.ghosts.push({ routeId: v.routeId, mode: v.mode, position: from, alpha: v.alpha, since: now });
          v.appearAt = now;
        }
        Object.assign(v, { tripId, routeId, mode, fixTime, seenAt: feedTime, position: v.motion.pos });
      } else {
        const motion = new Motion(shape, [lon, lat], fixTime);
        this.vehicles.set(id, {
          id, tripId, routeId, mode, motion, position: motion.pos, alpha: 0,
          fixTime, seenAt: feedTime, appearAt: now,
        });
      }
    }
  }

  /**
   * Move every vehicle forward by `dtS` seconds and update opacities.
   * With `settle`, vehicles jump to their latest fix instead of gliding.
   */
  advance(dtS: number, now = 0, settle = false) {
    for (const v of this.vehicles.values()) {
      if (settle) v.motion.settle(); else v.motion.advance(dtS);
      v.position = v.motion.pos;
      const fadeIn = clamp01((now - v.appearAt) / FADE_IN_S);
      const fresh = 1 - clamp01((this.feedTime - v.seenAt - STALE_FADE_S) / (STALE_S - STALE_FADE_S));
      v.alpha = fadeIn * fresh;
    }
    this.ghosts = this.ghosts.filter((g) => {
      g.alpha = 1 - clamp01((now - g.since) / GHOST_S);
      return g.alpha > 0;
    });
  }

  /** Drop vehicles not seen for STALE_S seconds of feed time. */
  prune(feedTime: number, maxAgeS = STALE_S) {
    for (const [id, v] of this.vehicles) if (feedTime - v.seenAt > maxAgeS) this.vehicles.delete(id);
  }

  list(): Vehicle[] {
    return [...this.vehicles.values()];
  }

  /** Vehicles plus fading ghosts, for drawing. */
  drawables(): Drawable[] {
    return [...this.vehicles.values(), ...this.ghosts];
  }
}
