import { CommandState } from '@app/features/command';
import { activeViewSearch } from '@app/features/next-soup/soup-view/active-view-search';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  buildBrainWorkspacePath,
  getLastBrainWorkspaceSelection,
} from '@components/app/split-layout/brainWorkspaceRoute';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  ENABLE_CRM_FLAG,
  ENABLE_CRM_OVERRIDE,
} from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { openExternalUrl } from '@core/util/url';
import { getWebOrigin } from '@core/util/webOrigin';
import { useNavigate } from '@solidjs/router';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  TOP_BAR_SUB_APPS,
  TOP_BAR_VIEWS,
  type TopBarDestination,
  type TopBarDestinationId,
} from './topbar-destinations';
import { createTopBarUnreadCounts } from './topbar-unread';
import { registerTopBarViewHotkeys } from './topbar-view-hotkeys';

/** Ceiling on how long the chrome will answer with a press that never lands. */
const PENDING_VIEW_TIMEOUT_MS = 4000;

/**
 * Act on press instead of release, so the chrome responds the instant a
 * button goes down. The click handler still carries keyboard activation,
 * which reports `detail === 0` and never fires a preceding mousedown.
 */
export function pressHandlers(run: (event: MouseEvent) => void) {
  return {
    onMouseDown: (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      run(event);
    },
    onClick: (event: MouseEvent) => {
      if (event.detail !== 0) return;
      run(event);
    },
  };
}

/** Absolute app URL for a destination, for opening it in its own tab. */
function destinationUrl(destination: TopBarDestination) {
  return `${getWebOrigin()}/app${destination.path}`;
}

export type ViewChromeControllerOptions = {
  /** Analytics surface for this chrome, e.g. 'topbar' or 'sidebar_v4'. */
  surface: string;
};

/**
 * Everything V3-style app chrome does that isn't markup, shared between the
 * top bar and V4's sidebar: which view is active (with the optimistic
 * pressed-view answer while a heavy mount is in flight), navigation that
 * waits for the paint that shows it, the focused split's search, unread
 * badges, and the Tab/digit hotkeys. Call from component context; hotkeys
 * and timers dispose with the owner.
 */
export function createViewChromeController(
  options: ViewChromeControllerOptions
) {
  const analytics = useAnalytics();
  const crmFlag = useFeatureFlag(ENABLE_CRM_FLAG, {
    enabledOverride: ENABLE_CRM_OVERRIDE,
  });
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const unreadCounts = createTopBarUnreadCounts();

  const unreadCount = (destination: TopBarDestination) =>
    unreadCounts().get(destination.id) ?? 0;

  let searchInput: HTMLInputElement | undefined;

  /**
   * The focused split's own list search, which the chrome drives in place of
   * an in-view search bar. Absent for splits that have no list to filter — a
   * document, say — where the field falls back to opening the command menu.
   */
  const viewSearch = createMemo(() => activeViewSearch());

  // Assign rather than bind: writing only on a real difference keeps the
  // caret still while typing, and still refills the field when the active
  // split (and so the search behind it) changes.
  createEffect(() => {
    const next = viewSearch()?.text() ?? '';
    if (searchInput && searchInput.value !== next) searchInput.value = next;
  });

  const registerSearchInput = (element: HTMLInputElement) => {
    searchInput = element;
    onCleanup(() => {
      if (searchInput === element) searchInput = undefined;
    });
  };

  const searchHotkey = registerHotkey({
    hotkey: 'cmd+f',
    scopeId: 'global',
    description: 'Search this view',
    runWithInputFocused: true,
    // The field itself can be absent (a collapsed rail) — leave the key alone
    // then rather than swallowing it against nothing.
    condition: () => viewSearch() !== undefined && searchInput !== undefined,
    keyDownHandler: () => {
      searchInput?.focus();
      searchInput?.select();
      return true;
    },
  });
  onCleanup(searchHotkey.dispose);

  const activeContent = createMemo(() =>
    globalSplitManager()?.activeSplit()?.content()
  );

  /**
   * The view the chrome has committed to but the splits have not reached yet.
   * Mounting a view is heavy enough to be felt, and until it lands the split
   * manager still reports the old one — so the chrome answers with the press
   * and hands the question back to the real state as soon as the splits move.
   */
  const [pendingView, setPendingView] = createSignal<TopBarDestinationId>();
  let pendingFrom: { type: string; id: string } | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const clearPendingView = () => {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    pendingFrom = undefined;
    setPendingView(undefined);
  };

  const markPendingView = (destination: TopBarDestination) => {
    clearPendingView();
    const content = activeContent();
    pendingFrom = content && { type: content.type, id: content.id };
    setPendingView(destination.id);
    // A navigation that never lands must not leave the chrome pointing at a
    // view the splits never opened.
    pendingTimer = setTimeout(clearPendingView, PENDING_VIEW_TIMEOUT_MS);
  };

  onCleanup(clearPendingView);

  createEffect(() => {
    const content = activeContent();
    if (pendingView() === undefined) return;
    // Still on the view we pressed away from, so keep answering with the
    // press. Any other content means the splits moved — to the pressed view
    // or somewhere else entirely — and the real state is current again.
    if (
      content?.type === pendingFrom?.type &&
      content?.id === pendingFrom?.id
    ) {
      return;
    }
    clearPendingView();
  });

  const isActive = (destination: TopBarDestination) => {
    const pending = pendingView();
    if (pending !== undefined) return pending === destination.id;

    const content = activeContent();
    if (!content) return false;
    return (
      content.type === destination.content.type &&
      content.id === destination.content.id
    );
  };

  /**
   * Run the navigation only once the browser has painted the chrome's new
   * state. Solid would otherwise apply the marker and mount the new view in
   * the same tick, so neither reaches the screen until the mount finishes and
   * the press reads as ignored. Two frames is what it takes to know the first
   * paint landed; a newer press replaces an older queued one.
   */
  let queuedNavigation: number | undefined;

  const navigateAfterPaint = (task: () => void) => {
    if (queuedNavigation !== undefined) cancelAnimationFrame(queuedNavigation);
    queuedNavigation = requestAnimationFrame(() => {
      queuedNavigation = requestAnimationFrame(() => {
        queuedNavigation = undefined;
        task();
      });
    });
  };

  onCleanup(() => {
    if (queuedNavigation !== undefined) cancelAnimationFrame(queuedNavigation);
  });

  const isVisible = (destination: TopBarDestination) =>
    !destination.requiresCrmFlag || crmFlag().enabled;

  const visibleViews = () => TOP_BAR_VIEWS.filter(isVisible);
  const visibleSubApps = () => TOP_BAR_SUB_APPS.filter(isVisible);

  const openSearch = () => {
    analytics.track('sidebar_click', {
      surface: options.surface,
      view: 'search',
    });
    analytics.track('command_menu_open', {
      from: `${options.surface}_search`,
    });
    CommandState.open();
  };

  /** Primary views replace the active split; shift-click opens a new one. */
  const openView = (
    destination: TopBarDestination,
    viewOptions?: { newSplit?: boolean; surface?: string }
  ) => {
    const newSplit = viewOptions?.newSplit ?? false;
    const surface = viewOptions?.surface ?? options.surface;

    if (!newSplit && isActive(destination)) {
      globalSplitManager()?.returnFocus();
      return;
    }

    analytics.track('sidebar_click', { surface, view: destination.id });
    markPendingView(destination);

    navigateAfterPaint(() => {
      // Brain owns a route rather than a plain split, so replacing the active
      // split means navigating to it.
      if (destination.id === 'brain' && !newSplit) {
        navigate(buildBrainWorkspacePath(getLastBrainWorkspaceSelection()));
      } else {
        layout.openWithSplit(destination.content, {
          preferNewSplit: newSplit,
          mergeHistory: false,
          allowDuplicate: true,
          referredFrom: 'sidebar',
        });
      }
      globalSplitManager()?.returnFocus();
    });
  };

  const viewHotkeys = registerTopBarViewHotkeys({
    views: visibleViews,
    isActive,
    openView: (destination) =>
      openView(destination, { surface: `${options.surface}_hotkey` }),
  });
  onCleanup(() => {
    for (const registration of viewHotkeys) registration.dispose();
  });

  /**
   * Companion destinations always land in their own split — or focus the one
   * already showing them.
   */
  const openAsSplit = (destination: TopBarDestination) => {
    analytics.track('sidebar_click', {
      surface: options.surface,
      view: destination.id,
    });
    markPendingView(destination);

    navigateAfterPaint(() => {
      layout.openWithSplit(destination.content, {
        preferNewSplit: true,
        mergeHistory: false,
        allowDuplicate: false,
        referredFrom: 'sidebar',
      });
      globalSplitManager()?.returnFocus();
    });
  };

  const openInNewTab = (destination: TopBarDestination) => {
    analytics.track('sidebar_click', {
      surface: `${options.surface}_apps`,
      view: destination.id,
    });
    openExternalUrl(destinationUrl(destination));
  };

  return {
    viewSearch,
    registerSearchInput,
    unreadCount,
    isActive,
    visibleViews,
    visibleSubApps,
    openSearch,
    openView,
    openAsSplit,
    openInNewTab,
  };
}
