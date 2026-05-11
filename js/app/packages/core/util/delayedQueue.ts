import { Queuer } from '@tanstack/pacer/queuer';
import { type Accessor, createEffect, createSignal } from 'solid-js';

/**
 * Creates a derived signal that returns `null` until `startFn` returns true,
 * then processes all subsequent source values through a FIFO queue with a
 * fixed `delayMs` between each flush.
 */
export function delayedQueue<T>(
  source: Accessor<T>,
  delayMs: number,
  startFn: (item: T) => boolean
): Accessor<T | null> {
  const [value, setValue] = createSignal<T | null>(null);
  let activated = false;

  const queuer = new Queuer<T>(
    (item) => {
      setValue(() => item);
    },
    {
      started: false,
      wait: delayMs,
    }
  );

  createEffect(() => {
    const next = source();

    if (activated) {
      queuer.addItem(next);
      return;
    }

    if (!startFn(next)) return;
    activated = true;
    queuer.start();
    queuer.addItem(next);
  });

  return value;
}
