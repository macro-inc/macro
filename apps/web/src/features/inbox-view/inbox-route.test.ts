import {
  createRoutesManifest,
  decodeRoute,
  encodeRoute,
  getRouteClaim,
} from '@app/lib/split-router';
import { expect, it, vi } from 'vitest';
import { inboxSplitRoute } from './route';

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

const routes = createRoutesManifest({ definitions: [inboxSplitRoute] });

it.each([
  ['channel', 'channel-1', 'inbox-channel', 'channel:channel-1'],
  ['md', 'document-1', 'inbox-document', 'md:document-1'],
  ['task', 'task-1', 'inbox-document', 'md:task-1'],
  ['pdf', 'pdf-1', 'inbox-document', 'pdf:pdf-1'],
  ['email', 'thread-1', 'inbox-preview', 'email:thread-1'],
  ['unknown', 'foreign-1', 'inbox-document', 'unknown:foreign-1'],
] as const)(
  'routes /inbox/%s/%s through %s without changing its URL',
  (type, id, routeId, claimId) => {
    const entry = decodeRoute(routes, ['inbox', type, id]);
    expect(entry?.location.route.matches.at(-1)?.id).toBe(routeId);
    expect(encodeRoute(routes, entry!)).toEqual(['inbox', type, id]);
    expect(getRouteClaim(routes, entry!.location.route)).toEqual({
      namespace: 'block',
      id: claimId,
    });
  }
);

it('keeps the Calendar child ahead of block routes', () => {
  const entry = decodeRoute(routes, ['inbox', 'calendar', 'week']);
  expect(entry?.location.route.matches.at(-1)?.id).toBe('inbox-calendar');
});
