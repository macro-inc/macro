/**
 * Opens what an agent's `ui_command` names, in a new pane, without taking
 * anything from the person: no pane is replaced, the pane and element they
 * were working in keep focus, and Undo puts the layout back as it was.
 */

import type {
  LayoutSnapshot,
  PaneId,
  SplitLocation,
  SplitRouter,
} from '@app/lib/split-router';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { splitOf } from '@components/app/split-layout/layoutManager';
import type { AgentArrivals } from '../context/agent-arrivals';
import type { UiCommandFrame } from '../core/ui-command';
import {
  capturePaneRects,
  paneElement,
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
  /** A new pane shows it; `undo` takes it away again. */
  | { kind: 'opened'; pane: PaneId; undo: () => Promise<void> }
  /** A pane already showing it was brought up; nothing to undo. */
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

function samePanes(left: readonly PaneId[], right: readonly PaneId[]) {
  return (
    left.length === right.length && left.every((pane) => right.includes(pane))
  );
}

/** The person's first touch of an arrival makes it theirs. */
function releaseOnTouch(arrivals: AgentArrivals, pane: PaneId) {
  const element = paneElement(pane);
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

async function undo(
  deps: ApplyDeps,
  pane: PaneId,
  snapshot: LayoutSnapshot,
  before: readonly PaneId[]
) {
  deps.arrivals.release(pane);
  const others = deps.router.panes().filter((open) => open !== pane);
  const rects = capturePaneRects(others);
  if (!deps.stacked) await playDeparture(pane);

  // Restore the layout as it was when nothing else changed since; otherwise
  // take away only the agent's pane and leave the person's changes.
  const untouched = samePanes(deps.router.panes(), [...before, pane]);
  await (untouched
    ? deps.router.restoreLayout(snapshot)
    : deps.router.remove(pane));

  if (!deps.stacked) requestAnimationFrame(() => playSettle(rects));
}

/** Open `location` for the agent, as described in the module comment. */
export async function applyOpen(
  deps: ApplyDeps,
  frame: UiCommandFrame,
  location: SplitLocation
): Promise<ApplyOutcome> {
  const { router, manager } = deps;
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
  // mid-sentence in a composer stays put.
  const result = await router.open(
    { location },
    { newPane: true, source, intent: { direct: true, split } },
    { meta: { activate: false } }
  );

  if (result.status === 'cancelled') return { kind: 'cancelled' };
  if (result.status !== 'committed' || before.includes(result.pane)) {
    return { kind: 'shown' };
  }

  const pane = result.pane;
  deps.arrivals.add(pane);
  requestAnimationFrame(() => {
    releaseOnTouch(deps.arrivals, pane);
    if (!deps.stacked) playArrival(pane, rects);
  });

  return {
    kind: 'opened',
    pane,
    undo: () => undo(deps, pane, snapshot, before),
  };
}
