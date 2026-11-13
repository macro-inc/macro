import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/** A steadied view of a transient state, for status text that must not flash.
 * It turns on only after `source` has stayed on for `delay`, and once on it
 * stays on for at least `hold`, however briefly `source` goes off. */
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
  createEffect(() => {
    if (source()) {
      if (steady()) clearTimeout(timer);
      else
        schedule(() => {
          shownAt = Date.now();
          setSteady(true);
        }, delay);
      return;
    }
    if (steady()) schedule(() => setSteady(false), shownAt + hold - Date.now());
    else clearTimeout(timer);
  });
  onCleanup(() => clearTimeout(timer));
  return steady;
}
