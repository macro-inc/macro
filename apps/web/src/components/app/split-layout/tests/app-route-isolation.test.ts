import { appendFileSync } from 'node:fs';
import {
  createRoutesManifest,
  decodeRoute,
  encodeRoute,
} from '@app/lib/split-router/routes';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let appSplitRoutes: typeof import('../split-router/app-routes')['appSplitRoutes'];

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
vi.mock('@app/features/home', () => {
  throw new Error('Route declarations must not eagerly load home views');
});
vi.mock('@app/features/next-soup/soup-view/soup-view', () => {
  throw new Error('Route declarations must not eagerly load Soup views');
});
vi.mock('@app/features/settings/Settings', () => {
  throw new Error('Route declarations must not eagerly load settings views');
});

beforeAll(async () => {
  // #region agent log
  appendFileSync(
    '/opt/cursor/logs/debug.log',
    `${JSON.stringify({ hypothesisId: 'A,C,E', location: 'app-route-isolation.test.ts:before-route-import', message: 'route import starting', data: { broadcastChannelType: typeof globalThis.BroadcastChannel, resources: process.getActiveResourcesInfo() }, timestamp: Date.now() })}\n`
  );
  // #endregion
  const OriginalBroadcastChannel = globalThis.BroadcastChannel;
  if (OriginalBroadcastChannel) {
    vi.stubGlobal(
      'BroadcastChannel',
      class extends OriginalBroadcastChannel {
        constructor(name: string) {
          super(name);
          // #region agent log
          appendFileSync(
            '/opt/cursor/logs/debug.log',
            `${JSON.stringify({ hypothesisId: 'A', location: 'app-route-isolation.test.ts:BroadcastChannel', message: 'route import constructed BroadcastChannel', data: { name, resources: process.getActiveResourcesInfo() }, timestamp: Date.now() })}\n`
          );
          // #endregion
        }
      }
    );
  }
  ({ appSplitRoutes } = await import('../split-router/app-routes'));
  // #region agent log
  appendFileSync(
    '/opt/cursor/logs/debug.log',
    `${JSON.stringify({ hypothesisId: 'A,C,E', location: 'app-route-isolation.test.ts:after-route-import', message: 'route import finished', data: { resources: process.getActiveResourcesInfo() }, timestamp: Date.now() })}\n`
  );
  // #endregion
});

describe('application route import isolation', () => {
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
