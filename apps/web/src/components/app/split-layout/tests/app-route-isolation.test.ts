import {
  routineContent,
  routineIdFromContent,
} from '@app/features/routines/routine-navigation';
import {
  createRoutesManifest,
  decodeRoute,
  encodeRoute,
} from '@app/lib/split-router/routes';
import { describe, expect, it, vi } from 'vitest';
import { appSplitRoutes } from '../split-router/app-routes';
import {
  resolveContentLocation,
  splitContentFromLocation,
  splitLocationFromContent,
} from '../split-router/legacy-route';

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

vi.mock('@app/features/activity/views/my-activity-view', () => {
  throw new Error('Route declarations must not eagerly load activity views');
});
vi.mock('../componentRegistry', () => {
  throw new Error('Route declarations must not eagerly load the registry');
});
vi.mock('@app/features/agents-view/views/AgentsView', () => {
  throw new Error('Route declarations must not eagerly load agent views');
});
vi.mock('@app/features/getting-started', () => {
  throw new Error('Route declarations must not eagerly load onboarding views');
});
vi.mock('@app/features/next-soup/soup-view/soup-view', () => {
  throw new Error('Route declarations must not eagerly load Soup views');
});
vi.mock('@app/features/settings/Settings', () => {
  throw new Error('Route declarations must not eagerly load settings views');
});

describe('application route import isolation', () => {
  it('opens routine list, details, and creation through canonical routes', () => {
    const routes = createRoutesManifest(appSplitRoutes);
    for (const [path, routeId] of [
      [['routines'], 'view-routines'],
      [['routines', 'routine-1'], 'routine-detail'],
      [['routines', 'new'], 'routine-create'],
    ] as const) {
      const entry = decodeRoute(routes, [...path]);
      expect(entry?.location.route.matches[0].id).toBe(routeId);
      const content = splitContentFromLocation(entry!.location);
      expect(content).toMatchObject({ type: 'component', id: 'routines' });
      expect(
        encodeRoute(routes, {
          location: resolveContentLocation(routes, content),
        })
      ).toEqual(path);
    }
  });

  it('canonicalizes existing routine links and block navigation', () => {
    const routes = createRoutesManifest(appSplitRoutes);
    for (const id of ['routine-1', 'new']) {
      for (const type of ['routine', 'automation']) {
        const entry = decodeRoute(routes, [type, id]);
        expect(encodeRoute(routes, entry!)).toEqual(['routines', id]);
        const saved = JSON.parse(
          JSON.stringify({
            type,
            id,
            entryMetadata: {
              route: {
                matches: [{ id: 'legacy-content', params: { type, id } }],
              },
            },
          })
        );
        expect(
          encodeRoute(routes, {
            location: resolveContentLocation(routes, saved),
          })
        ).toEqual(['routines', id]);
        expect(
          encodeRoute(routes, {
            location: resolveContentLocation(routes, {
              ...saved,
              entryMetadata: undefined,
            }),
          })
        ).toEqual(['routines', id]);
      }
      const location = splitLocationFromContent(routes, {
        type: 'routine',
        id,
      });
      expect(encodeRoute(routes, { location })).toEqual(['routines', id]);
    }
  });

  it('restores routine identity from the route instead of stale component params', () => {
    const current = routineContent('routine-b');
    expect(
      routineIdFromContent({ ...current, params: { routineId: 'routine-a' } })
    ).toBe('routine-b');
    expect(
      routineIdFromContent({
        ...routineContent(),
        params: { routineId: 'routine-a' },
      })
    ).toBeUndefined();
  });

  it('routes debug views and canonicalizes their legacy URLs', () => {
    const routes = createRoutesManifest(appSplitRoutes);
    for (const id of ['ui', 'icon-gallery']) {
      const route = decodeRoute(routes, ['debug', id]);
      expect(route?.location.route.matches[0].id).toBe(`view-${id}`);
      const legacy = decodeRoute(routes, ['component', id]);
      expect(legacy).toEqual(route);
      expect(encodeRoute(routes, legacy!)).toEqual(['debug', id]);
    }
  });

  it('builds and decodes routes without initializing remaining lazy view modules', () => {
    const routes = createRoutesManifest(appSplitRoutes);
    for (const path of [
      ['mail'],
      ['tasks'],
      ['settings', 'account'],
      ['drive', 'md', 'doc'],
      ['calendar', 'week'],
      ['channels', 'channel-id'],
    ]) {
      expect(decodeRoute(routes, path)).toBeDefined();
    }
    expect(decodeRoute(routes, ['channels', 'channel', 'channel-id'])).toBe(
      undefined
    );
  });
});
