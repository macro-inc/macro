import { type Accessor, createSignal, createEffect } from 'solid-js';
import { Queuer } from '@tanstack/pacer/queuer';

/**
 * Creates a derived signal that drops source values until `startFn` returns true,
 * then processes all subsequent updates through a FIFO queue with a fixed `delayMs` between each flush.
 */
export function delayedQueue<T extends unknown[]>(
  source: Accessor<T>,
  delayMs: number,
  startFn: (item: T) => boolean = (_item) => true
): Accessor<T> {
  const [value, setValue] = createSignal<T>(source());
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
