import type { SplitRouter } from '@app/lib/split-router';
import type {
  SplitId,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { until } from '@solid-primitives/promise';
import { createEffect, createRoot, createSignal } from 'solid-js';

/**
 *  Primary global split manager for the app.
 */
export const [globalSplitManager, setGlobalSplitManager] =
  createSignal<SplitManager>();

/** The route-aware host for navigation initiated outside split components. */
export const [globalSplitRouter, setGlobalSplitRouter] =
  createSignal<SplitRouter<SplitId>>();

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
