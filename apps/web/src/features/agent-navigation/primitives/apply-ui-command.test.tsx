/**
 * @vitest-environment jsdom
 *
 * An agent's open lands in a new pane beside its conversation over the real
 * split router and manager, leaves the person's pane active, never replaces
 * a pane, and Undo takes it away.
 */

import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  PANE_LEVEL,
  type PaneId,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  agentsRoute,
  appRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import { createSplitLayout } from '@components/app/split-layout/layoutManager';
import { createAppPanePolicy } from '@components/app/split-layout/split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '@components/app/split-layout/split-router/legacy-route';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentArrivals } from '../context/agent-arrivals';
import { decideUiCommand } from '../core/ui-command';
import { applyOpen } from './apply-ui-command';

vi.mock('@components/app/split-layout/componentRegistry', () => ({
  resolveComponent: () => ({ element: undefined }),
}));
vi.mock('@core/constant/allBlocks', () => ({
  blocks: { md: {} },
  fileTypeToBlockName: (type: string) => type,
  isBlockAlias: () => false,
  resolveBlockAlias: (type: string) => type,
}));

const SESSION = '0198a4cc-e138-7670-a308-a6b766602700';
const ME = { userId: 'macro|owner@example.com', clientId: 'tab-1' };

const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [
        homeSplitRoute,
        tasksSplitRoute,
        agentsRoute,
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => paneRoute({ id: 'view-home', params: {} }),
};

const orchestrator = {
  createBlockInstance: vi.fn((_type: string, id: string) => ({
    element: undefined,
    node: { id },
    detach: vi.fn(),
    dispose: vi.fn(),
  })),
  isBlockMounted: () => false,
  getBlockHandle: async () => undefined,
} as unknown as BlockOrchestrator;

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  // jsdom has no Web Animations API; `watchPanes` lends one.
  Reflect.deleteProperty(Element.prototype, 'animate');
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
});

/**
 * A layout showing the agent's conversation, as when its prompt was typed.
 * `stacked` lays panes out as the phone apps do, one in front of another.
 */
function layoutWithAgentPane(stacked = false) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    let manager: ReturnType<typeof createSplitLayout> | undefined;
    const router = createSplitRouter({
      routes,
      history: createMemoryHistory(`/agents/${SESSION}`),
      paneStore: createMemoryPaneStore<Entry>(),
      policy: createAppPanePolicy({
        manager: () => manager,
        toContent: splitContentFromLocation,
        defaultLocation: () => ({
          route: paneRoute({ id: 'view-home', params: {} }),
        }),
        stacked: () => stacked,
      }),
    });
    manager = createSplitLayout(orchestrator, {
      router,
      toLocation: (content) => resolveContentLocation(router.routes, content),
      toContent: splitContentFromLocation,
      stacked: () => stacked,
    });
    return { manager, router, arrivals: createAgentArrivals() };
  });
}

function command(
  router: ReturnType<typeof layoutWithAgentPane>['router'],
  path = '/md/doc-1'
) {
  const decision = decideUiCommand(router.routes, ME, {
    commandId: 'command-1',
    userId: ME.userId,
    clientId: ME.clientId,
    sessionId: SESSION,
    agentName: 'Research agent',
    kind: 'open',
    path,
    placement: 'beside-agent',
  });
  if (decision.kind !== 'open') throw new Error('expected an open');

  return decision;
}

type PlayedAnimation = {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  /** Still applied: neither cancelled nor played back to its start. */
  held: boolean;
  finish: () => void;
};

/**
 * A watched window whose panes render in `[data-split-pane]` elements, with
 * a stand-in for the Web Animations API (jsdom has none) that records what
 * plays. Animations finish when `finish` is called, or at once with
 * `instant`.
 */
function watchPanes(panes: readonly PaneId[], instant = true) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  for (const pane of panes) {
    const element = document.createElement('div');
    element.dataset.splitPane = pane;
    document.body.append(element);
  }

  const played: PlayedAnimation[] = [];
  Object.assign(Element.prototype, {
    getAnimations: () => [],
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      let finish = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const record: PlayedAnimation = {
        keyframes,
        options,
        held: true,
        finish,
      };
      played.push(record);
      if (instant) finish();

      return {
        finished,
        cancel: () => {
          record.held = false;
        },
        reverse: () => {
          record.held = false;
        },
      };
    },
  });

  return {
    played,
    /** Departures still holding a pane out of sight. */
    departuresHeld: () =>
      played.filter(
        (animation) => animation.options.fill === 'forwards' && animation.held
      ),
  };
}

describe('applyOpen', () => {
  it('opens beside the agent, keeps the person in their pane, and Undo removes it', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    const [agentPane] = router.panes();
    manager.activateSplit(manager.splits()[0]!.id);
    const { frame, location } = command(router);

    const outcome = await applyOpen(
      { router, manager, arrivals, stacked: false },
      frame,
      location
    );

    expect(outcome.kind).toBe('opened');
    if (outcome.kind !== 'opened') return;
    expect(router.panes()).toEqual([agentPane, outcome.pane]);
    expect(manager.activeSplitId()).toBe(agentPane);
    expect(arrivals.holds(outcome.pane, router.entry(outcome.pane))).toBe(true);
    expect(
      manager.splits().map((split) => [split.content.type, split.content.id])
    ).toContainEqual(['md', 'doc-1']);

    await outcome.undo();

    expect(router.panes()).toEqual([agentPane]);
  });

  it('leaves an item already on screen as it is', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    const { frame, location } = command(router);
    const deps = { router, manager, arrivals, stacked: false };
    const first = await applyOpen(deps, frame, location);
    if (first.kind !== 'opened') throw new Error('expected an open');
    const [agentPane] = router.panes();
    manager.activateSplit(agentPane as never);

    const again = await applyOpen(deps, frame, location);

    expect(again.kind).toBe('shown');
    expect(router.panes()).toEqual([agentPane, first.pane]);
    expect(manager.activeSplitId()).toBe(agentPane);
  });

  it('Undo keeps what the person changed since, taking away only its pane', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    const [agentPane] = router.panes();
    const { frame, location } = command(router);
    const outcome = await applyOpen(
      { router, manager, arrivals, stacked: false },
      frame,
      location
    );
    if (outcome.kind !== 'opened') throw new Error('expected an open');
    await router.navigatePane(agentPane!, '/tasks');

    await outcome.undo();

    expect(router.panes()).toEqual([agentPane]);
    expect(router.entry(agentPane!)?.location.route.matches.at(-1)?.id).toBe(
      'view-tasks'
    );
  });

  it('Undo keeps the read hold on the pane until it is gone', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    const { frame, location } = command(router);
    const outcome = await applyOpen(
      { router, manager, arrivals, stacked: false },
      frame,
      location
    );
    if (outcome.kind !== 'opened') throw new Error('expected an open');
    const heldAsItLeft: boolean[] = [];
    router.registerGuard(outcome.pane, PANE_LEVEL, ({ pane, from }) => {
      heldAsItLeft.push(arrivals.holds(pane, from));
      return true;
    });

    await outcome.undo();

    expect(heldAsItLeft).toEqual([true]);
    expect(router.panes()).not.toContain(outcome.pane);
  });

  it('Undo leaves the pane on screen when a leave guard keeps it, and can be tried again', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    const { frame, location } = command(router);
    const outcome = await applyOpen(
      { router, manager, arrivals, stacked: false },
      frame,
      location
    );
    if (outcome.kind !== 'opened') throw new Error('expected an open');
    const motion = watchPanes(router.panes());
    const keepEdits = router.registerGuard(
      outcome.pane,
      PANE_LEVEL,
      () => false
    );

    const undone = await outcome.undo();

    expect(undone).toBe(false);
    expect(router.panes()).toContain(outcome.pane);
    expect(motion.departuresHeld()).toEqual([]);
    expect(arrivals.holds(outcome.pane, router.entry(outcome.pane))).toBe(true);

    keepEdits();
    expect(await outcome.undo()).toBe(true);
    expect(router.panes()).not.toContain(outcome.pane);
  });

  it('Undo still takes away only its pane when the agent opens another during the departure', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    const deps = { router, manager, arrivals, stacked: false };
    const first = command(router);
    const outcome = await applyOpen(deps, first.frame, first.location);
    if (outcome.kind !== 'opened') throw new Error('expected an open');
    const motion = watchPanes(router.panes(), false);

    const undoing = outcome.undo();
    await vi.waitFor(() => expect(motion.departuresHeld()).toHaveLength(1));
    const second = command(router, '/md/doc-2');
    const next = await applyOpen(deps, second.frame, second.location);
    if (next.kind !== 'opened') throw new Error('expected an open');
    motion.departuresHeld()[0]?.finish();

    expect(await undoing).toBe(true);
    expect(router.panes()).not.toContain(outcome.pane);
    expect(router.panes()).toContain(next.pane);
  });

  it('leaves a view no claim covers as it is when a pane already shows it', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    const deps = { router, manager, arrivals, stacked: false };
    const tasks = command(router, '/tasks');
    const first = await applyOpen(deps, tasks.frame, tasks.location);
    if (first.kind !== 'opened') throw new Error('expected an open');
    const before = router.panes();

    const again = await applyOpen(deps, tasks.frame, tasks.location);

    expect(again.kind).toBe('shown');
    expect(router.panes()).toEqual(before);
  });

  it('opens a view in front in a stacked layout when the pane showing it is behind', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane(true);
    await router.settled();
    const deps = { router, manager, arrivals, stacked: true };
    const tasks = command(router, '/tasks');
    const doc = command(router);
    const behind = await applyOpen(deps, tasks.frame, tasks.location);
    if (behind.kind !== 'opened') throw new Error('expected an open');
    await applyOpen(deps, doc.frame, doc.location);
    expect(router.panes().at(-1)).not.toBe(behind.pane);

    const again = await applyOpen(deps, tasks.frame, tasks.location);

    expect(again.kind).toBe('opened');
    if (again.kind !== 'opened') return;
    expect(router.panes().at(-1)).toBe(again.pane);
  });

  it('counts a pane on the view the agent names, whatever else its search holds', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    const deps = { router, manager, arrivals, stacked: false };
    const filtered = command(router, '/tasks?s0.tasks.view=mine&s0.tasks.q=x');
    const first = await applyOpen(deps, filtered.frame, filtered.location);
    if (first.kind !== 'opened') throw new Error('expected an open');
    const sameView = command(router, '/tasks?s0.tasks.view=mine');
    const otherView = command(router, '/tasks?s0.tasks.view=all');

    const shown = await applyOpen(deps, sameView.frame, sameView.location);
    const other = await applyOpen(deps, otherView.frame, otherView.location);

    expect(sameView.location.search).toEqual({ tasks: { view: ['mine'] } });
    expect(shown.kind).toBe('shown');
    expect(other.kind).toBe('opened');
  });

  it('answers shown, not no room, for an item already on screen in a full layout', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    const deps = { router, manager, arrivals, stacked: false };
    const { frame, location } = command(router);
    const first = await applyOpen(deps, frame, location);
    if (first.kind !== 'opened') throw new Error('expected an open');
    vi.spyOn(manager, 'canSplit').mockReturnValue(false);
    vi.spyOn(manager, 'canAppendSplit').mockReturnValue(false);

    const again = await applyOpen(deps, frame, location);

    expect(again.kind).toBe('shown');
  });

  it('never replaces a pane when there is no room for another', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    const before = router.panes();
    vi.spyOn(manager, 'canSplit').mockReturnValue(false);
    vi.spyOn(manager, 'canAppendSplit').mockReturnValue(false);
    const { frame, location } = command(router);

    const outcome = await applyOpen(
      { router, manager, arrivals, stacked: false },
      frame,
      location
    );

    expect(outcome.kind).toBe('no_room');
    expect(router.panes()).toEqual(before);
    expect(
      manager.splits().map((split) => [split.content.type, split.content.id])
    ).not.toContainEqual(['md', 'doc-1']);
  });

  it('pushes in front on the phone apps, where panes stack', async () => {
    const { manager, router, arrivals } = layoutWithAgentPane();
    await router.settled();
    vi.spyOn(manager, 'canAppendSplit').mockReturnValue(false);
    const { frame, location } = command(router);

    const outcome = await applyOpen(
      { router, manager, arrivals, stacked: true },
      frame,
      location
    );

    expect(outcome.kind).toBe('opened');
    if (outcome.kind !== 'opened') return;
    expect(router.panes().at(-1)).toBe(outcome.pane);
  });
});
