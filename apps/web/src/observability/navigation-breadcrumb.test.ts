import {
  createRoutesManifest,
  decodePane,
  type Entry,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  agentsRoute,
  appRoute,
  legacyContentRoute,
  notFoundRoute,
  searchRoute,
} from '@app/routes/routes';
import { describe, expect, it, vi } from 'vitest';
import { navigationBreadcrumb } from './navigation-breadcrumb';

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

const routes = createRoutesManifest({
  definitions: [
    {
      ...appRoute,
      children: [searchRoute, agentsRoute, legacyContentRoute, notFoundRoute],
    },
  ],
  defaultRoute: () => paneRoute({ id: searchRoute.id, params: {} }),
} satisfies SplitRoutes);

const entry = (path: string): Entry => {
  const route = decodePane(routes, path.split('/').filter(Boolean));
  if (!route) throw new Error(`no route for ${path}`);
  return { id: path, location: { route } };
};

describe('navigation breadcrumbs', () => {
  it('names a DM opened from Search by route and block type', () => {
    expect(
      navigationBreadcrumb({
        routes,
        from: entry('search'),
        to: entry('channel/0196a706-e489-7f6f-92ed-1a1440c62fd1'),
        cause: 'navigate',
      })
    ).toEqual({
      kind: 'navigated',
      cause: 'navigate',
      route: 'legacy-content',
      from_route: 'view-search',
      entity_type: 'channel',
    });
  });

  it('takes the type of a non-block claim from its namespace', () => {
    expect(
      navigationBreadcrumb({
        routes,
        from: undefined,
        to: entry('agents/01a1609c-18a6-7077-a7ee-60c97d9ba8f9'),
        cause: 'external',
      })
    ).toMatchObject({
      route: 'agents',
      from_route: null,
      entity_type: 'agent',
    });
  });

  it('reports no entity for views and unrecognised ids', () => {
    expect(
      navigationBreadcrumb({
        routes,
        from: undefined,
        to: entry('search'),
        cause: 'initial',
      })
    ).toMatchObject({ route: 'view-search', entity_type: null });
    expect(
      navigationBreadcrumb({
        routes,
        from: undefined,
        to: entry('agents/not-a-uuid'),
        cause: 'navigate',
      })
    ).toMatchObject({ route: 'agents', entity_type: null });
  });
});
