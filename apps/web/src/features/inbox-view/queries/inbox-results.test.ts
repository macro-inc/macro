import type { EntityData, WithNotification } from '@entity';
import { describe, expect, it, vi } from 'vitest';
import { buildInboxQuery } from './inbox-query';
import { groupInboxEntitiesByDate, inboxGroupTimestamp } from './inbox-results';

// The soup barrel these pull in transitively imports the websocket client
// modules, which open real sockets at module scope and reject under jsdom.
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

const now = new Date('2026-09-02T18:00:00Z');

// A task edited two days ago that the viewer was notified about an hour ago:
// the shape of the "fresh comment sorts into Yesterday" bug.
const staleTaskFreshComment = {
  id: 'task',
  type: 'document',
  name: 'Ship the tagging system',
  ownerId: 'macro|alice@example.com',
  updatedAt: '2026-08-31T19:00:00Z',
  notifiedAt: '2026-09-02T17:00:00Z',
} as unknown as WithNotification<EntityData>;

const freshEmail = {
  id: 'email',
  type: 'email',
  name: 'Welcome',
  ownerId: 'macro|alice@example.com',
  updatedAt: '2026-09-02T16:00:00Z',
  sortTs: '2026-09-02T16:00:00Z',
} as unknown as WithNotification<EntityData>;

const context = {
  facets: {},
  facetContext: { notificationSource: undefined as never },
  capabilities: {
    calendar: false,
    foreignEntities: false,
    reminders: false,
    snippets: false,
  },
  userId: 'macro|alice@example.com',
};

describe('inbox sort method per tab', () => {
  it('orders the notification tabs by latest notification', () => {
    for (const tab of ['signal', 'noise'] as const) {
      expect(buildInboxQuery({ ...context, tab }).params.sort_method).toBe(
        'notified_at'
      );
    }
  });

  it('keeps recency ordering on the other tabs', () => {
    for (const tab of ['all', 'reminders'] as const) {
      expect(buildInboxQuery({ ...context, tab }).params.sort_method).toBe(
        'updated_at'
      );
    }
  });
});

describe('inbox date buckets', () => {
  it('buckets a notified row by its notification on the notification tabs', () => {
    expect(inboxGroupTimestamp(staleTaskFreshComment, 'signal')).toBe(
      '2026-09-02T17:00:00Z'
    );
    const groups = groupInboxEntitiesByDate(
      [freshEmail, staleTaskFreshComment],
      'signal',
      now
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
  });

  it('falls back to content recency without a stamp and on the other tabs', () => {
    expect(inboxGroupTimestamp(freshEmail, 'signal')).toBe(
      '2026-09-02T16:00:00Z'
    );
    expect(inboxGroupTimestamp(staleTaskFreshComment, 'all')).toBe(
      '2026-08-31T19:00:00Z'
    );
    const groups = groupInboxEntitiesByDate(
      [freshEmail, staleTaskFreshComment],
      'all',
      now
    );
    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Last 7 days',
    ]);
  });
});
