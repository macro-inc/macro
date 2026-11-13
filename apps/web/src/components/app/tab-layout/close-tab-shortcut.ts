import { globalTabManager } from '@app/signal/tabLayout';
import { fireAndForget } from '@core/util/fireAndForget';
import { isDesktopPlatform } from '@core/util/platform';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { onCleanup } from 'solid-js';
import type { TabManager } from './tab-manager';

/**
 * Emitted by the native File > Close Tab menu item (Cmd+W) in
 * `tauri/src-tauri/src/desktop/app_menu.rs`; keep the names in sync.
 */
const CLOSE_TAB_EVENT = 'desktop-close-tab';
const SURFACE = 'desktop-close-tab';

/**
 * Cmd+W, as in a browser: closes the active tab, or the window when no other
 * tab is open or tabs are off, since the tab model never closes its last tab.
 */
export function closeTabOrWindow(
  tabManager: TabManager | undefined,
  closeWindow: () => Promise<void>
): void {
  if (tabManager && tabManager.tabs().length > 1) {
    tabManager.closeTab(tabManager.activeTabId());
    return;
  }

  fireAndForget(closeWindow(), SURFACE);
}

/**
 * Handles the native Close Tab menu item. The app menu owns Cmd+W on macOS,
 * so the key never reaches a page hotkey; the native item forwards it here.
 */
export function useCloseTabShortcut(): void {
  if (!isDesktopPlatform()) return;

  const window = getCurrentWebviewWindow();
  const unlisten = window.listen(CLOSE_TAB_EVENT, () => {
    closeTabOrWindow(globalTabManager(), () => window.close());
  });
  onCleanup(() => fireAndForget(stopListening(unlisten), SURFACE));
}

async function stopListening(unlisten: Promise<UnlistenFn>): Promise<void> {
  const stop = await unlisten;
  // UnlistenFn returns the unlisten IPC promise despite its void type.
  fireAndForget(stop(), SURFACE);
}
