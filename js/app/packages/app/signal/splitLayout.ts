import { until } from '@solid-primitives/promise';
import { createEffect, createRoot, createSignal } from 'solid-js';
import type { SplitManager } from '../component/split-layout/layoutManager';

/**
 *  Primary global split manager for the app.
 */
export const [globalSplitManager, setGlobalSplitManager] =
  createSignal<SplitManager>();

/**
 * Resolves once the global split manager is initialized. Safe to call from
 * outside a reactive context (e.g. async event handlers).
 */
export function whenSplitManagerReady(
  signal?: AbortSignal
): Promise<SplitManager> {
  const wait = until(globalSplitManager);
  if (!signal) return wait;
  const abortSignal = signal;

  return new Promise((resolve, reject) => {
    function onAbort() {
      wait.dispose();
      reject(
        abortSignal.reason ??
          new DOMException('Split manager readiness wait aborted', 'AbortError')
      );
    }

    wait
      .then(resolve, reject)
      .finally(() => abortSignal.removeEventListener('abort', onAbort));

    if (abortSignal.aborted) {
      onAbort();
      return;
    }

    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

if (import.meta.env.DEV) {
  createRoot(() => {
    createEffect(() => {
      const m = globalSplitManager();
      if (m)
        (
          globalThis as { __macroSplitManager?: SplitManager }
        ).__macroSplitManager = m;
    });
  });
}
