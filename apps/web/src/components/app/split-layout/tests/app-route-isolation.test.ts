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

vi.mock('@app/features/activity/views/my-activity-view', () => {
  throw new Error('Route declarations must not eagerly load activity views');
});
vi.mock('@app/features/agents-view/views/AgentsView', () => {
  throw new Error('Route declarations must not eagerly load agent views');
});
vi.mock('@app/features/calendar-view/calendar-view', () => {
  throw new Error('Route declarations must not eagerly load Calendar views');
});
vi.mock('@app/features/channels-view/channels-view', () => {
  throw new Error('Route declarations must not eagerly load channel views');
});
vi.mock('@app/features/drive-view/drive-view', () => {
  throw new Error('Route declarations must not eagerly load Drive views');
});
vi.mock('@app/features/drive-view/components/DriveDetailView', () => {
  throw new Error('Route declarations must not eagerly load document views');
});
vi.mock('@app/features/email-view/email-view', () => {
  throw new Error('Route declarations must not eagerly load email views');
});
vi.mock('@app/features/email-view/components/EmailDetailView', () => {
  throw new Error('Route declarations must not eagerly load email details');
});
vi.mock('@app/features/getting-started', () => {
  throw new Error('Route declarations must not eagerly load onboarding views');
});
vi.mock('@app/features/home', () => {
  throw new Error('Route declarations must not eagerly load home views');
});
vi.mock('@app/features/inbox-view/inbox-view', () => {
  throw new Error('Route declarations must not eagerly load inbox views');
});
vi.mock('@app/features/next-soup/soup-view/soup-view', () => {
  throw new Error('Route declarations must not eagerly load Soup views');
});
vi.mock('@app/features/settings/Settings', () => {
  throw new Error('Route declarations must not eagerly load settings views');
});
vi.mock('@app/features/tasks-view/tasks-view', () => {
  throw new Error('Route declarations must not eagerly load task views');
});
vi.mock('@app/features/tasks-view/components/TasksDetailView', () => {
  throw new Error('Route declarations must not eagerly load task details');
});

describe('application route import isolation', () => {
  it('builds and decodes routes without initializing view modules', () => {
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
