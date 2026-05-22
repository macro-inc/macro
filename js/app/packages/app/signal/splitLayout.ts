import { createEffect, createRoot, createSignal } from 'solid-js';
import type { SplitManager } from '../component/split-layout/layoutManager';

/**
 *  Primary global split manager for the app.
 */
export const [globalSplitManager, setGlobalSplitManager] =
  createSignal<SplitManager>();

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
