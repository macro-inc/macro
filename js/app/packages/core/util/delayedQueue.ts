import { type Accessor, createSignal, createEffect } from 'solid-js';
import { Queuer } from '@tanstack/pacer/queuer';

/**
 * Creates a queued signal that prorcess source values in a queue with a fixed
 * delay. The queue is started when the startFn callback returns true (defaults to immediate).
 */
export function delayedQueue<T extends unknown[]>(
  source: () => T,
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
