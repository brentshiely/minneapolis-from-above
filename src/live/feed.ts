import type { VehicleRow, VehiclesResponse } from "../../functions/api/vehicles.ts";

export type { VehicleRow };

export const POLL_MS = 15_000;

/**
 * Polls /api/vehicles and hands each new snapshot to `onSnapshot`.
 * Snapshots whose feed timestamp hasn't advanced are skipped.
 */
export function startFeed(onSnapshot: (feedTime: number, rows: VehicleRow[]) => void, onError?: (err: unknown) => void) {
  let lastT = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  async function tick() {
    try {
      const res = await fetch("/api/vehicles", { cache: "no-store" });
      if (!res.ok) throw new Error(`vehicles ${res.status}`);
      const body = (await res.json()) as VehiclesResponse;
      if (body.t > lastT) {
        lastT = body.t;
        onSnapshot(body.t, body.v);
      }
    } catch (err) {
      onError?.(err);
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  }

  tick();
  return {
    stop() { stopped = true; clearTimeout(timer); },
    /** Fetch immediately, e.g. when the tab becomes visible again. */
    now() { clearTimeout(timer); tick(); },
  };
}
