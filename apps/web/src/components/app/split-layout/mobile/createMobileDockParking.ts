import { useFeatureFlag } from '@app/lib/analytics/posthog';
import type {
  PaneId,
  SplitLocation,
  SplitRouter,
} from '@app/lib/split-router';
import { enableMobileParkedDockViews } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createComputed, on, untrack } from 'solid-js';
import {
  type ReplaceAllSplitsOptions,
  type SplitContent,
  type SplitManager,
  splitOf,
} from '../layoutManager';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '../split-router/legacy-route';
import { viewRestorationKey } from '../view-restoration-key';

/** Dock views kept mounted besides the shown one, unless the flag says otherwise. */
const DEFAULT_MAX_PARKED = 5;

type ParkingPayload = {
  maxParked?: number;
};

export type MobileDockParking = {
  /**
   * Shows dock view `content` as the only pane. The dock view it replaces is
   * parked (kept mounted, hidden) instead of closed, and a parked `content`
   * comes back as it was instead of rendering again.
   */
  show(
    content: SplitContent,
    options: ReplaceAllSplitsOptions,
    /** Whether the dock can show `view` again; a view it cannot is not parked. */
    returnsTo: (view: string) => boolean
  ): void;
};

/**
 * The view a content or pane shows, for matching a dock target to a parked
 * pane: the view it resumes as, so agent conversations count as Agents and
 * Tasks and Projects, which share content, stay apart. Search starts fresh on
 * every dock tap, and entities open above a view, so neither is parked.
 */
function dockViewOf(
  content: SplitContent,
  location: SplitLocation
): string | undefined {
  if (content.type !== 'component' || content.id === 'search') return;

  return viewRestorationKey(content.id, location);
}

/**
 * Android phones keep recently used dock views mounted, so going back to one
 * shows it instead of rendering it again. Parked panes are the router's
 * retained panes that are not open; the least recently shown ones past
 * `maxParked` are discarded (their view state is kept first, so they resume
 * as today).
 */
export function createMobileDockParking(options: {
  router: SplitRouter;
  manager: SplitManager;
  sessionKey: Accessor<string | undefined>;
}): MobileDockParking {
  const { router, manager } = options;
  const flag = useFeatureFlag<ParkingPayload>(enableMobileParkedDockViews);

  /** How many views to keep parked, or undefined when parking is off. */
  const maxParked = (): number | undefined => {
    const current = flag();
    if (!current.enabled || !isMobile()) return;

    const max = current.payload?.maxParked ?? DEFAULT_MAX_PARKED;
    return max > 0 ? max : undefined;
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
      ? dockViewOf(splitContentFromLocation(entry.location), entry.location)
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
      [() => maxParked() !== undefined, options.sessionKey],
      () => discard(untrack(parkedPanes)),
      { defer: true }
    )
  );

  // A link, notification, or Back can open a view that is also parked; the
  // open one wins, so a view is never mounted twice.
  createComputed(() => {
    const shown = router.panes().map(viewOfPane);
    untrack(() =>
      discard(parkedPanes().filter((pane) => shown.includes(viewOfPane(pane))))
    );
  });

  const show = (
    content: SplitContent,
    showOptions: ReplaceAllSplitsOptions,
    returnsTo: (view: string) => boolean
  ) => {
    const limit = untrack(maxParked);
    const target = dockViewOf(
      content,
      resolveContentLocation(router.routes, content)
    );
    if (limit === undefined || !target) {
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
    const parkable =
      rootView !== undefined && returnsTo(rootView) && open.length <= 2;
    const park = root && parkable ? [root] : [];

    // Panes that left parking another way (a link, a close) leave no order.
    for (const pane of lastShown.keys())
      if (!parked.includes(pane)) lastShown.delete(pane);
    // Evicting first keeps the limit even while the switch runs; a switch a
    // leave guard refuses has evicted views that resume as without parking.
    const evicted = evict(restore, park.length, limit);
    for (const pane of park) lastShown.set(pane, ++showCount);
    const attributes = {
      'mobile_dock.evicted': evicted,
      'mobile_dock.parked_count':
        parked.length - evicted - (restore ? 1 : 0) + park.length,
    };

    if (!restore) {
      manager.replaceAllSplits(content, {
        ...showOptions,
        park: park.map(splitOf),
        attributes: { ...attributes, 'navigation.restored_from_parked': false },
      });
      return;
    }

    const showParked = async () => {
      const result = await router.showLayout([restore], {
        closeOpen: true,
        park,
        attributes,
      });
      if (result.status === 'cancelled') return;

      manager.activateSplit(splitOf(restore));
      manager.unSpotlightSplit();
    };
    fireAndForget(showParked(), 'mobile-dock-parking');
  };

  return { show };
}
