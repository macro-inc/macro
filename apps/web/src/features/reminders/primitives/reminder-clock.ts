import { createSharedRoot } from '@solid-primitives/rootless';
import { createSignal, onCleanup } from 'solid-js';

/** One local clock for mounted schedule indicators, with no network polling. */
export const useReminderClock = createSharedRoot(() => {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 30_000);
  onCleanup(() => clearInterval(timer));
  return now;
});
