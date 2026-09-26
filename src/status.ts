import type { Fleet } from "./live/fleet.ts";
import type { FeedStatus } from "./live/feed.ts";
import type { AirFleet } from "./live/aircraft.ts";

/** Live data older than this reads as stalled. */
const STALLED_MS = 60_000;

/**
 * A single quiet line in the corner: how many vehicles are moving and how
 * fresh the data is. It only asks for attention when live data stalls.
 */
export function startStatus(
  el: HTMLElement, fleet: Fleet, feed: { status: FeedStatus }, air?: AirFleet,
  weather?: () => string | undefined, airStatus?: FeedStatus,
) {
  const render = () => {
    const s = feed.status;
    const moving = [...fleet.vehicles.values()].filter((v) => v.alpha > 0.5).length;
    const trains = [...fleet.vehicles.values()].filter((v) => v.alpha > 0.5 && v.mode === "rail").length;
    const ageMs = s.lastOk ? performance.now() - s.lastOk : Infinity;
    const stalled = !s.paused && (ageMs > STALLED_MS || (s.failures > 0 && !s.lastOk));
    el.classList.toggle("stalled", stalled);
    if (stalled) {
      el.textContent = s.lastOk
        ? `Live data paused ${Math.round(ageMs / 60_000) || 1} min ago · retrying`
        : "Waiting for live data · retrying";
      return;
    }
    if (!s.lastOk) { el.textContent = "Connecting to Metro Transit…"; return; }
    const buses = moving - trains;
    const planes = air ? [...air.planes.values()].filter((p) => p.alpha > 0.5 && !p.onGround).length : 0;
    // No aircraft feed (the live site can't reach one): say nothing about
    // planes rather than claim an empty sky.
    const showPlanes = !!air && (!airStatus || airStatus.lastOk > 0 || air.planes.size > 0);
    const conditions = weather?.();
    // Two parts, so narrow screens can stack them on separate lines.
    const counts = document.createElement("span");
    counts.textContent = `${buses} buses · ${trains} trains${showPlanes ? ` · ${planes} planes` : ""}`;
    const sky = document.createElement("span");
    sky.className = "sky";
    sky.textContent = `${conditions ? `${conditions} · ` : ""}live`;
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.textContent = " · ";
    el.replaceChildren(counts, sep, sky);
  };
  render();
  return setInterval(render, 1000);
}
