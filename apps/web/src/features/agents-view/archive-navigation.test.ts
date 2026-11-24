import {
  createMemoryHistory,
  createMemoryPaneStore,
  createRoutesManifest,
  createSplitRouter,
  decodePane,
  formatPanePath,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  agentsArchiveRoute,
  agentsRoute,
  agentsViewRoute,
  appRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import {
  createSplitLayout,
  type SplitContent,
} from '@components/app/split-layout/layoutManager';
import { createAppPanePolicy } from '@components/app/split-layout/split-router/app-pane-policy';
import {
  resolveContentLocation,
  splitContentFromLocation,
  upgradeLegacyPath,
} from '@components/app/split-layout/split-router/legacy-route';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  agentsArchiveContent,
  agentsArchiveLocation,
} from './archive-navigation';

vi.mock('@components/app/split-layout/componentRegistry', () => ({
  resolveComponent: vi.fn(() => ({ type: 'mock-component' })),
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

const definitions: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [
        agentsArchiveRoute,
        agentsRoute,
        agentsViewRoute,
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => paneRoute({ id: 'view-agents', params: {} }),
};
const routes = createRoutesManifest(definitions);
let cleanup: (() => void) | undefined;

function setup(path: string) {
  const history = createMemoryHistory(upgradeLegacyPath(routes, path));
  return createRoot((dispose) => {
    let manager: ReturnType<typeof createSplitLayout> | undefined;
    const router = createSplitRouter({
      routes: definitions,
      history,
      paneStore: createMemoryPaneStore(),
      policy: createAppPanePolicy({
        manager: () => manager,
        toContent: splitContentFromLocation,
        defaultLocation: () => ({
          route: paneRoute({ id: 'view-agents', params: {} }),
        }),
        stacked: () => false,
      }),
    });
    const orchestrator = {
      isBlockMounted: vi.fn(() => false),
      createBlockInstance: vi.fn((_type, id) => ({
        node: { type: 'mock-node', id },
        detach: vi.fn(),
        dispose: vi.fn(),
      })),
    } as unknown as BlockOrchestrator;
    manager = createSplitLayout(orchestrator, {
      router,
      toLocation: (content) => resolveContentLocation(router.routes, content),
      toContent: splitContentFromLocation,
    });
    cleanup = () => {
      router.dispose();
      dispose();
    };
    return { manager, history };
  });
}

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('archived Agents route', () => {
  it('resolves archive before the agent-session parameter and survives a deep-link reload', () => {
    const route = decodePane(routes, ['agents', 'archive'])!;
    expect(formatPanePath(routes, route)).toBe('/agents/archive');
    expect(splitContentFromLocation({ route })).toEqual(agentsArchiveContent());
    const { manager, history } = setup('/agents/archive');
    expect(manager.activeSplit()?.content().id).toBe('agents-archive');
    expect(history.read().path).toBe('/agents/archive');
    expect(formatPanePath(routes, agentsArchiveLocation().route)).toBe(
      '/agents/archive'
    );
  });

  it.each([undefined, { route: paneRoute({ id: 'view-agents', params: {} }) }])(
    'migrates legacy in-place archive state even with old route metadata',
    (entryMetadata) => {
      const saved: SplitContent = {
        type: 'component',
        id: 'agents',
        params: { agentPage: 'archived' },
        entryMetadata,
      };
      const location = resolveContentLocation(routes, saved);
      expect(formatPanePath(routes, location.route)).toBe('/agents/archive');
      expect(splitContentFromLocation(location)).toEqual(
        agentsArchiveContent()
      );
    }
  );

  it('restores the same pane through Back and Forward without an extra archive entry', () => {
    const { manager, history } = setup('/agents');
    const pane = manager.activeSplit()!;
    manager.openWithSplit(agentsArchiveContent(), { handle: pane, search: {} });
    expect(history.read().path).toBe('/agents/archive');
    expect(pane.content().id).toBe('agents-archive');
    // The desktop Conversations action uses the same handle method.
    pane.replace({ next: { type: 'component', id: 'agents' } });
    expect(history.read().path).toBe('/agents');
    history.back();
    expect(history.read().path).toBe('/agents/archive');
    expect(pane.content().id).toBe('agents-archive');
    history.back();
    expect(history.read().path).toBe('/agents');
    history.forward();
    expect(history.read().path).toBe('/agents/archive');
    expect(pane.content().id).toBe('agents-archive');
    expect(manager.splits()).toHaveLength(1);
  });
});
