import { parseAgentsRoute } from '@app/features/agents-view/core/route';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import type { PaneId, SplitRouter } from '@app/lib/split-router';
import { enableMobileParkedDockViews } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { type Accessor, createComputed, on, untrack } from 'solid-js';
import {
  type ReplaceAllSplitsOptions,
  type SplitContent,
  type SplitManager,
  splitOf,
} from '../layoutManager';
import { splitContentFromLocation } from '../split-router/legacy-route';

/** Dock views kept mounted besides the shown one, unless the flag says otherwise. */
const DEFAULT_MAX_PARKED = 3;

type HiddenViews = 'live' | 'suspended';

type ParkingPayload = {
  maxParked?: number;
  hiddenViews?: HiddenViews;
};

export type ParkingSettings = {
  maxParked: number;
  hiddenViews: HiddenViews;
};

export type MobileDockParking = {
  /** Whether parked views hold their query results until shown. */
  suspendsHidden: Accessor<boolean>;
  /**
   * Shows dock view `content` as the only pane. The dock view it replaces is
   * parked (kept mounted, hidden) instead of closed, and a parked `content`
   * comes back as it was instead of rendering again.
   */
  show(content: SplitContent, options: ReplaceAllSplitsOptions): void;
};

/**
 * The view a content or pane shows, for matching a dock target to a parked
 * pane: agent conversations count as the Agents view. Search starts fresh on
 * every dock tap, and entities open above a view, so neither is parked.
 */
function dockViewOf(content: SplitContent): string | undefined {
  if (content.type !== 'component' || content.id === 'search') return;

  return parseAgentsRoute(content.id) ? 'agents' : content.id;
}

/**
 * Phones keep recently used dock views mounted, so going back to one shows it
 * instead of rendering it again. Parked panes are the router's retained panes
 * that are not open; the least recently shown ones past `maxParked` are
 * discarded (their view state is kept first, so they resume as today).
 */
export function createMobileDockParking(options: {
  router: SplitRouter;
  manager: SplitManager;
  sessionKey: Accessor<string | undefined>;
}): MobileDockParking {
  const { router, manager } = options;
  const flag = useFeatureFlag<ParkingPayload>(enableMobileParkedDockViews);

  const settings = (): ParkingSettings | undefined => {
    const current = flag();
    if (!current.enabled || !isMobile()) return;

    const payload = current.payload;
    const maxParked = payload?.maxParked ?? DEFAULT_MAX_PARKED;
    if (maxParked <= 0) return;

    return {
      maxParked,
      hiddenViews: payload?.hiddenViews === 'suspended' ? 'suspended' : 'live',
    };
  };

  // When each parked pane was last shown, for least-recently-used eviction.
  const lastShown = new Map<PaneId, number>();
  let showCount = 0;

  const parkedPanes = (): readonly PaneId[] => {
    const open = router.panes();
    return router.retainedPanes().filter((pane) => !open.includes(pane));
  };

  const viewOfPane = (pane: PaneId): string | undefined => {
    const entry = router.entry(pane);
    return entry
      ? dockViewOf(splitContentFromLocation(entry.location))
      : undefined;
  };

  const discard = (panes: readonly PaneId[]) => {
    if (panes.length === 0) return;

    // A discarded view unmounts without leaving; keep what it shows so the
    // next dock tap resumes there, as it would have without parking.
    for (const pane of panes) manager.viewState.keep(splitOf(pane));
    router.discardPanes(panes);
    for (const pane of panes) lastShown.delete(pane);
  };

  /**
   * Discards the least recently shown parked panes, other than `restoring`,
   * so that `adding` more fit under `limit`. Returns how many it discarded.
   */
  const evict = (
    restoring: PaneId | undefined,
    adding: number,
    limit: number
  ) => {
    const candidates = untrack(parkedPanes)
      .filter((pane) => pane !== restoring)
      .sort((a, b) => (lastShown.get(a) ?? 0) - (lastShown.get(b) ?? 0));
    const excess = candidates.length + adding - limit;
    const evicted = excess > 0 ? candidates.slice(0, excess) : [];
    discard(evicted);

    return evicted.length;
  };

  // Turning parking off, a wider window, or another account drops every
  // parked view; nothing of the previous session stays mounted.
  createComputed(
    on(
      [() => settings() !== undefined, options.sessionKey],
      () => discard(untrack(parkedPanes)),
      { defer: true }
    )
  );

  // A link, notification, or Back can open a view that is also parked; the
  // open one wins, so a view is never mounted twice.
  createComputed(
    on(router.panes, (open) =>
      untrack(() => {
        const shown = open.map(viewOfPane);
        discard(
          parkedPanes().filter((pane) => shown.includes(viewOfPane(pane)))
        );
      })
    )
  );

  const show = (
    content: SplitContent,
    showOptions: ReplaceAllSplitsOptions
  ) => {
    const current = untrack(settings);
    const target = dockViewOf(content);
    if (!current || !target) {
      manager.replaceAllSplits(content, showOptions);
      return;
    }

    const open = untrack(router.panes);
    const [root] = open;
    const rootView = root ? untrack(() => viewOfPane(root)) : undefined;
    // A pane already showing the view stays, as without parking.
    if (rootView === target) {
      manager.replaceAllSplits(content, showOptions);
      return;
    }

    const parked = untrack(parkedPanes);
    const restore = parked.find(
      (pane) => untrack(() => viewOfPane(pane)) === target
    );
    // The stack mounts only its front two panes; parking a deeper root would
    // mount it now, hidden, and cost a render on the way out.
    const park = root && rootView && open.length <= 2 ? [root] : [];
    // An older parked copy of the view being parked is superseded by it.
    const superseded =
      park.length > 0
        ? parked.filter((pane) => untrack(() => viewOfPane(pane)) === rootView)
        : [];
    discard(superseded);

    const span = Telemetry.span('mobile_dock.switch');
    span.setAttr('view.id', target);
    span.setAttr('mobile_dock.restored', restore !== undefined);
    span.setAttr('mobile_dock.hidden_views', current.hiddenViews);
    span.setAttr(
      'mobile_dock.evicted',
      evict(restore, park.length, current.maxParked)
    );
    for (const pane of park) lastShown.set(pane, ++showCount);

    if (!restore) {
      manager.replaceAllSplits(content, {
        ...showOptions,
        park: park.map(splitOf),
        attributes: { 'navigation.restored_from_parked': false },
      });
      span.setAttr('mobile_dock.parked_count', untrack(parkedPanes).length);
      span.end();
      return;
    }

    const showParked = async () => {
      try {
        const result = await router.showLayout([restore], {
          closeOpen: true,
          park,
        });
        span.setAttr('mobile_dock.outcome', result.status);
        if (result.status === 'cancelled') return;

        manager.activateSplit(splitOf(restore));
        span.setAttr('mobile_dock.parked_count', untrack(parkedPanes).length);
      } finally {
        span.end();
      }
    };
    fireAndForget(showParked(), 'mobile-dock-parking');
  };

  return {
    suspendsHidden: () => settings()?.hiddenViews === 'suspended',
    show,
  };
}
