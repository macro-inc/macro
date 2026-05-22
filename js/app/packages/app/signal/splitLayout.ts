import { createSignal } from 'solid-js';
import type { SplitManager } from '../component/split-layout/layoutManager';

/**
 *  Primary global split manager for the app.
 */
const [_globalSplitManager, _setGlobalSplitManager] =
  createSignal<SplitManager>();

export const globalSplitManager = _globalSplitManager;
export const setGlobalSplitManager: typeof _setGlobalSplitManager = (
  next: any
) => {
  const result = _setGlobalSplitManager(next);
  if (import.meta.env.DEV) {
    (globalThis as any).__macroSplitManager = _globalSplitManager();
  }
  return result;
};
