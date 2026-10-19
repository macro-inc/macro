import { err, ok, type Result } from 'neverthrow';
import { type Accessor, createEffect, createRoot } from 'solid-js';

export type WaitForSignalTimeout = { kind: 'timeout' };

/**
 * Waits until the given signal satisfies a condition (truthy by default).
 * Settles with a timeout error after `timeout` ms instead of rejecting, so a
 * wait that is started and abandoned never surfaces as an unhandled rejection.
 *
 * Usage:
 *   const ready = await waitForSignal(isReady);
 *   if (ready.isErr()) return;
 */
export function waitForSignal<T>(
  signal: Accessor<T>,
  condition: (val: T) => boolean = Boolean,
  timeout: number = 3000
): Promise<Result<T, WaitForSignalTimeout>> {
  return new Promise((resolve) => {
    createRoot((dispose) => {
      const timer = setTimeout(() => {
        dispose();
        resolve(err({ kind: 'timeout' }));
      }, timeout);
      createEffect(() => {
        const value = signal();
        if (!condition(value)) return;
        clearTimeout(timer);
        dispose();
        resolve(ok(value));
      });
    });
  });
}
