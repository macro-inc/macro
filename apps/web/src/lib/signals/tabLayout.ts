import type { TabManager } from '@components/app/tab-layout/tab-manager';
import { createSignal } from 'solid-js';

/**
 * The desktop tab manager, set while tabs are enabled (macOS desktop app).
 * Published globally like `globalSplitManager`, because the title bar, global
 * hotkeys, and the router middleware live outside the owning provider.
 */
export const [globalTabManager, setGlobalTabManager] =
  createSignal<TabManager>();
