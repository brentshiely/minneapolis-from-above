import type { VehicleRow, VehiclesResponse } from "../../functions/api/vehicles.ts";

export type { VehicleRow };

export const POLL_MS = 15_000;

export interface FeedStatus {
  /** Page-clock ms of the last successful fetch, or 0. */
  lastOk: number;
  /** Consecutive failed fetches. */
  failures: number;
  paused: boolean;
}

/**
 * Polls /api/vehicles and hands each new snapshot to `onSnapshot`.
 * Snapshots whose feed timestamp hasn't advanced are skipped.
 */
export function startFeed(onSnapshot: (feedTime: number, rows: VehicleRow[]) => void) {
  let lastT = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  const status: FeedStatus = { lastOk: 0, failures: 0, paused: false };

  function schedule() {
    clearTimeout(timer);
    if (!status.paused) timer = setTimeout(tick, POLL_MS);
  }

  async function tick() {
    if (inFlight || status.paused) return;
    inFlight = true;
    try {
      const res = await fetch("/api/vehicles", { cache: "no-store" });
      if (!res.ok) throw new Error(`vehicles ${res.status}`);
      const body = (await res.json()) as VehiclesResponse;
      status.lastOk = performance.now();
      status.failures = 0;
      if (body.t > lastT) {
        lastT = body.t;
        onSnapshot(body.t, body.v);
      }
    } catch (err) {
      status.failures++;
      console.warn("Vehicle feed:", err);
    } finally {
      inFlight = false;
      schedule();
    }
  }

  tick();
  return {
    status,
    /** Stop polling (e.g. while the tab is hidden). */
    pause() { status.paused = true; clearTimeout(timer); },
    /** Resume polling with an immediate fetch. */
    resume() { if (!status.paused) return; status.paused = false; tick(); },
  };
}
