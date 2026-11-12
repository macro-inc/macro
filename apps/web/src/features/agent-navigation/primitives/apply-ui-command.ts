/**
 * Opens what an agent's `ui_command` names, in a new pane, without taking
 * anything from the person: no pane is replaced, the pane and element they
 * were working in keep focus, and Undo puts the layout back as it was.
 */

import {
  claimOf,
  type Entry,
  type LayoutSnapshot,
  type PaneId,
  type SplitLocation,
  type SplitRouter,
  type SplitSearchState,
} from '@app/lib/split-router';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { splitOf } from '@components/app/split-layout/layoutManager';
import { deepEqual } from '@core/util/compareUtils';
import { type AgentArrivals, OPENED_BY_AGENT } from '../context/agent-arrivals';
import type { UiCommandFrame } from '../core/ui-command';
import {
  capturePaneRects,
  playArrival,
  playDeparture,
  playSettle,
} from './arrival-motion';

export type ApplyDeps = {
  router: SplitRouter;
  manager: SplitManager | undefined;
  arrivals: AgentArrivals;
  /** Panes stack, as on the phone apps: a new pane goes in front. */
  stacked: boolean;
};

export type ApplyOutcome =
  /**
   * A new pane shows it; `undo` takes it away again and resolves whether it
   * did. A leave guard can keep the pane (unsaved edits); `undo` can then be
   * tried again.
   */
  | { kind: 'opened'; pane: PaneId; undo: () => Promise<boolean> }
  /** Already on screen; left as it is, nothing to undo. */
  | { kind: 'shown' }
  /** No room for another pane, and the agent never replaces one. */
  | { kind: 'no_room' }
  | { kind: 'cancelled' };

/** The pane showing this agent session, which the new pane goes beside. */
function paneShowingSession(
  router: SplitRouter,
  sessionId: string
): PaneId | undefined {
  return router
    .panes()
    .find((pane) =>
      router
        .entry(pane)
        ?.location.route.matches.some((match) =>
          Object.values(match.params).includes(sessionId)
        )
    );
}

/** Whether every search value the agent asked for is in `shown`. */
function includesSearch(
  shown: SplitSearchState | undefined,
  asked: SplitSearchState
): boolean {
  return Object.entries(asked).every(([namespace, params]) =>
    Object.entries(params).every(([key, value]) =>
      deepEqual(shown?.[namespace]?.[key], value)
    )
  );
}

/**
 * Whether `entry` shows the view at `location`: the same route, with every
 * search value the agent asked for (`/tasks` matches a Tasks pane on any
 * saved view; `/tasks?s0.view=…` only a pane on that view).
 */
function showsView(entry: Entry | undefined, location: SplitLocation): boolean {
  if (!entry) return false;
  if (!deepEqual(entry.location.route, location.route)) return false;

  return includesSearch(entry.location.search, location.search ?? {});
}

/** The panes on screen: stacked layouts show only the front one. */
function panesOnScreen(
  router: SplitRouter,
  manager: SplitManager | undefined
): readonly PaneId[] {
  const panes = router.panes();
  if (!manager) return panes;

  const visible = manager.getVisibleSplits().map((split) => split.id);
  return panes.filter((pane) => visible.includes(splitOf(pane)));
}

/**
 * Already shown, so an open would only bring it forward: by whoever holds its
 * claim (a pane or a preview), or, for a view no claim covers (Tasks, Home),
 * by a pane on screen showing that view. A view in a stacked pane behind the
 * front one opens in front.
 */
function alreadyShown(
  { router, manager }: ApplyDeps,
  location: SplitLocation
): boolean {
  const claim = claimOf(router.routes, location.route);
  if (claim !== undefined) return router.claims.holderOf(claim) !== undefined;

  return panesOnScreen(router, manager).some((pane) =>
    showsView(router.entry(pane), location)
  );
}

/**
 * The person's first touch of an arrival makes it theirs. Listens on the
 * split panel, which tiled and stacked layouts both render.
 */
function releaseOnTouch(arrivals: AgentArrivals, pane: PaneId) {
  const element = [...document.querySelectorAll('[data-split-id]')].find(
    (panel) => panel instanceof HTMLElement && panel.dataset.splitId === pane
  );
  if (!element) return;

  const release = () => {
    arrivals.release(pane);
    for (const type of ['pointerdown', 'keydown'] as const) {
      element.removeEventListener(type, release, true);
    }
  };
  for (const type of ['pointerdown', 'keydown'] as const) {
    element.addEventListener(type, release, true);
  }
}

/** Where the new pane goes: beside the agent's pane, or at the end. */
function target(
  router: SplitRouter,
  frame: UiCommandFrame
): { source?: PaneId; split?: { pane: PaneId; side: 'right' } } {
  const agentPane = paneShowingSession(router, frame.sessionId);
  if (!agentPane) return {};
  if (frame.placement !== 'beside-agent') return { source: agentPane };

  return { source: agentPane, split: { pane: agentPane, side: 'right' } };
}

/**
 * Takes the agent's pane away, as Undo. The read hold stays until the pane
 * is gone: the person hasn't touched it, and a read marker mounting during
 * the departure would mark it read. Resolves whether the pane went; when a
 * leave guard kept it (unsaved edits) or a newer navigation won, it comes
 * back into view.
 */
async function undo(
  deps: ApplyDeps,
  pane: PaneId,
  snapshot: LayoutSnapshot,
  opened: LayoutSnapshot
): Promise<boolean> {
  const { router } = deps;
  const others = router.panes().filter((open) => open !== pane);
  const rects = capturePaneRects(others);
  const departure = deps.stacked ? undefined : playDeparture(pane);
  await departure?.finished;

  // Restore the layout as it was when nothing else changed since (panes,
  // sizes, order, where each pane is); otherwise take away only the agent's
  // pane and keep the person's changes. Decided after the departure, so an
  // open landing during it counts as a change.
  const untouched = deepEqual(router.layoutSnapshot(), opened);
  await (untouched ? router.restoreLayout(snapshot) : router.remove(pane));

  if (router.panes().includes(pane)) {
    departure?.revert();
    return false;
  }

  if (!deps.stacked) requestAnimationFrame(() => playSettle(rects));
  return true;
}

/** Open `location` for the agent, as described in the module comment. */
export async function applyOpen(
  deps: ApplyDeps,
  frame: UiCommandFrame,
  location: SplitLocation
): Promise<ApplyOutcome> {
  const { router, manager } = deps;
  // Opening it again would bring its pane forward and take focus. Checked
  // before room: a full layout has nothing to make room for when it's shown.
  if (alreadyShown(deps, location)) return { kind: 'shown' };

  const { source, split } = target(router, frame);
  const roomy = split
    ? (manager?.canSplit(splitOf(split.pane), split.side) ?? true)
    : (manager?.canAppendSplit() ?? true);
  if (!deps.stacked && !roomy) return { kind: 'no_room' };

  const before = router.panes();
  const snapshot = router.layoutSnapshot();
  const rects = capturePaneRects(before);

  // The person keeps working where they were: the new split neither becomes
  // active nor takes focus (the manager's `activate: false`), so a caret
  // mid-sentence in a composer stays put. The entry is marked as the agent's
  // before anything mounts, so its read markers wait from the start.
  const result = await router.open(
    { location },
    { newPane: true, source, intent: { direct: true, split } },
    { meta: { activate: false, ...OPENED_BY_AGENT } }
  );

  if (result.status === 'cancelled') return { kind: 'cancelled' };
  if (result.status !== 'committed' || before.includes(result.pane)) {
    return { kind: 'shown' };
  }

  const pane = result.pane;
  const opened = router.layoutSnapshot();
  requestAnimationFrame(() => {
    releaseOnTouch(deps.arrivals, pane);
    if (!deps.stacked) playArrival(pane, rects);
  });

  return {
    kind: 'opened',
    pane,
    undo: () => undo(deps, pane, snapshot, opened),
  };
}
