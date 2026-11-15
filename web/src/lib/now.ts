import { useSyncExternalStore } from 'react';

// One shared clock for relative times. The smallest unit shown is a minute, so it ticks once a minute.
const TICK_MS = 60 * 1000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    // The clock stops while nothing shows a time; catch up before ticking again.
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The current time, updated every minute. */
export function useMinuteClock() {
  return useSyncExternalStore(subscribe, () => now);
}
