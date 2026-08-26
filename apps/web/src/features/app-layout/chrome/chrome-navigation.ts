import { CommandState } from '@app/features/command';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  buildBrainWorkspacePath,
  getLastBrainWorkspaceSelection,
} from '@components/app/split-layout/brainWorkspaceRoute';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import {
  ENABLE_CRM_FLAG,
  ENABLE_CRM_OVERRIDE,
} from '@core/constant/featureFlags';
import { openExternalUrl } from '@core/util/url';
import { getWebOrigin } from '@core/util/webOrigin';
import { useNavigate } from '@solidjs/router';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  CHROME_SUB_APPS,
  CHROME_VIEWS,
  type ChromeDestination,
  type ChromeDestinationId,
} from './chrome-destinations';

/** Ceiling on how long a bar will answer with a press that never lands. */
const PENDING_VIEW_TIMEOUT_MS = 4000;

/**
 * What pressing a view in the bar's row does.
 *
 * `page` treats the row as a set of places: the view becomes the whole page,
 * whatever was open stays reachable elsewhere, and a view never swaps itself
 * into someone else's split. `split` is the older reading, where the row acts
 * on the focused split and leaves the rest of the layout standing.
 */
export type ChromeViewBehavior = 'page' | 'split';

export type ChromeNavigationOptions = {
  /** Names the bar in analytics. */
  surface: string;
  views: ChromeViewBehavior;
};

/**
 * The splits standing on their own. A Preview Pair's Viewer is the
 * Controller's reading pane rather than something opened beside it, so it is
 * never one of these.
 */
export function standaloneSplits(): SplitHandle[] {
  const manager = globalSplitManager();
  if (!manager) return [];
  return manager
    .splits()
    .map((split) => manager.getSplit(split.id))
    .filter((handle) => handle !== undefined)
    .filter((handle) => !handle.isViewerSplit());
}

const isSameContent = (
  a: { type: string; id: string },
  b: { type: string; id: string }
) => a.type === b.type && a.id === b.id;

/**
 * Act on press instead of release, so a bar responds the instant a button goes
 * down. The click handler still carries keyboard activation, which reports
 * `detail === 0` and never fires a preceding mousedown.
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
export function destinationUrl(destination: ChromeDestination) {
  return `${getWebOrigin()}/app${destination.path}`;
}

/**
 * Runs a task only once the browser has painted what the press just marked.
 * Solid would otherwise apply the marker and mount the new content in the same
 * tick, so neither reaches the screen until the mount finishes and the press
 * reads as ignored. Two frames is what it takes to know the first paint
 * landed; a newer press replaces an older queued one. Cancels on dispose.
 */
export function createAfterPaintRunner() {
  let queued: number | undefined;

  onCleanup(() => {
    if (queued !== undefined) cancelAnimationFrame(queued);
  });

  return (task: () => void) => {
    if (queued !== undefined) cancelAnimationFrame(queued);
    queued = requestAnimationFrame(() => {
      queued = requestAnimationFrame(() => {
        queued = undefined;
        task();
      });
    });
  };
}

export type ChromeNavigation = ReturnType<typeof createChromeNavigation>;

/**
 * Everything an app chrome bar does apart from drawing itself: which views it
 * shows, which one it reads as active, and how a press reaches the splits.
 * Shared by the layouts that replace the sidebar with a bar, so the top bar
 * and the bottom dock differ only in their markup and in how their row of
 * views behaves (see `ChromeViewBehavior`).
 */
export function createChromeNavigation(options: ChromeNavigationOptions) {
  const surface = options.surface;
  const analytics = useAnalytics();
  const crmFlag = useFeatureFlag(ENABLE_CRM_FLAG, {
    enabledOverride: ENABLE_CRM_OVERRIDE,
  });
  const layout = useSplitLayout();
  const navigate = useNavigate();

  const activeContent = createMemo(() =>
    globalSplitManager()?.activeSplit()?.content()
  );

  /**
   * The view the bar has committed to but the splits have not reached yet.
   * Mounting a view is heavy enough to be felt, and until it lands the split
   * manager still reports the old one — so the bar answers with the press and
   * hands the question back to the real state as soon as the splits move.
   */
  const [pendingView, setPendingView] = createSignal<ChromeDestinationId>();
  let pendingFrom: { type: string; id: string } | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const clearPendingView = () => {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    pendingFrom = undefined;
    setPendingView(undefined);
  };

  const markPendingView = (destination: ChromeDestination) => {
    clearPendingView();
    const content = activeContent();
    pendingFrom = content && { type: content.type, id: content.id };
    setPendingView(destination.id);
    // A navigation that never lands must not leave the bar pointing at a view
    // the splits never opened.
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

  const isActive = (destination: ChromeDestination) => {
    const pending = pendingView();
    if (pending !== undefined) return pending === destination.id;

    if (options.views === 'page') {
      // A place is where you are only while it is the whole page. With
      // anything else open you are in that instead, and the bar says so
      // elsewhere rather than lighting up a view you are merely beside.
      const splits = standaloneSplits();
      if (splits.length !== 1) return false;
      return isSameContent(splits[0]!.content(), destination.content);
    }

    const content = activeContent();
    if (!content) return false;
    return isSameContent(content, destination.content);
  };

  /** Navigate only once the bar's new state has reached the screen. */
  const navigateAfterPaint = createAfterPaintRunner();

  const isVisible = (destination: ChromeDestination) =>
    !destination.requiresCrmFlag || crmFlag().enabled;

  const visibleViews = () => CHROME_VIEWS.filter(isVisible);
  const visibleSubApps = () => CHROME_SUB_APPS.filter(isVisible);

  const openSearch = () => {
    analytics.track('sidebar_click', { surface, view: 'search' });
    analytics.track('command_menu_open', { from: `${surface}_search` });
    CommandState.open();
  };

  /**
   * Go to a view. Under `page` the view becomes the whole page and nothing it
   * replaces is lost — the layout it stood in is somewhere else in the bar.
   * Under `split` it swaps into the focused split instead. Shift-click opens
   * the view beside what you have either way.
   */
  const openView = (
    destination: ChromeDestination,
    pressOptions?: { newSplit?: boolean; surface?: string }
  ) => {
    const newSplit = pressOptions?.newSplit ?? false;

    if (!newSplit && isActive(destination)) {
      globalSplitManager()?.returnFocus();
      return;
    }

    analytics.track('sidebar_click', {
      surface: pressOptions?.surface ?? surface,
      view: destination.id,
    });
    markPendingView(destination);

    navigateAfterPaint(() => {
      // Brain owns a route rather than a plain split, so going to it is a
      // navigation — which lands the whole page on it either way.
      if (destination.id === 'brain' && !newSplit) {
        navigate(buildBrainWorkspacePath(getLastBrainWorkspaceSelection()));
      } else if (newSplit) {
        layout.openWithSplit(destination.content, {
          preferNewSplit: true,
          mergeHistory: false,
          allowDuplicate: true,
          referredFrom: 'sidebar',
        });
      } else if (options.views === 'page') {
        globalSplitManager()?.replaceAllSplits(destination.content, {
          referredFrom: 'sidebar',
        });
      } else {
        layout.openWithSplit(destination.content, {
          preferNewSplit: false,
          mergeHistory: false,
          allowDuplicate: true,
          referredFrom: 'sidebar',
        });
      }
      globalSplitManager()?.returnFocus();
    });
  };

  /**
   * The companion destinations are for whatever is already open, so these
   * always land in their own split — or focus the one already showing them.
   */
  const openAsSplit = (destination: ChromeDestination) => {
    analytics.track('sidebar_click', { surface, view: destination.id });
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

  const openInNewTab = (destination: ChromeDestination) => {
    analytics.track('sidebar_click', {
      surface: `${surface}_apps`,
      view: destination.id,
    });
    openExternalUrl(destinationUrl(destination));
  };

  return {
    isActive,
    openAsSplit,
    openInNewTab,
    openSearch,
    openView,
    visibleSubApps,
    visibleViews,
  };
}
