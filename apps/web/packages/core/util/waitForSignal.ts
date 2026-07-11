import { type Accessor, createEffect } from 'solid-js';

/**
 * Waits until the given signal satisfies a condition, then resolves the Promise.
 * By default, it waits until the signal value is "truthy."
 * Times out after specified time (ms) or default of 3 seconds.
 *
 * Usage:
 *   const ready = createSignal(false);
 *   // somewhere else: await waitForSignal(ready);
 */
export function waitForSignal<T>(
  signal: Accessor<T>,
  condition: (val: T) => boolean = Boolean,
  timeout: number = 3000
): Promise<T> {
  return new Promise((resolve, reject) => {
    createEffect(() => {
      setTimeout(() => {
        reject(new Error('timed out'));
      }, timeout);

      const value = signal();
      if (condition(value)) {
        resolve(value);
      }
    });
  });
}
