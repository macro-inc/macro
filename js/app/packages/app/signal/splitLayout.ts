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
export function whenSplitManagerReady(): Promise<SplitManager> {
  return new Promise((resolve) => {
    const current = globalSplitManager();
    if (current) {
      resolve(current);
      return;
    }
    createRoot((dispose) => {
      createEffect(() => {
        const m = globalSplitManager();
        if (m) {
          dispose();
          resolve(m);
        }
      });
    });
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
