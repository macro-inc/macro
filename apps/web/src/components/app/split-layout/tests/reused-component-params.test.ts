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
  passwordsRoute,
} from '@app/routes/routes';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSplitLayout, type SplitContent } from '../layoutManager';
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
      children: [homeSplitRoute, passwordsRoute, notFoundRoute],
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

function passwords(itemId: string): SplitContent {
  return {
    type: 'component',
    id: 'passwords',
    params: { teamId: 'team-1', itemId },
    entryMetadata: {
      route: paneRoute({ id: 'view-passwords', params: {} }),
    },
  };
}

describe('replacing a reused component entry', () => {
  it('delivers the new params to the open split', async () => {
    const manager = setup('/home');
    manager.openWithSplit(passwords('item-1'), { activate: true });
    await vi.waitFor(() =>
      expect(manager.splits().at(-1)?.content.params).toEqual({
        teamId: 'team-1',
        itemId: 'item-1',
      })
    );

    const result = manager.openWithSplit(passwords('item-2'), {
      activate: true,
    });
    expect(result.status).toBe('reused');
    expect(manager.splits().at(-1)?.content.params).toMatchObject({
      itemId: 'item-1',
    });

    result.split?.replace({
      next: passwords('item-2'),
      mergeHistory: true,
      referredFrom: null,
    });
    await vi.waitFor(() =>
      expect(manager.splits().at(-1)?.content.params).toEqual({
        teamId: 'team-1',
        itemId: 'item-2',
      })
    );
    expect(
      manager.splits().filter((split) => split.content.id === 'passwords')
    ).toHaveLength(1);
  });
});
