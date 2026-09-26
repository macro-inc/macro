import { createSignal, onCleanup } from 'solid-js';

/** Calendar time advances even when the viewer leaves this panel open. */
export function createCallSidebarClock() {
  const [now, setNow] = createSignal(new Date());
  const timer = setInterval(() => setNow(new Date()), 30_000);
  onCleanup(() => clearInterval(timer));
  return now;
}
