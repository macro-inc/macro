import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { toBaseRelative } from '@app/constants/routerBase';
import { useMobileSettings } from '@app/features/settings/context/mobile-settings';
import {
  rootRouteMatch,
  routeParams,
  type SplitLocation,
} from '@app/lib/split-router';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { activeTabId, setActiveTabId } from '@core/signal/settingsTab';
import { useLocation, useNavigate } from '@solidjs/router';
import { createMemo, createSignal } from 'solid-js';
import { settingsTabToSlug } from './settingsTabsConfig';

export type SettingsTab =
  | 'Account'
  | 'API Keys'
  | 'Notifications'
  | 'Billing'
  | 'Subscription'
  | 'Organization'
  | 'Appearance'
  | 'Mobile'
  | 'AI Memory'
  | 'Inbox'
  | 'Shortcuts'
  | 'Mobile App'
  | 'Agent'
  | 'Agents'
  | 'Harness'
  | 'Bots'
  | 'Team'
  | 'Tags'
  | 'CRM'
  | 'Connected'
  | 'Email'
  | 'GitHub'
  | 'Admin';

// Where "Back to app" (and move-to-split) should return to: the layout the user
// was on when they opened settings. A full base-relative URL — path plus query
// and hash — so content locations survive the round trip.
// Undefined when settings was deep-linked, in which case we fall back to
// DEFAULT_ROUTE.
const [settingsReturnTo, setSettingsReturnTo] = createSignal<string>();

/**
 * Re-seed {@link settingsReturnTo} after a full page load has wiped it. The
 * Gmail consent round trip tears the app down, so the add-inbox flow captures
 * this alongside the layout it left from and the callback hands it back — the
 * user returns to solo settings with "Back to app" still pointing at the
 * layout they had before they opened settings.
 */
export const restoreSettingsReturnTo = (url: string) => {
  setSettingsReturnTo(url);
};

/** Read-only view of {@link settingsReturnTo} for capture across a reload. */
export const currentSettingsReturnTo = settingsReturnTo;

/**
 * Whether settings is the only visible split — the "clobbered" mode that
 * looks and behaves like the old fullscreen route (app sidebar hidden,
 * settings owns its own back/move-to-split affordances). Mobile is excluded:
 * its swipe layout always reports a visible count of 1 for the active split
 * (the backgrounded split is excluded from that count), which would
 * otherwise misidentify every mobile settings-open as "solo".
 */
export const isSoloSettings = () => {
  if (isMobile()) return false;

  const splitManager = globalSplitManager();

  if (!splitManager) return false;

  // Derive the sole split from the visible set (not `splits()[0]`) so the
  // count check and the identity check agree even if an exclusion filter ever
  // hides a split ahead of settings.
  const visible = splitManager.getVisibleSplits();

  if (visible.length !== 1) return false;

  const [sole] = visible;

  return sole?.content.type === 'component' && sole.content.id === 'settings';
};

export const useSettingsState = () => {
  const mobileSettings = useMobileSettings();
  const { openWithSplit } = useSplitLayout();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUrl = () =>
    `${toBaseRelative(location.pathname)}${location.search}${location.hash}`;

  const getSettingsSplit = () => {
    const splitManager = globalSplitManager();

    if (!splitManager) return undefined;

    return splitManager.splits().find((split) => {
      const content = split.content;

      return content.type === 'component' && content.id === 'settings';
    });
  };

  const splitOpen = createMemo(() => getSettingsSplit() !== undefined);

  const settingsContent = (tab: SettingsTab) => ({
    type: 'component' as const,
    id: 'settings' as const,
    entryMetadata: {
      route: {
        matches: [
          {
            id: 'settings',
            params: { tab: settingsTabToSlug(tab) },
          },
        ],
      },
    },
  });

  const updateSettingsRoute = (tab: SettingsTab) => {
    const split = getSettingsSplit();

    if (!split) return;

    const slug = settingsTabToSlug(tab);
    const location = split.content.entryMetadata as SplitLocation | undefined;

    if (
      rootRouteMatch(location?.route)?.id === 'settings' &&
      routeParams(location?.route).tab === slug
    ) {
      return;
    }

    globalSplitManager()
      ?.getSplit(split.id)
      ?.updateCurrentEntry((content) => ({
        ...content,
        entryMetadata: settingsContent(tab).entryMetadata,
      }));
  };

  const focusSettingsPanel = () => {
    if (isTouchDevice()) return;
    setTimeout(() => {
      const settingsSplit = getSettingsSplit();

      if (!settingsSplit) return;

      const settingsPanel = document.querySelector<HTMLElement>(
        `[data-split-id="${settingsSplit.id}"] [data-settings-panel]`
      );

      settingsPanel?.focus({ preventScroll: true });
    }, 10);
  };

  // The standalone settings URL is a normal history entry. Browser Back
  // restores the exact docked layout (if there was one).
  const collapseToSoloSettings = (tab: SettingsTab) => {
    if (!splitOpen()) setSettingsReturnTo(currentUrl());
    setActiveTabId(tab);
    navigate(`/settings/${settingsTabToSlug(tab)}`);
  };

  // Mobile opens an in-place settings sheet; a fresh open lands on its index.
  // Desktop keeps the solo/split layout and defaults to Account.
  const openSettings = (tab?: SettingsTab) => {
    if (isMobile()) {
      mobileSettings.openSettings(tab);

      return;
    }

    if (splitOpen()) {
      const nextTab = tab ?? 'Account';
      setActiveTabId(nextTab);
      updateSettingsRoute(nextTab);
      return;
    }

    collapseToSoloSettings(tab ?? 'Account');
  };

  // Mobile selection belongs to the sheet, including while it is closed.
  // Routed panels supply navigation so the router owns the entry/history write.
  // Other entry points retain the legacy manager path until they are migrated.
  const selectTab = (
    tab: SettingsTab,
    navigateTab?: (tab: SettingsTab) => void
  ) => {
    if (isMobile()) {
      mobileSettings.selectPage(tab);

      return;
    }

    if (navigateTab) {
      navigateTab(tab);
      return;
    }

    setActiveTabId(tab);
    updateSettingsRoute(tab);
  };

  // Opt-in: dock settings into the split layout (the pre-route behavior).
  const openSettingsInSplit = (activeTabId?: SettingsTab) => {
    if (isMobile()) {
      openSettings(activeTabId);

      return;
    }

    if (activeTabId) setActiveTabId(activeTabId);

    const tab = activeTabId ?? 'Account';
    if (!splitOpen()) setSettingsReturnTo(currentUrl());

    openWithSplit(settingsContent(tab), {
      activate: true,
      // Single settings split only: getSettingsSplit/removeSettingsSplit
      // assume one exists, so reuse an existing one instead of duplicating.
      allowDuplicate: false,
      preferNewSplit: true,
      mergeHistory: false,
    });
    focusSettingsPanel();
  };

  const removeSettingsSplit = () => {
    const settingsSplit = getSettingsSplit();
    if (settingsSplit) globalSplitManager()?.removeSplit(settingsSplit.id);
    setSettingsReturnTo(undefined);
  };

  const closeSettings = () => {
    if (isMobile()) {
      mobileSettings.close();
      return;
    }

    if (isSoloSettings()) {
      const returnTo = settingsReturnTo() ?? DEFAULT_ROUTE;
      setSettingsReturnTo(undefined);
      navigate(returnTo, { replace: true });
      return;
    }

    removeSettingsSplit();
  };

  // Restore the layout from before settings opened, then dock the current tab.
  // The layout manager owns URL serialization for the new settings pane.
  const moveSettingsToSplit = async (tab?: SettingsTab) => {
    const currentTab = tab ?? activeTabId();
    setActiveTabId(currentTab);
    await navigate(settingsReturnTo() ?? DEFAULT_ROUTE, { replace: true });
    globalSplitManager()?.openWithSplit(settingsContent(currentTab), {
      activate: true,
      allowDuplicate: false,
      preferNewSplit: true,
      mergeHistory: false,
    });
    focusSettingsPanel();
  };

  // Fullscreen has its own URL; browser Back restores the docked layout.
  const moveSettingsToSolo = (tab?: SettingsTab) => {
    collapseToSoloSettings(tab ?? activeTabId());
  };

  // Focus-aware toggle: bring settings to the user rather than destroying it,
  // and only close when settings is what they're actually looking at.
  const toggleSettings = () => {
    if (isMobile()) {
      if (mobileSettings.open()) mobileSettings.close();
      else openSettings();

      return;
    }
    // Solo takes priority: if it's the only thing showing, leave it.
    if (isSoloSettings()) {
      closeSettings();

      return;
    }

    const settingsSplit = getSettingsSplit();
    if (settingsSplit) {
      const manager = globalSplitManager();
      // Docked but not active: bring settings forward. Otherwise minimize it.
      if (manager && manager.activeSplitId() !== settingsSplit.id) {
        manager.activateSplit(settingsSplit.id);
        focusSettingsPanel();
        return;
      }
      removeSettingsSplit();
      return;
    }

    openSettings();
  };

  const restoreMobileDeepLink = () => {
    const manager = globalSplitManager();
    const split = getSettingsSplit();
    if (!manager || !split || manager.splits().length === 1) {
      navigate(DEFAULT_ROUTE, { replace: true });
      return;
    }
    manager.removeSplit(split.id);
  };

  return {
    settingsOpen: () => (isMobile() ? mobileSettings.open() : splitOpen()),
    openSettings,
    openSettingsInSplit,
    selectTab,
    restoreMobileDeepLink,
    closeSettings,
    moveSettingsToSplit,
    moveSettingsToSolo,
    // Undefined represents the mobile settings index.
    activeTabId: () => (isMobile() ? mobileSettings.page() : activeTabId()),
    toggleSettings,
  };
};
