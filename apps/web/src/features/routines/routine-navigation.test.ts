import {
  createMemoryHistory,
  createMemoryPaneStore,
  createRoutesManifest,
  createSplitRouter,
  decodePane,
  formatPanePath,
  type SplitRoutes,
} from '@app/lib/split-router';
import {
  agentsViewRoute,
  appRoute,
  legacyContentRoute,
  notFoundRoute,
  routineCreateRoute,
  routineDetailRoute,
  routinesRoute,
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
import { createMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import type { BlockOrchestrator } from '@core/orchestrator';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  routineContent,
  routineIdFromContent,
  routineLocation,
} from './routine-navigation';

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
        routinesRoute,
        agentsViewRoute,
        routineCreateRoute,
        routineDetailRoute,
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => routineLocation().route,
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
        defaultLocation: routineLocation,
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
    return { manager, router, history };
  });
}

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('routine navigation', () => {
  it.each([undefined, 'routine-a', 'new'])(
    'round-trips the routine destination %s through the app router',
    (id) => {
      const location = routineLocation(id);
      const path = formatPanePath(routes, location.route);
      expect(path).toBe(id ? `/routines/${id}` : '/routines');
      const decoded = decodePane(routes, path.slice(1).split('/'))!;
      expect(splitContentFromLocation({ route: decoded })).toEqual(
        routineContent(id)
      );
    }
  );

  it.each(['routine', 'automation'])(
    'canonicalizes existing %s links, including creation links',
    (type) => {
      for (const id of ['routine-a', 'new']) {
        const route = decodePane(routes, [type, id])!;
        expect(formatPanePath(routes, route)).toBe(`/routines/${id}`);
      }
      const id = '018f18ee-9747-7152-8a5f-4aa2d83d1f62';
      expect(
        createMacroMentionLinkResolver(routes)(
          `${window.location.origin}/app/${type}/${id}`
        )
      ).toEqual({ id, block: 'routine', params: {} });
    }
  );

  it('restores older pane data and prefers the current route over stale params', () => {
    const saved: SplitContent[] = [
      { type: 'routine', id: 'routine-b' },
      {
        type: 'component',
        id: 'agents',
        params: { agentPage: 'routines', routineId: 'routine-b' },
      },
      {
        ...routineContent('routine-b'),
        params: { routineId: 'routine-a' },
        entryMetadata: {
          route: {
            matches: [
              { id: 'routine-detail', params: { routineId: 'routine-b' } },
            ],
          },
        },
      },
    ];
    for (const content of saved) {
      const location = resolveContentLocation(routes, content);
      expect(formatPanePath(routes, location.route)).toBe(
        '/routines/routine-b'
      );
    }
    expect(
      routineIdFromContent({
        ...routineContent(),
        params: { routineId: 'routine-a' },
      })
    ).toBeUndefined();
  });

  it.each([
    '/md/document-a/automation/routine-a',
    '/automation/routine-a/md/document-a',
    '/md/document-a/~/automation/routine-a',
    '/automation/routine-a/~/md/document-a',
  ])('restores every pane in a saved layout: %s', (path) => {
    const { manager, history } = setup(path);
    expect(manager.splits()).toHaveLength(2);
    const contents = manager.splits().map((split) => split.content);
    expect(contents).toContainEqual(
      expect.objectContaining({ type: 'md', id: 'document-a' })
    );
    expect(contents.some((c) => routineIdFromContent(c) === 'routine-a')).toBe(
      true
    );
    expect(history.read().path).not.toContain('automation');
    expect(history.read().path).toContain('routines/routine-a');
  });

  it('updates the same pane and restores routine identity on Back and Forward', () => {
    const { manager, history } = setup('/routines');
    const pane = manager.activeSplit()!;
    for (const id of ['routine-a', 'routine-b']) {
      manager.openWithSplit(routineContent(id), { handle: pane, search: {} });
      expect(manager.splits()).toHaveLength(1);
      expect(history.read().path).toBe(`/routines/${id}`);
      expect(routineIdFromContent(pane.content())).toBe(id);
    }
    history.back();
    expect(routineIdFromContent(pane.content())).toBe('routine-a');
    history.back();
    expect(routineIdFromContent(pane.content())).toBeUndefined();
    history.forward();
    expect(routineIdFromContent(pane.content())).toBe('routine-a');
  });
  it('restores the chosen Agents management page when leaving routines and going Back', () => {
    const { manager, history } = setup('/routines');
    const pane = manager.activeSplit()!;
    manager.openWithSplit(
      {
        type: 'component',
        id: 'agents',
        preserveParams: true,
        params: {
          agentPage: 'connections',
          agentPageRequest: 'open-connections',
        },
      },
      { handle: pane, search: {} }
    );
    manager.openWithSplit(routineContent('routine-a'), {
      handle: pane,
      search: {},
    });
    history.back();
    expect(pane.content()).toMatchObject({
      id: 'agents',
      params: { agentPage: 'connections' },
    });
    history.forward();
    expect(routineIdFromContent(pane.content())).toBe('routine-a');
  });
});
