import {
  createRoutesManifest,
  decodeRoute,
} from '@app/lib/split-router/routes';
import { describe, expect, it, vi } from 'vitest';
import { appSplitRoutes } from '../split-router/app-routes';

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

vi.mock('../split-router/app-views', () => {
  throw new Error('Route declarations must not eagerly load application views');
});
vi.mock('@app/features/drive-view/components/DriveDetailView', () => {
  throw new Error('Route declarations must not eagerly load document views');
});

describe('application route import isolation', () => {
  it('builds and decodes routes without initializing view modules', () => {
    const routes = createRoutesManifest(appSplitRoutes);
    for (const path of [
      ['mail'],
      ['tasks'],
      ['settings', 'account'],
      ['drive', 'md', 'doc'],
    ]) {
      expect(decodeRoute(routes, path)).toBeDefined();
    }
  });
});
