import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { useMobileSettings } from '@app/features/settings/context/mobile-settings';
import { routeParams, type SplitLocation } from '@app/lib/split-router';
import { paneRootMatch, paneRoute } from '@app/routes/app-route';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { activeTabId, setActiveTabId } from '@core/signal/settingsTab';
import { useNavigate } from '@solidjs/router';
import { createMemo, onCleanup } from 'solid-js';
import { settingsTabToSlug } from './settingsTabsConfig';

export type SettingsTab =
  | 'Calendar'
  | 'Booking links'
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
  | 'Connections'
  | 'Email'
  | 'GitHub'
  | 'Admin';

export const useSettingsState = () => {
  const mobileSettings = useMobileSettings();
  const { openWithSplit } = useSplitLayout();
  const navigate = useNavigate();
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    clearTimeout(focusTimer);
  });

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
      route: paneRoute({
        id: 'settings',
        params: { tab: settingsTabToSlug(tab) },
      }),
    },
  });

  const updateSettingsRoute = (tab: SettingsTab) => {
    const split = getSettingsSplit();

    if (!split) return;

    const slug = settingsTabToSlug(tab);
    const location = split.content.entryMetadata as SplitLocation | undefined;

    const showsSettings =
      location !== undefined &&
      paneRootMatch(location.route)?.id === 'settings';
    const showsTab = routeParams(location?.route).tab === slug;
    if (showsSettings && showsTab) return;

    globalSplitManager()
      ?.getSplit(split.id)
      ?.updateCurrentEntry((content) => ({
        ...content,
        entryMetadata: settingsContent(tab).entryMetadata,
      }));
  };

  const focusSettingsPanel = () => {
    if (isTouchDevice() || disposed) return;
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      focusTimer = undefined;
      const settingsSplit = getSettingsSplit();

      if (!settingsSplit) return;

      const settingsPanel = document.querySelector<HTMLElement>(
        `[data-split-id="${settingsSplit.id}"] [data-settings-panel]`
      );

      settingsPanel?.focus({ preventScroll: true });
    }, 10);
  };

  // Mobile opens an in-place settings sheet; a fresh open lands on its index.
  // Desktop treats settings like any other sidebar view: an already-open
  // settings split is retargeted and brought forward, otherwise settings opens
  // in the active split, defaulting to Account.
  const openSettings = (tab?: SettingsTab) => {
    if (isMobile()) {
      mobileSettings.openSettings(tab);

      return;
    }

    const nextTab = tab ?? 'Account';
    setActiveTabId(nextTab);

    const settingsSplit = getSettingsSplit();
    if (settingsSplit) {
      updateSettingsRoute(nextTab);
      globalSplitManager()?.activateSplit(settingsSplit.id);
      focusSettingsPanel();
      return;
    }

    openWithSplit(settingsContent(nextTab), {
      allowDuplicate: false,
      mergeHistory: false,
    });
    focusSettingsPanel();
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

  // Opt-in: open settings in a new split beside the current one.
  const openSettingsInSplit = (activeTabId?: SettingsTab) => {
    if (isMobile()) {
      openSettings(activeTabId);

      return;
    }

    if (activeTabId) setActiveTabId(activeTabId);

    const tab = activeTabId ?? 'Account';

    openWithSplit(settingsContent(tab), {
      activate: true,
      // Single settings split only: getSettingsSplit assumes at most one
      // exists, so reuse an existing one instead of duplicating.
      allowDuplicate: false,
      preferNewSplit: true,
      mergeHistory: false,
    });
    focusSettingsPanel();
  };

  // A settings split shared with others is dismissed; a sole one steps back to
  // whatever the user had open before, like any other view.
  const closeSettings = () => {
    if (isMobile()) {
      mobileSettings.close();
      return;
    }

    const settingsSplit = getSettingsSplit();
    const manager = globalSplitManager();
    if (!settingsSplit || !manager) return;

    if (manager.splits().length > 1) {
      manager.removeSplit(settingsSplit.id);
      return;
    }

    const handle = manager.getSplit(settingsSplit.id);
    if (handle?.canGoBack()) {
      handle.goBack();
      return;
    }

    navigate(DEFAULT_ROUTE, { replace: true });
  };

  // Focus-aware toggle: bring settings to the user rather than destroying it,
  // and only close when settings is what they're actually looking at.
  const toggleSettings = () => {
    if (isMobile()) {
      if (mobileSettings.open()) mobileSettings.close();
      else openSettings();

      return;
    }
    const settingsSplit = getSettingsSplit();
    if (settingsSplit) {
      const manager = globalSplitManager();
      // Open but not active: bring settings forward. Otherwise close it.
      if (manager && manager.activeSplitId() !== settingsSplit.id) {
        manager.activateSplit(settingsSplit.id);
        focusSettingsPanel();
        return;
      }
      closeSettings();
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
    // Undefined represents the mobile settings index.
    activeTabId: () => (isMobile() ? mobileSettings.page() : activeTabId()),
    toggleSettings,
  };
};
