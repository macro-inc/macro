import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import type { SplitRouter } from '@app/lib/split-router';
import { globalTabManager, setGlobalTabManager } from '@app/signal/tabLayout';
import { enableDesktopTabs } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isPlatform } from '@core/util/platform';
import { type as osType } from '@tauri-apps/plugin-os';
import { onCleanup, Show } from 'solid-js';
import { installOpenInNewTabIntentTracker } from './open-in-tab-intent';
import {
  createTabManager,
  type TabLayoutHost,
  type TabManager,
} from './tab-manager';

/** Whether this build can show desktop tabs; the flag still decides per user. */
export function desktopTabsSupported(): boolean {
  return isPlatform('desktop') && osType() === 'macos';
}

function registerTabHotkeys(tabManager: TabManager) {
  registerHotkey({
    hotkeyToken: TOKENS.tabs.new,
    hotkey: 'cmd+t',
    scopeId: 'global',
    description: () => t('tabs.newTab'),
    keyDownHandler: () => {
      tabManager.newTab();
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.tabs.close,
    hotkey: 'shift+cmd+w',
    scopeId: 'global',
    description: () => t('tabs.closeTab'),
    condition: () => tabManager.tabs().length > 1,
    keyDownHandler: () => {
      tabManager.closeTab(tabManager.activeTabId());
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.tabs.next,
    hotkey: 'ctrl+tab',
    scopeId: 'global',
    description: () => t('tabs.nextTab'),
    condition: () => tabManager.tabs().length > 1,
    keyDownHandler: () => {
      tabManager.activateNextTab(1);
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.tabs.previous,
    hotkey: 'ctrl+shift+tab',
    scopeId: 'global',
    description: () => t('tabs.previousTab'),
    condition: () => tabManager.tabs().length > 1,
    keyDownHandler: () => {
      tabManager.activateNextTab(-1);
      return true;
    },
    runWithInputFocused: true,
  });

  // Browser-style arrows. Skipped while typing, where shift+cmd+arrow selects
  // to the line edge.
  registerHotkey({
    hotkey: 'shift+cmd+arrowright',
    scopeId: 'global',
    description: () => t('tabs.nextTab'),
    condition: () => tabManager.tabs().length > 1,
    keyDownHandler: () => {
      tabManager.activateNextTab(1);
      return true;
    },
    runWithInputFocused: false,
    hide: true,
  });

  registerHotkey({
    hotkey: 'shift+cmd+arrowleft',
    scopeId: 'global',
    description: () => t('tabs.previousTab'),
    condition: () => tabManager.tabs().length > 1,
    keyDownHandler: () => {
      tabManager.activateNextTab(-1);
      return true;
    },
    runWithInputFocused: false,
    hide: true,
  });
}

function TabsOwner(props: {
  router: SplitRouter;
  manager: TabLayoutHost;
  userId: string;
}) {
  const tabManager = createTabManager({
    router: props.router,
    manager: props.manager,
    userId: props.userId,
  });
  setGlobalTabManager(tabManager);
  // A shell switch can mount the next owner before this one is disposed.
  onCleanup(() => {
    if (globalTabManager() === tabManager) setGlobalTabManager(undefined);
  });
  onCleanup(installOpenInNewTabIntentTracker());
  registerTabHotkeys(tabManager);

  return null;
}

/**
 * Owns the desktop tab manager while tabs are enabled. Mounted by the split
 * layout provider and by full-screen pages that keep the title bar (calls);
 * tab state is per user and resets on account changes.
 */
export function DesktopTabsController(props: {
  router: SplitRouter;
  manager: TabLayoutHost;
}) {
  const flag = useFeatureFlag(enableDesktopTabs);
  const userId = useUserId();
  const enabled = () => desktopTabsSupported() && flag().enabled;

  return (
    <Show when={enabled() ? userId() : undefined} keyed>
      {(uid) => (
        <TabsOwner router={props.router} manager={props.manager} userId={uid} />
      )}
    </Show>
  );
}

/** A page without a split layout: tabs keep their stored titles and focus. */
export const NO_SPLITS_TAB_HOST: TabLayoutHost = {
  tabTitle: () => undefined,
  activeSplitId: () => undefined,
  getSplit: () => undefined,
  splits: () => [],
  activateSplit: () => {},
};
