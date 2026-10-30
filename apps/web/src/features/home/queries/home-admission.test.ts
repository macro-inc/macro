import type { EntityData, WithNotification } from '@entity';
import { describe, expect, it, vi } from 'vitest';
import { admitHomeEntities, emptyHomeAdmission } from './home-admission';

// The soup barrel the facets pull in transitively imports the websocket
// client modules, which open real sockets at module scope and reject under
// jsdom.
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

// An unseen invite: unread by its notifications, seen by the server.
const invite = {
  id: 'channel',
  type: 'channel',
  name: 'General',
  notifications: () => [{ id: 'invite', state: 'unseen' }],
} as unknown as WithNotification<EntityData>;

const comment = {
  id: 'doc',
  type: 'document',
  name: 'Plan',
  notifications: () => [],
} as unknown as WithNotification<EntityData>;

const admit = (
  read: string,
  unread: Set<string>,
  previous = emptyHomeAdmission()
) =>
  admitHomeEntities(previous, {
    entities: [invite, comment],
    tab: 'signal',
    facets: { read: [read] },
    facetContext: {},
    isUnread: (entity) => unread.has(entity.id),
  });

const ids = (admission: ReturnType<typeof admit>) =>
  admission.items.map((entity) => entity.id);

describe('admitHomeEntities', () => {
  it('reads the source state instead of the notifications', () => {
    const unread = new Set(['doc']);
    expect(ids(admit('unread', unread))).toEqual(['doc']);
    expect(ids(admit('read', unread))).toEqual(['channel']);
  });

  it('keeps a row that turns read where it is shown', () => {
    const shown = admit('unread', new Set(['doc']));
    expect(ids(admit('unread', new Set(), shown))).toEqual(['doc']);
  });
});
