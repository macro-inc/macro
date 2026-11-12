import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

const STALL_CATCH_UP_MS = 50;

/** A steadied view of a transient state, for status text that must not flash.
 * It turns on only after `source` has stayed on for `delay`, and once on it
 * stays on for at least `hold`, however briefly `source` goes off. A blocked
 * thread does not count as `source` staying on. */
export function createSteadyFlag(
  source: Accessor<boolean>,
  delay = 300,
  hold = 500
): Accessor<boolean> {
  const [steady, setSteady] = createSignal(false);
  let shownAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (action: () => void, wait: number) => {
    clearTimeout(timer);
    timer = setTimeout(action, Math.max(0, wait));
  };
  const turnOn = () => {
    shownAt = Date.now();
    setSteady(true);
  };
  createEffect(() => {
    if (source()) {
      if (steady()) {
        clearTimeout(timer);
        return;
      }

      const dueAt = Date.now() + delay;
      schedule(() => {
        // A timer this late means the thread was blocked, and whatever turns
        // `source` off may be queued right behind it. Let that run first; the
        // effect cancels this if it does.
        if (Date.now() - dueAt > STALL_CATCH_UP_MS)
          schedule(turnOn, STALL_CATCH_UP_MS);
        else turnOn();
      }, delay);
      return;
    }
    if (steady()) schedule(() => setSteady(false), shownAt + hold - Date.now());
    else clearTimeout(timer);
  });
  onCleanup(() => clearTimeout(timer));
  return steady;
}
