import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { toBaseRelative } from '@app/constants/routerBase';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { activeTabId, setActiveTabId } from '@core/signal/settingsTab';
import { useLocation, useNavigate } from '@solidjs/router';
import { createMemo, createSignal } from 'solid-js';
import {
  appendSettingsSplitToUrl,
  stripSettingsSplitFromUrl,
} from './settingsSplitUrl';
import { settingsSlugToTab, settingsTabToSlug } from './settingsTabsConfig';

export type SettingsTab =
  | 'Account'
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
// and hash — so layout state carried outside the path (notably the `preview`
// param encoding Controller/Viewer Preview Pairs) survives the round trip.
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
 * Extract the active settings tab from a docked-split path
 * (`.../settings/<slug>`), or undefined if the path has no settings split.
 * Scans type positions (even indices, base stripped) so a block id that happens
 * to be "settings" isn't mistaken for one — mirrors
 * {@link stripSettingsSplitFromUrl}.
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
  const { openWithSplit, replaceAllSplits } = useSplitLayout();
  const navigate = useNavigate();
  const location = useLocation();

  const getSettingsSplit = () => {
    const splitManager = globalSplitManager();
    if (!splitManager) return undefined;
    return splitManager.splits().find((split) => {
      const content = split.content;
      return content.type === 'component' && content.id === 'settings';
    });
  };

  const splitOpen = createMemo(() => getSettingsSplit() !== undefined);

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

  // Capture the current layout (minus any settings split) as where "Back to
  // app"/"Move to split" should return to, then clobber every other split so
  // settings becomes the sole one. Shared by opening settings fresh and by
  // collapsing a docked-alongside layout back down to solo. The query and hash
  // are captured too: the `preview` param is what links Controller/Viewer
  // Preview Pairs, so returning to the path alone would sever them.
  const collapseToSoloSettings = (tab: SettingsTab) => {
    setSettingsReturnTo(
      stripSettingsSplitFromUrl(
        `${toBaseRelative(location.pathname)}${location.search}${location.hash}`
      )
    );
    setActiveTabId(tab);
    replaceAllSplits({ type: 'component', id: 'settings' });
  };

  // Default activation. On mobile, dock settings into the split layout so it
  // inherits the split navigation chrome (back button, swipe-back gesture) —
  // the solo-settings chrome's exit affordances all live in desktop-only UI.
  // On desktop, clobber down to a lone settings split, remembering where we
  // came from so "Back to app" can return there. Opening without a specific
  // tab always lands on Account rather than the last-viewed page — a fresh
  // open shouldn't resume a prior session's tab. Re-invoking while settings
  // is already showing (solo or docked alongside other splits) just switches
  // the tab rather than re-clobbering the layout.
  const openSettings = (tab?: SettingsTab) => {
    if (isMobile()) {
      openSettingsInSplit(tab ?? 'Account');
      return;
    }
    if (splitOpen()) {
      setActiveTabId(tab ?? 'Account');
      return;
    }
    collapseToSoloSettings(tab ?? 'Account');
  };

  // Switch the active settings page. The split's URL segment is derived
  // reactively from `activeTabId` (see `contentUrlSegments`), so the
  // layout's bidirectional URL sync reflects this automatically — no
  // explicit navigation needed, whether settings is solo or docked alongside
  // other splits.
  const selectTab = (tab: SettingsTab) => {
    setActiveTabId(tab);
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
    if (isSoloSettings()) {
      navigate(settingsReturnTo() ?? DEFAULT_ROUTE, { replace: true });
      return;
    }
    removeSettingsSplit();
  };

  // Dock settings alongside the layout we came from: rebuild that layout and
  // add settings back as a `settings/<tab>` split. Navigating straight to the
  // composed path (rather than mutating splits directly) lets the URL→layout
  // sync rebuild everything in one pass.
  const moveSettingsToSplit = (tab?: SettingsTab) => {
    if (tab) setActiveTabId(tab);
    // Strip any settings split already in the target layout before re-adding
    // one, so repeatedly toggling fullscreen ⇄ split reuses a single settings
    // split (on the current tab) instead of stacking a new one each cycle.
    // The return layout's query/hash ride along — appending settings at the
    // end keeps `preview` indices valid — so its Preview Pairs re-link when
    // the URL sync rebuilds the layout.
    const returnTo = stripSettingsSplitFromUrl(
      settingsReturnTo() ?? DEFAULT_ROUTE
    );
    navigate(
      appendSettingsSplitToUrl(returnTo, settingsTabToSlug(activeTabId()))
    );
  };

  // Collapse a docked-alongside layout back down to a lone settings split.
  // The return layout is the current path minus the settings split, so "Back
  // to app" / "Move to split" land correctly.
  const moveSettingsToSolo = (tab?: SettingsTab) => {
    collapseToSoloSettings(tab ?? activeTabId());
  };

  // Focus-aware toggle: bring settings to the user rather than destroying it,
  // and only close when settings is what they're actually looking at.
  const toggleSettings = () => {
    // Solo takes priority: if it's the only thing showing, leave it.
    if (isSoloSettings()) {
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

    // Nothing open → open settings (solo split on desktop, docked on mobile).
    openSettings();
  };

  return {
    settingsOpen: splitOpen,
    openSettings,
    openSettingsInSplit,
    selectTab,
    closeSettings,
    moveSettingsToSplit,
    moveSettingsToSolo,
    activeTabId,
    setActiveTabId,
    toggleSettings,
  };
};
