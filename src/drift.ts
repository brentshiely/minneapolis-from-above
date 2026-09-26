/**
 * Ambient camera: when nobody has touched the map for a while, tour the
 * metro slowly, landmark to landmark, sometimes riding along with a train
 * or a plane coming in to MSP. Any input hands control straight back.
 */

export type LonLat = [number, number];

export interface Camera {
  center: LonLat;
  zoom: number;
  bearing: number;
  pitch: number;
}

/** The slice of a MapLibre map the drift needs; easy to fake in tests. */
export interface DriftMap {
  easeTo(opts: Camera & { duration: number; easing?: (t: number) => number }): void;
  jumpTo(opts: Partial<Camera>): void;
  stop(): void;
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getBearing(): number;
}

export interface Landmark extends Camera {
  kind: "landmark";
  name: string;
}

/** A moving subject to ride along with, found fresh each time. */
export interface Follow {
  kind: "follow";
  find(): { name: string; position: () => LonLat | undefined } | undefined;
  zoom: number;
  pitch: number;
}

export type Scene = Landmark | Follow;

export const LANDMARKS: Landmark[] = [
  { kind: "landmark", name: "Over the whole metro", center: [-93.18, 44.96], zoom: 10.2, bearing: 0, pitch: 0 },
  { kind: "landmark", name: "Over downtown Minneapolis", center: [-93.268, 44.976], zoom: 14.2, bearing: -18, pitch: 35 },
  { kind: "landmark", name: "Over the University of Minnesota", center: [-93.232, 44.974], zoom: 14.4, bearing: 12, pitch: 30 },
  { kind: "landmark", name: "Over downtown Saint Paul", center: [-93.094, 44.948], zoom: 14.3, bearing: 20, pitch: 35 },
  { kind: "landmark", name: "Along University Avenue", center: [-93.16, 44.956], zoom: 12.8, bearing: 90, pitch: 25 },
  { kind: "landmark", name: "Over the chain of lakes", center: [-93.31, 44.945], zoom: 13.2, bearing: -8, pitch: 25 },
  { kind: "landmark", name: "Over the MSP approach", center: [-93.21, 44.9], zoom: 12.6, bearing: 30, pitch: 30 },
  { kind: "landmark", name: "Down Lake Street", center: [-93.24, 44.948], zoom: 13.4, bearing: 90, pitch: 25 },
];

/** Seconds of stillness before the tour starts. */
export const IDLE_S = 90;
/** How long the camera takes to glide between views. */
export const TRAVEL_S = 40;
/** How long it lingers on each view. */
export const DWELL_S = 60;
/** Degrees the camera slowly turns while it lingers, so it never sits dead still. */
const DWELL_TURN = 10;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class Drift {
  private map: DriftMap;
  private scenes: Scene[];
  private idleS: number;
  private lastInput: number;
  private active = false;
  private phase: "travel" | "dwell" = "travel";
  private phaseEnd = 0;
  private sceneIndex = -1;
  private following?: { position: () => LonLat | undefined };
  /** Called with a caption when a view is reached, and undefined when drift stops. */
  onCaption?: (text: string | undefined) => void;
  /** When true, never drift (reduced motion, a pinned tooltip). */
  holdStill: () => boolean = () => false;

  constructor(map: DriftMap, scenes: Scene[], now: number, idleS = IDLE_S) {
    this.map = map;
    this.scenes = scenes;
    this.idleS = idleS;
    this.lastInput = now;
  }

  get drifting() { return this.active; }

  /** Someone touched something: stop right away and start the idle clock over. */
  wake(now: number) {
    this.lastInput = now;
    if (!this.active) return;
    this.active = false;
    this.following = undefined;
    this.map.stop();
    this.onCaption?.(undefined);
  }

  /** Call every frame with the page clock in seconds. */
  tick(now: number) {
    if (this.holdStill()) {
      if (this.active) this.wake(now);
      else this.lastInput = now;
      return;
    }
    if (!this.active) {
      if (now - this.lastInput >= this.idleS) {
        this.active = true;
        this.next(now);
      }
      return;
    }
    if (this.following) {
      const p = this.following.position();
      if (!p) { this.next(now); return; }
      // Ride along once the approach glide is done (a jump mid-glide would
      // cancel it): ease the camera toward the subject every frame.
      if (this.phase === "dwell") {
        const c = this.map.getCenter();
        this.map.jumpTo({ center: [c.lng + (p[0] - c.lng) * 0.06, c.lat + (p[1] - c.lat) * 0.06] });
      }
    }
    if (now >= this.phaseEnd) {
      if (this.phase === "travel") this.dwell(now);
      else this.next(now);
    }
  }

  private dwell(now: number) {
    this.phase = "dwell";
    this.phaseEnd = now + DWELL_S;
    if (!this.following) {
      const c = this.map.getCenter();
      this.map.easeTo({
        center: [c.lng, c.lat], zoom: this.map.getZoom(), bearing: this.map.getBearing() + DWELL_TURN,
        pitch: (this.scenes[this.sceneIndex] as Landmark).pitch, duration: DWELL_S * 1000, easing: (t) => t,
      });
    }
  }

  private next(now: number) {
    this.following = undefined;
    for (let tries = 0; tries < this.scenes.length; tries++) {
      this.sceneIndex = (this.sceneIndex + 1) % this.scenes.length;
      const scene = this.scenes[this.sceneIndex];
      if (scene.kind === "landmark") {
        this.map.easeTo({ ...scene, duration: TRAVEL_S * 1000, easing: easeInOut });
        this.onCaption?.(scene.name);
        this.phase = "travel";
        this.phaseEnd = now + TRAVEL_S;
        return;
      }
      const subject = scene.find();
      const start = subject?.position();
      if (!subject || !start) continue; // nothing to follow right now
      this.following = subject;
      this.map.easeTo({ center: start, zoom: scene.zoom, bearing: this.map.getBearing(), pitch: scene.pitch, duration: 12_000, easing: easeInOut });
      this.onCaption?.(subject.name);
      this.phase = "travel";
      this.phaseEnd = now + 12;
      return;
    }
  }
}
