import {
  createMemoryHistory,
  createMemoryPaneStore,
  createRoutesManifest,
  createSplitRouter,
  formatPanePath,
  type SplitRoutes,
} from '@app/lib/split-router';
import {
  agentDashboardRoute,
  appRoute,
  dashboardRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { createSplitLayout } from '@components/app/split-layout/layoutManager';
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
  agentDashboardLocation,
  dashboardContentFromLocation,
  dashboardLocation,
} from './dashboard-navigation';

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
        agentDashboardRoute,
        dashboardRoute,
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => dashboardLocation('default').route,
};
const routes = createRoutesManifest(definitions);
let cleanup: (() => void) | undefined;

/** Open the app cold at `path`, through the app's real pane policy. */
function openApp(path: string) {
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
        defaultLocation: () => dashboardLocation('default'),
        stacked: () => false,
      }),
    });
    const orchestrator = {
      isBlockMounted: vi.fn(() => false),
      createBlockInstance: vi.fn(),
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
    return { manager, history, router };
  });
}

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const AGENT = 'macro|agent@example.com';
const DASHBOARD = '0190f5a4-0000-7000-8000-000000000009';

describe('opening a dashboard from a URL', () => {
  it("opens an agent account's page cold", () => {
    const { manager, history } = openApp(
      `/agent-accounts/${encodeURIComponent(AGENT)}`
    );

    expect(manager.splits().map((split) => split.content)).toEqual([
      expect.objectContaining({
        type: 'component',
        id: 'agent-dashboard',
        params: { userId: AGENT },
      }),
    ]);
    expect(history.read().path).toBe(
      `/agent-accounts/${encodeURIComponent(AGENT)}`
    );
  });

  it('opens a dashboard by id cold', () => {
    const { manager, history } = openApp(`/dashboard/${DASHBOARD}`);

    expect(manager.splits().map((split) => split.content)).toEqual([
      expect.objectContaining({
        type: 'component',
        id: 'dashboard',
        params: { dashboardId: DASHBOARD },
      }),
    ]);
    expect(history.read().path).toBe(`/dashboard/${DASHBOARD}`);
  });

  it("opens an agent's page in a new pane, as the DM header's Dashboard action does", async () => {
    const { manager, router } = openApp(`/dashboard/${DASHBOARD}`);

    await router.open(
      { route: agentDashboardRoute, params: { userId: AGENT } },
      { newPane: true }
    );

    expect(manager.splits().map((split) => split.content)).toEqual([
      expect.objectContaining({ id: 'dashboard' }),
      expect.objectContaining({
        type: 'component',
        id: 'agent-dashboard',
        params: { userId: AGENT },
      }),
    ]);
  });

  it('restores saved split content to the same URL', () => {
    for (const location of [
      agentDashboardLocation(AGENT),
      dashboardLocation(DASHBOARD),
    ]) {
      const content = dashboardContentFromLocation(location);
      if (!content) throw new Error('expected dashboard content');

      const { entryMetadata: _metadata, ...saved } = content;
      expect(
        formatPanePath(routes, resolveContentLocation(routes, saved).route)
      ).toBe(formatPanePath(routes, location.route));
    }
  });
});
