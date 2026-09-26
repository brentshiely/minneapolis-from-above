import type { Weather } from "./classify.ts";
import { driftSpeed, screenVector, threadCount } from "./wind.ts";

/**
 * Weather drawn over the map: rain and snow falling with the real wind,
 * cloud shadows on partly cloudy days, a veil for fog and overcast, and
 * the odd flicker of lightning. One canvas, no interaction.
 */

interface Drop { x: number; y: number; speed: number; len: number; size: number; phase: number; snow: boolean }
interface Cloud { x: number; y: number; r: number; a: number }
/** A wind thread: a wisp remembered as its last few positions. */
interface Thread { x: number; y: number; age: number; life: number; phase: number; trail: [number, number][] }

/** Positions each thread remembers; with the sample rate, sets its length. */
const THREAD_POINTS = 14;

const COUNTS: Record<Weather["intensity"], number> = { light: 140, moderate: 320, heavy: 620 };
/** The canvas renders at no more than this pixel ratio; weather needn't be razor sharp. */
const MAX_DPR = 1.5;

export class WeatherFx {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private veil: HTMLElement;
  private weather?: Weather;
  private drops: Drop[] = [];
  private clouds: Cloud[] = [];
  private threads: Thread[] = [];
  /** One soft cloud shadow, rendered small once and scaled up to draw. */
  private blob = WeatherFx.makeBlob();
  private sampleClock = 0;
  private gust = 0;
  private nextGust = 0;
  private daylight = 0;
  private flash = 0;
  private nextFlash = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, veil: HTMLElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.veil = veil;
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  get current() { return this.weather; }

  private static makeBlob(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(30, 40, 55, 1)");
    g.addColorStop(0.55, "rgba(30, 40, 55, 0.55)");
    g.addColorStop(1, "rgba(30, 40, 55, 0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return c;
  }

  private resize() {
    this.dpr = Math.min(MAX_DPR, devicePixelRatio || 1);
    this.w = innerWidth;
    this.h = innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  set(weather: Weather) {
    const changed = !this.weather || weather.precip !== this.weather.precip || weather.intensity !== this.weather.intensity
      || Math.abs(weather.cloudCover - this.weather.cloudCover) > 0.05
      || threadCount(weather.windMph) !== threadCount(this.weather.windMph);
    this.weather = weather;
    if (changed) this.seed();
    this.paintVeil();
  }

  setDaylight(d: number) {
    if (Math.abs(d - this.daylight) < 0.01) return;
    this.daylight = d;
    this.paintVeil();
  }

  private seed() {
    const w = this.weather!;
    const n = w.precip === "none" ? 0 : COUNTS[w.intensity];
    this.drops = Array.from({ length: n }, (_, i) => this.newDrop(w.precip === "snow" || (w.precip === "mix" && i % 2 === 0), true));
    // Cloud shadows only for broken sunshine: none when clear, none when overcast.
    // Wind threads only when it's dry; rain and snow already show the wind.
    const n2 = w.precip === "none" ? threadCount(w.windMph) : 0;
    this.threads = Array.from({ length: n2 }, () => this.newThread(true));
    const patchy = w.cloudCover > 0.15 && w.cloudCover < 0.9;
    this.clouds = patchy
      ? Array.from({ length: Math.round(4 + w.cloudCover * 8) }, () => ({
        x: Math.random() * this.w, y: Math.random() * this.h, r: 180 + Math.random() * 260, a: 0.05 + Math.random() * 0.05,
      }))
      : [];
  }

  private newThread(midLife: boolean): Thread {
    const life = 5 + Math.random() * 4;
    return {
      x: Math.random() * this.w, y: Math.random() * this.h,
      age: midLife ? Math.random() * life : 0, life, phase: Math.random() * Math.PI * 2, trail: [],
    };
  }

  private newDrop(snow: boolean, anywhere: boolean): Drop {
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : -20,
      speed: snow ? 30 + Math.random() * 55 : 620 + Math.random() * 280,
      len: 12 + Math.random() * 12,
      size: 1 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
      snow,
    };
  }

  /** Fog, mist and overcast as a flat veil over the map (a CSS layer, cheap). */
  private paintVeil() {
    const w = this.weather;
    if (!w) return;
    const vis = w.visibilityMi ?? 10;
    const fog = vis < 1 ? 0.42 : vis < 2 ? 0.28 : vis < 4 ? 0.14 : 0;
    const d = this.daylight;
    // Fog is pale; overcast just dims, a little more by day when the sun is hidden.
    const dim = w.cloudCover >= 0.9 && w.precip === "none" ? 0.06 + 0.06 * d : 0;
    const fogRgb = d > 0.5 ? "236, 239, 242" : "60, 72, 86";
    this.veil.style.background = fog > 0
      ? `rgba(${fogRgb}, ${fog})`
      : `rgba(10, 16, 24, ${dim})`;
  }

  private drawThreads(dt: number, wx: number, wy: number, w: Weather, d: number) {
    const ctx = this.ctx;
    // Gusts: now and then the pace swells toward the gust speed and eases back.
    const now = performance.now() / 1000;
    if (w.gustMph !== null && w.gustMph > w.windMph + 4) {
      if (!this.nextGust) this.nextGust = now + 4 + Math.random() * 8;
      if (now >= this.nextGust) { this.gust = 1; this.nextGust = now + 8 + Math.random() * 10; }
    }
    const gustMph = w.gustMph ?? w.windMph;
    const swell = Math.sin(Math.PI * Math.min(1, 1 - this.gust)) ; // 0 → 1 → 0 over the gust
    this.gust = Math.max(0, this.gust - dt / 3);
    const speed = driftSpeed(w.windMph + (gustMph - w.windMph) * (this.gust > 0 ? swell : 0));
    this.sampleClock += dt;
    const sample = this.sampleClock >= 0.05;
    if (sample) this.sampleClock = 0;
    // Perpendicular, for a gentle sideways meander.
    const px = -wy, py = wx;
    ctx.lineWidth = d > 0.5 ? 1.3 : 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = d > 0.5 ? "rgb(50, 66, 88)" : "rgb(205, 218, 236)";
    const peak = d > 0.5 ? 0.42 : 0.34;
    for (const t of this.threads) {
      t.age += dt;
      t.phase += dt * 1.3;
      const meander = Math.sin(t.phase) * 14;
      t.x += (wx * speed + px * meander) * dt;
      t.y += (wy * speed + py * meander) * dt;
      if (sample) {
        t.trail.push([t.x, t.y]);
        if (t.trail.length > THREAD_POINTS) t.trail.shift();
      }
      const off = t.x < -80 || t.x > this.w + 80 || t.y < -80 || t.y > this.h + 80;
      if (t.age >= t.life || off) { Object.assign(t, this.newThread(false)); continue; }
      if (t.trail.length < 3) continue;
      // Fade in, hold, fade out; the tail fades toward nothing, drawn as
      // three bands of rising opacity (no per-frame allocations).
      const a = peak * Math.sin((Math.PI * t.age) / t.life);
      const n = t.trail.length, third = Math.max(1, Math.floor(n / 3));
      for (let band = 0; band < 3; band++) {
        const from = band * third, to = band === 2 ? n - 1 : Math.min(n - 1, (band + 1) * third);
        if (to <= from) continue;
        ctx.globalAlpha = (a * (band + 1)) / 3;
        ctx.beginPath();
        ctx.moveTo(t.trail[from][0], t.trail[from][1]);
        for (let i = from + 1; i <= to; i++) ctx.lineTo(t.trail[i][0], t.trail[i][1]);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Advance and draw one frame. `bearing` is the map's rotation, so wind
   * keeps its real compass direction when the camera turns.
   */
  frame(dt: number, bearing: number, still: boolean) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const w = this.weather;
    if (!w || still) return;

    // Wind direction on screen: north is up when the map isn't rotated.
    const [wx, wy] = screenVector(w.windToward, bearing);
    const push = Math.min(1, w.windMph / 25);
    const d = this.daylight;

    // Cloud shadows by day, sliding with the wind.
    if (this.clouds.length && d > 0.3) {
      for (const c of this.clouds) {
        c.x += wx * (6 + 20 * push) * dt;
        c.y += wy * (6 + 20 * push) * dt;
        if (c.x - c.r > this.w) c.x = -c.r; else if (c.x + c.r < 0) c.x = this.w + c.r;
        if (c.y - c.r > this.h) c.y = -c.r; else if (c.y + c.r < 0) c.y = this.h + c.r;
        ctx.globalAlpha = c.a * d;
        ctx.drawImage(this.blob, c.x - c.r, c.y - c.r, c.r * 2, c.r * 2);
      }
      ctx.globalAlpha = 1;
    }

    // Wind threads: faint wisps drifting at a pace proportional to the wind.
    if (this.threads.length) this.drawThreads(dt, wx, wy, w, d);

    // Rain: slanted streaks. Seen from above they still read as falling rain.
    const rainColor = d > 0.5 ? "rgba(70, 90, 115, 0.32)" : "rgba(170, 195, 225, 0.28)";
    const slant = 0.25 + 0.75 * push;
    ctx.lineCap = "round";
    ctx.strokeStyle = rainColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of this.drops) {
      if (p.snow) continue;
      const vx = wx * slant * p.speed * 0.5, vy = p.speed * (0.7 + 0.3 * Math.max(0, wy));
      p.x += vx * dt; p.y += vy * dt;
      const k = p.len / Math.hypot(vx, vy);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - vx * k, p.y - vy * k);
      if (p.y > this.h + 30 || p.x < -40 || p.x > this.w + 40) Object.assign(p, this.newDrop(false, false), { x: Math.random() * (this.w + 80) - 40 });
    }
    ctx.stroke();

    // Snow: flakes drifting with the wind, wobbling as they go.
    for (const p of this.drops) {
      if (!p.snow) continue;
      p.phase += dt * 1.6;
      p.x += (wx * push * 60 + Math.sin(p.phase) * 18) * dt;
      p.y += (p.speed + wy * push * 40) * dt;
      if (p.y > this.h + 10) Object.assign(p, this.newDrop(true, false));
      if (p.x < -10) p.x = this.w + 10; else if (p.x > this.w + 10) p.x = -10;
      if (d > 0.5) {
        // A faint shadow lets white flakes show on the light day map.
        ctx.fillStyle = "rgba(40, 55, 75, 0.22)";
        ctx.beginPath(); ctx.arc(p.x + 1, p.y + 1.2, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }

    // Lightning: now and then, a quick double flicker.
    if (w.thunder) {
      const now = performance.now() / 1000;
      if (!this.nextFlash) this.nextFlash = now + 4 + Math.random() * 10;
      if (now >= this.nextFlash) { this.flash = 1; this.nextFlash = now + 8 + Math.random() * 18; }
      if (this.flash > 0) {
        const flicker = this.flash > 0.55 && this.flash < 0.7 ? 0.3 : 1;
        ctx.fillStyle = `rgba(225, 232, 255, ${0.22 * this.flash * flicker})`;
        ctx.fillRect(0, 0, this.w, this.h);
        this.flash = Math.max(0, this.flash - dt * 2.8);
      }
    }
  }
}
