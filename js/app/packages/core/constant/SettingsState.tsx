import { useSplitLayout } from '@app/component/split-layout/layout';
import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { globalSplitManager } from '@app/signal/splitLayout';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { activeTabId, setActiveTabId } from '@core/signal/settingsTab';
import { useLocation, useNavigate } from '@solidjs/router';
import { createMemo, createSignal } from 'solid-js';
import { isSettingsPath, SETTINGS_PATH, toBaseRelative } from './settingsPath';
import { settingsSlugToTab, settingsTabToSlug } from './settingsTabsConfig';

export { isSettingsPath };

export type SettingsTab =
  | 'Account'
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
  | 'Team'
  | 'Connected'
  | 'Email'
  | 'GitHub'
  | 'Admin';

// Where "Back to app" (and move-to-split) should return to: the layout the user
// was on when they opened settings. Undefined when settings was deep-linked, in
// which case we fall back to DEFAULT_ROUTE.
const [settingsReturnTo, setSettingsReturnTo] = createSignal<string>();

const settingsPathFor = (tab: SettingsTab) =>
  `${SETTINGS_PATH}/${settingsTabToSlug(tab)}`;

/**
 * Drop a settings split from a split-layout path, if present. Handles both the
 * URL encoding (`settings/<tab>`) and the legacy internal form
 * (`component/settings`). Only type positions (even indices) are inspected so a
 * block id that happens to be "settings" isn't mistaken for one.
 */
const stripSettingsSplit = (pathname: string) => {
  const segments = pathname.split('/').filter(Boolean);
  for (let i = 0; i + 1 < segments.length; i += 2) {
    const type = segments[i];
    if (
      type === 'settings' ||
      (type === 'component' && segments[i + 1] === 'settings')
    ) {
      segments.splice(i, 2);
      break;
    }
  }
  return segments.length ? `/${segments.join('/')}` : DEFAULT_ROUTE;
};

/**
 * Extract the active settings tab from a docked-split path
 * (`.../settings/<slug>`), or undefined if the path has no settings split.
 * Scans type positions (even indices, base stripped) so a block id that happens
 * to be "settings" isn't mistaken for one — mirrors {@link stripSettingsSplit}.
 */
export const settingsTabFromSplitPath = (
  pathname: string
): SettingsTab | undefined => {
  const segments = toBaseRelative(pathname).split('/').filter(Boolean);
  for (let i = 0; i + 1 < segments.length; i += 2) {
    if (segments[i] === 'settings') return settingsSlugToTab(segments[i + 1]);
  }
  return undefined;
};

export const useSettingsState = () => {
  const { openWithSplit } = useSplitLayout();
  const navigate = useNavigate();
  const location = useLocation();

  const isOnSettingsRoute = () => isSettingsPath(location.pathname);

  const getSettingsSplit = () => {
    const splitManager = globalSplitManager();
    if (!splitManager) return undefined;
    return splitManager.splits().find((split) => {
      const content = split.content;
      return content.type === 'component' && content.id === 'settings';
    });
  };

  const splitOpen = createMemo(() => getSettingsSplit() !== undefined);

  // Settings are considered open whether shown as the full-page route or docked
  // in a split.
  const isOpen = createMemo(() => isOnSettingsRoute() || splitOpen());

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

  // Default activation. On mobile, dock settings into the split layout so it
  // inherits the split navigation chrome (back button, swipe-back gesture) —
  // the full-page route's exit affordances all live in desktop-only UI. On
  // desktop, navigate to the settings route, remembering where we came from so
  // "Back to app" can return there. Opening without a specific tab always
  // lands on Account rather than the last-viewed page — a fresh open shouldn't
  // resume a prior session's tab.
  const openSettings = (tab?: SettingsTab) => {
    if (isMobile()) {
      openSettingsInSplit(tab ?? 'Account');
      return;
    }
    if (!isOnSettingsRoute()) {
      setSettingsReturnTo(toBaseRelative(location.pathname));
    }
    navigate(settingsPathFor(tab ?? 'Account'));
  };

  // Switch the active settings page. On the route this is a URL change (so the
  // page is reflected/shareable); in a split it's just the in-memory signal.
  const selectTab = (tab: SettingsTab) => {
    if (isOnSettingsRoute()) {
      navigate(settingsPathFor(tab), { replace: true });
    } else {
      setActiveTabId(tab);
    }
  };

  // Opt-in: dock settings into the split layout (the pre-route behavior).
  const openSettingsInSplit = (activeTabId?: SettingsTab) => {
    if (activeTabId) setActiveTabId(activeTabId);
    openWithSplit(
      { type: 'component', id: 'settings' },
      {
        activate: true,
        // Single settings split only: getSettingsSplit/removeSettingsSplit
        // assume one exists, so reuse an existing one instead of duplicating.
        allowDuplicate: false,
        preferNewSplit: true,
        mergeHistory: false,
      }
    );
    focusSettingsPanel();
  };

  const removeSettingsSplit = () => {
    const settingsSplit = getSettingsSplit();
    if (settingsSplit) {
      globalSplitManager()?.removeSplit(settingsSplit.id);
    }
  };

  const closeSettings = () => {
    if (isOnSettingsRoute()) {
      navigate(settingsReturnTo() ?? DEFAULT_ROUTE, { replace: true });
      return;
    }
    removeSettingsSplit();
  };

  // Promote the route into the split layout: rebuild the layout we came from and
  // dock settings into it as a `settings/<tab>` pair. Navigating straight to the
  // composed path avoids racing the split manager's mount.
  const moveSettingsToSplit = (tab?: SettingsTab) => {
    if (tab) setActiveTabId(tab);
    // Strip any settings split already in the target layout before re-adding
    // one, so repeatedly toggling fullscreen ⇄ split reuses a single settings
    // split (on the current tab) instead of stacking a new one each cycle.
    const base = stripSettingsSplit(
      settingsReturnTo() ?? DEFAULT_ROUTE
    ).replace(/\/$/, '');
    navigate(`${base}/settings/${settingsTabToSlug(activeTabId())}`);
  };

  // Pop the docked split back out into the full-page route. The return layout is
  // the current path minus the settings split, so "Back to app" lands correctly.
  const moveSettingsToFullscreen = (tab?: SettingsTab) => {
    if (tab) setActiveTabId(tab);
    setSettingsReturnTo(stripSettingsSplit(toBaseRelative(location.pathname)));
    navigate(settingsPathFor(tab ?? activeTabId()));
  };

  // Focus-aware toggle: bring settings to the user rather than destroying it,
  // and only close when settings is what they're actually looking at.
  const toggleSettings = () => {
    // Route takes priority: if it's the current page, leave it.
    if (isOnSettingsRoute()) {
      closeSettings();
      return;
    }

    const settingsSplit = getSettingsSplit();
    if (settingsSplit) {
      const manager = globalSplitManager();
      // Docked but not the active split → bring focus to it instead of closing.
      if (manager && manager.activeSplitId() !== settingsSplit.id) {
        manager.activateSplit(settingsSplit.id);
        focusSettingsPanel();
        return;
      }
      // Docked and already focused → close it.
      manager?.removeSplit(settingsSplit.id);
      return;
    }

    // Nothing open → open settings (route on desktop, docked split on mobile).
    openSettings();
  };

  return {
    settingsOpen: isOpen,
    settingsSplitOpen: splitOpen,
    openSettings,
    openSettingsInSplit,
    selectTab,
    closeSettings,
    moveSettingsToSplit,
    moveSettingsToFullscreen,
    activeTabId,
    setActiveTabId,
    toggleSettings,
  };
};
