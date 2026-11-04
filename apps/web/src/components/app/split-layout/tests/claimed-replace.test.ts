import { projectHostedContent } from '@app/features/projects/open-project';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  homeSplitRoute,
  notFoundRoute,
  projectDetailRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSplitLayout } from '../layoutManager';
import { createAppPanePolicy } from '../split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from '../split-router/legacy-route';

vi.mock('../componentRegistry', () => ({
  resolveComponent: vi.fn((id: string, params: Record<string, string>) => ({
    type: 'mock-component',
    id,
    params,
  })),
}));

vi.mock('@core/constant/allBlocks', () => ({
  isBlockAlias: vi.fn(() => false),
  resolveBlockAlias: vi.fn((type: string) => type),
}));

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [
        homeSplitRoute,
        { ...tasksSplitRoute, children: [projectDetailRoute] },
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => paneRoute({ id: 'view-home', params: {} }),
};

function createMockOrchestrator(): BlockOrchestrator {
  return {
    isBlockMounted: vi.fn(() => false),
    createBlockInstance: vi.fn((_type, id) => ({
      node: { type: 'mock-node', id },
      detach: vi.fn(),
      dispose: vi.fn(),
    })),
  } as unknown as BlockOrchestrator;
}

let dispose: (() => void) | undefined;

function setup(url: string) {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    let manager: ReturnType<typeof createSplitLayout> | undefined;
    const router = createSplitRouter({
      routes,
      history: createMemoryHistory(url),
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
    manager = createSplitLayout(createMockOrchestrator(), {
      router,
      toLocation: (content) => resolveContentLocation(router.routes, content),
      toContent: splitContentFromLocation,
    });
    return manager;
  });
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('replacing a split with content another pane claims', () => {
  const projectId = '01a1899a-b629-7e50-8e65-079fca623856';

  it('leaves the claiming split active instead of the replaced one', async () => {
    const manager = setup(`/home/~/tasks/projects/${projectId}/overview`);
    const [home, project] = manager.splits();
    expect(home?.content).toMatchObject({ type: 'component', id: 'home' });
    expect(project?.content).toMatchObject({ type: 'component', id: 'tasks' });
    manager.activateSplit(home!.id);

    const result = manager.openWithSplit(
      projectHostedContent(projectId, 'overview'),
      { handle: manager.getSplit(home!.id), preferNewSplit: false }
    );

    expect(result.status).toBe('opened');
    await vi.waitFor(() => expect(manager.activeSplitId()).toBe(project!.id));
    expect(manager.splits().map((split) => split.content.id)).toEqual([
      'home',
      'tasks',
    ]);
  });
});
