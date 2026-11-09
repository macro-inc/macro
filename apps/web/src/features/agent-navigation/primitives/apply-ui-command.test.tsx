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
});

/** A layout showing the agent's conversation, as when its prompt was typed. */
function layoutWithAgentPane() {
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
        stacked: () => false,
      }),
    });
    manager = createSplitLayout(orchestrator, {
      router,
      toLocation: (content) => resolveContentLocation(router.routes, content),
      toContent: splitContentFromLocation,
      stacked: () => false,
    });
    return { manager, router, arrivals: createAgentArrivals() };
  });
}

function command(router: ReturnType<typeof layoutWithAgentPane>['router']) {
  const decision = decideUiCommand(router.routes, ME, {
    commandId: 'command-1',
    userId: ME.userId,
    clientId: ME.clientId,
    sessionId: SESSION,
    agentName: 'Research agent',
    kind: 'open',
    path: '/md/doc-1',
    placement: 'beside-agent',
  });
  if (decision.kind !== 'open') throw new Error('expected an open');

  return decision;
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
    expect(arrivals.holds(outcome.pane)).toBe(true);
    expect(
      manager.splits().map((split) => [split.content.type, split.content.id])
    ).toContainEqual(['md', 'doc-1']);

    await outcome.undo();

    expect(router.panes()).toEqual([agentPane]);
    expect(arrivals.holds(outcome.pane)).toBe(false);
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
