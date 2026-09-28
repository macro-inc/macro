import { debounce } from '@solid-primitives/scheduled';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';

/** Keep quick calculations quiet without delaying the editor's busy state. */
export function createCalculationStatus(busy: Accessor<boolean>) {
  const [visible, setVisible] = createSignal(false);
  const show = debounce(() => setVisible(true), 250);

  // Synchronize the status timer with the worker's lifetime. The scheduled
  // primitive also cancels the timer when this editor is disposed.
  createEffect(
    on(busy, (pending) => {
      show.clear();
      setVisible(false);
      if (pending) show();
    })
  );

  return visible;
}
