import type { EntityData, WithNotification } from '@entity';
import { soupPageTimestamp } from '@queries/soup/page-timestamp';
import { describe, expect, it, vi } from 'vitest';
import { getHomePagination } from './home-pagination';
import { buildInboxQuery } from './inbox-query';
import {
  groupHomeEntitiesByDate,
  groupInboxEntitiesByDate,
  inboxGroupTimestamp,
  mergeHomeEntities,
} from './inbox-results';

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

const capabilities = {
  calendar: false,
  foreignEntities: false,
  notifiedSort: true,
  reminders: false,
  snippets: false,
};

const context = {
  facets: {},
  facetContext: { notificationSource: undefined as never },
  capabilities,
  userId: 'macro|alice@example.com',
};

const withoutNotifiedSort = {
  ...context,
  capabilities: { ...capabilities, notifiedSort: false },
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
    expect(
      buildInboxQuery({ ...context, tab: 'reminders' }).params.sort_method
    ).toBe('updated_at');
  });

  it('keeps recency ordering everywhere while the notified sort is off', () => {
    for (const tab of ['signal', 'noise', 'reminders'] as const) {
      expect(
        buildInboxQuery({ ...withoutNotifiedSort, tab }).params.sort_method
      ).toBe('updated_at');
    }
  });
});

describe('inbox date buckets', () => {
  it('buckets a notified row by its notification on the notification tabs', () => {
    const signal = { tab: 'signal' as const, capabilities };
    expect(inboxGroupTimestamp(staleTaskFreshComment, signal)).toBe(
      '2026-09-02T17:00:00Z'
    );
    const groups = groupInboxEntitiesByDate(
      [freshEmail, staleTaskFreshComment],
      signal,
      now
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
  });

  it('falls back to content recency without a stamp and on the other tabs', () => {
    expect(
      inboxGroupTimestamp(freshEmail, { tab: 'signal', capabilities })
    ).toBe('2026-09-02T16:00:00Z');
    const reminders = { tab: 'reminders' as const, capabilities };
    expect(inboxGroupTimestamp(staleTaskFreshComment, reminders)).toBe(
      '2026-08-31T19:00:00Z'
    );
    const groups = groupInboxEntitiesByDate(
      [freshEmail, staleTaskFreshComment],
      reminders,
      now
    );
    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Last 7 days',
    ]);
  });

  it('still buckets a stamped row by its notification while the server sort is off', () => {
    // The server notified_at sort is gated for cost, but a websocket
    // notification stamps `notifiedAt` locally and the row must re-bucket
    // there regardless — otherwise a fresh comment on a stale task sinks into
    // an old date section until a refetch catches up.
    const signal = {
      tab: 'signal' as const,
      capabilities: withoutNotifiedSort.capabilities,
    };
    expect(inboxGroupTimestamp(staleTaskFreshComment, signal)).toBe(
      '2026-09-02T17:00:00Z'
    );
    // A row without a stamp still falls back to content recency.
    expect(inboxGroupTimestamp(freshEmail, signal)).toBe(
      '2026-09-02T16:00:00Z'
    );
    const groups = groupInboxEntitiesByDate(
      [freshEmail, staleTaskFreshComment],
      signal,
      now
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
  });
});

describe('Home activity and notifications', () => {
  const signal = { tab: 'signal' as const, capabilities };
  const recent = (id: string, touchedAt: string) => ({
    ...staleTaskFreshComment,
    id,
    notifiedAt: undefined,
    // Someone else's later edit must not determine my recency.
    updatedAt: '2026-09-03T12:00:00Z',
    touchedAt,
  });

  it('includes own activity without notifications and sorts by own action time', () => {
    const rows = mergeHomeEntities(
      [staleTaskFreshComment],
      [
        recent('older', '2026-09-01T12:00:00Z'),
        recent('newer', '2026-09-02T18:00:00Z'),
      ],
      signal
    );
    expect(rows.map((row) => row.id)).toEqual(['newer', 'task', 'older']);
    expect(rows[2].sortTs).toBe('2026-09-01T12:00:00Z');
    expect(
      groupInboxEntitiesByDate(
        rows,
        signal,
        now,
        (entity) => entity.sortTs
      ).map((group) => group.label)
    ).toEqual(['Today', 'Yesterday']);
  });

  it('deduplicates an entity, retaining notifications and the latest relevant timestamp', () => {
    const notifications = () => [];
    const notified = { ...staleTaskFreshComment, notifications };
    const rows = mergeHomeEntities(
      [notified],
      [recent('task', '2026-09-02T18:00:00Z')],
      signal
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].notifications).toBe(notifications);
    expect(rows[0].sortTs).toBe('2026-09-02T18:00:00Z');
    expect(rows[0].notifiedAt).toBe(notified.notifiedAt);
    expect(notified.sortTs).toBeUndefined();
    expect(
      mergeHomeEntities(
        [notified],
        [recent('task', '2026-09-01T12:00:00Z')],
        signal
      )[0].sortTs
    ).toBe(notified.notifiedAt);
  });

  it('keeps sent mail and AI chats without requiring an unread notification', () => {
    const sent = {
      ...freshEmail,
      done: true,
      isRead: true,
      touchedAt: '2026-09-02T18:00:00Z',
    };
    const chat = {
      ...recent('chat', '2026-09-02T17:00:00Z'),
      type: 'chat' as const,
    };
    expect(
      mergeHomeEntities([], [sent, chat], signal).map((row) => row.type)
    ).toEqual(['email', 'chat']);
  });

  it('keeps multiple reply threads separate from their parent channel and own activity', () => {
    const channel: WithNotification<EntityData> = {
      type: 'channel',
      id: 'channel',
      name: 'Support',
      ownerId: 'alice',
      channelType: 'public',
      touchedAt: '2026-09-02T16:00:00Z',
    };
    const thread: WithNotification<EntityData> = {
      type: 'channel_thread',
      id: 'root-1',
      name: 'Channel thread',
      ownerId: 'alice',
      channelId: channel.id,
      messageId: 'root-1',
      threadId: 'root-1',
      senderId: 'alice',
      sender: { id: 'alice', type: 'user' },
      content: 'First discussion',
      attachments: [],
      reactions: [],
      thread: { replyCount: 2, preview: [] },
      notifiedAt: '2026-09-02T18:00:00Z',
      notifications: () => [],
    };
    const secondThread = {
      ...thread,
      id: 'root-2',
      messageId: 'root-2',
      threadId: 'root-2',
      notifiedAt: '2026-09-02T17:00:00Z',
    };
    const rows = mergeHomeEntities(
      [thread, secondThread],
      [channel, { ...thread, touchedAt: '2026-09-02T15:00:00Z' }],
      signal
    );
    expect(rows.map(({ type, id }) => [type, id])).toEqual([
      ['channel_thread', 'root-1'],
      ['channel_thread', 'root-2'],
      ['channel', 'channel'],
    ]);
    expect(rows[0].notifications).toBe(thread.notifications);
    expect(rows[0].sortTs).toBe(thread.notifiedAt);
  });

  it('rejects cache inserts without a recorded own touch', () => {
    expect(mergeHomeEntities([], [freshEmail], signal)).toEqual([]);
  });

  it('uses fresher content without losing notification metadata or own activity', () => {
    const notifications = () => [];
    const notified = { ...staleTaskFreshComment, notifications };
    const edited = {
      ...recent('task', '2026-09-01T12:00:00Z'),
      name: 'Renamed',
    };
    const [row] = mergeHomeEntities([notified], [edited], signal);
    expect(row.name).toBe('Renamed');
    expect(row.updatedAt).toBe(edited.updatedAt);
    expect(row.sortTs).toBe(notified.notifiedAt);
    expect(row.notifications).toBe(notifications);
    expect(row.touchedAt).toBe(edited.touchedAt);
    expect(notified.name).toBe(staleTaskFreshComment.name);
    expect(edited.sortTs).toBeUndefined();
  });

  it('keeps the freshest content and timestamps across overlapping pages', () => {
    const newest = {
      ...recent('task', '2026-09-02T18:00:00Z'),
      name: 'Latest',
    };
    const older = {
      ...recent('task', '2026-09-01T12:00:00Z'),
      updatedAt: '2026-08-01T12:00:00Z',
    };
    for (const recents of [
      [newest, older],
      [older, newest],
    ]) {
      const [row] = mergeHomeEntities([staleTaskFreshComment], recents, signal);
      expect(row.name).toBe('Latest');
      expect(row.touchedAt).toBe(newest.touchedAt);
      expect(row.notifiedAt).toBe(staleTaskFreshComment.notifiedAt);
      expect(row.sortTs).toBe(newest.touchedAt);
    }
  });

  it('keeps the latest notification across duplicate notification pages', () => {
    const older = {
      ...staleTaskFreshComment,
      notifiedAt: '2026-08-01T12:00:00Z',
    };
    expect(
      mergeHomeEntities([staleTaskFreshComment, older], [], signal)[0]
        .notifiedAt
    ).toBe(staleTaskFreshComment.notifiedAt);
  });

  it('orders timestamp ties by entity identity, independently of source order', () => {
    const a = recent('a', '2026-09-02T18:00:00Z');
    const b = recent('b', '2026-09-02T18:00:00Z');
    expect(mergeHomeEntities([], [b, a], signal).map((row) => row.id)).toEqual([
      'a',
      'b',
    ]);
    expect(mergeHomeEntities([], [a, b], signal).map((row) => row.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('sorts sections and rows independently of arrival order, including clock skew and invalid dates', () => {
    const reference = new Date(2026, 8, 14, 10);
    const row = (id: string, sortTs: Date | string | undefined) => ({
      ...staleTaskFreshComment,
      id,
      sortTs,
    });
    const entities = [
      row('morning', new Date(2026, 8, 14, 8)),
      row('invalid', 'bad date'),
      row('hour-b', new Date(2026, 8, 14, 9, 30)),
      row('skew', new Date(2026, 8, 14, 10, 0, 1)),
      row('hour-a', new Date(2026, 8, 14, 9, 30)),
      row('recent', new Date(2026, 8, 14, 9, 59)),
      row('yesterday', new Date(2026, 8, 13, 20)),
      row('missing', undefined),
    ];
    const expected = [
      ['last-few-minutes', ['skew', 'recent']],
      ['last-hour', ['hour-a', 'hour-b']],
      ['this-morning', ['morning']],
      ['yesterday', ['yesterday']],
      ['older', ['invalid', 'missing']],
    ];
    for (let offset = 0; offset < entities.length; offset++) {
      const shuffled = [
        ...entities.slice(offset),
        ...entities.slice(0, offset),
      ];
      expect(
        groupHomeEntitiesByDate(shuffled, reference).map((group) => [
          group.id,
          group.entities.map((entity) => entity.id),
        ])
      ).toEqual(expected);
    }
    expect(entities[0].id).toBe('morning');
  });

  it('does not let an invalid duplicate timestamp discard valid sort evidence', () => {
    const valid = recent('task', '2026-09-02T18:00:00Z');
    const invalid = { ...staleTaskFreshComment, notifiedAt: 'bad date' };
    for (const notifications of [
      [invalid, staleTaskFreshComment],
      [staleTaskFreshComment, invalid],
    ]) {
      const [row] = mergeHomeEntities(notifications, [valid], signal);
      expect(row.sortTs).toBe(valid.touchedAt);
      expect(row.notifiedAt).toBe(staleTaskFreshComment.notifiedAt);
    }
  });
});

describe('Home pagination', () => {
  const signal = { tab: 'signal' as const, capabilities };
  const entity = (id: string, day: number): EntityData => ({
    type: 'chat',
    id,
    name: id,
    ownerId: 'alice',
    updatedAt: new Date(2026, 8, day),
    notifiedAt: new Date(2026, 8, day),
    touchedAt: new Date(2026, 8, day),
  });
  const page = (entities: EntityData[], hasMore = true, isLoading = false) => ({
    entities,
    hasMore,
    isLoading,
    get oldestFetchedTimestamp() {
      return soupPageTimestamp(this.entities, 'touched_by_me');
    },
  });
  const visible = (
    notifications: ReturnType<typeof page>,
    activity: ReturnType<typeof page>
  ) => {
    const { cutoff } = getHomePagination(notifications, activity);
    return mergeHomeEntities(notifications.entities, activity.entities, signal)
      .filter((row) => new Date(row.sortTs ?? 0).getTime() > cutoff)
      .map((row) => row.id);
  };

  it('buffers older rows and advances only the shallower feed', () => {
    const notifications = page([entity('n9', 9), entity('n1', 1)]);
    const activity = page([entity('a10', 10), entity('a8', 8)]);
    expect(visible(notifications, activity)).toEqual(['a10', 'n9']);
    expect(getHomePagination(notifications, activity)).toMatchObject({
      loadNotifications: false,
      loadActivity: true,
    });

    activity.entities.push(entity('a7', 7), entity('a6', 6));
    expect(visible(notifications, activity)).toEqual(['a10', 'n9', 'a8', 'a7']);
    activity.hasMore = false;
    expect(visible(notifications, activity)).toEqual([
      'a10',
      'n9',
      'a8',
      'a7',
      'a6',
    ]);
    expect(getHomePagination(notifications, activity)).toMatchObject({
      loadNotifications: true,
      loadActivity: false,
    });
    notifications.hasMore = false;
    expect(visible(notifications, activity)).toEqual([
      'a10',
      'n9',
      'a8',
      'a7',
      'a6',
      'n1',
    ]);
  });

  it('holds boundary ties until all rows at that timestamp are loaded', () => {
    const notifications = page([entity('z', 9)]);
    const activity = page([entity('b', 9)]);
    expect(visible(notifications, activity)).toEqual([]);
    expect(getHomePagination(notifications, activity)).toMatchObject({
      loadNotifications: true,
      loadActivity: true,
    });
    notifications.entities.push(entity('a', 9), entity('n8', 8));
    activity.entities.push(entity('a8', 8));
    expect(visible(notifications, activity)).toEqual(['a', 'b', 'z']);
  });

  it('waits for both initial pages before exposing rows', () => {
    const notifications = page([entity('old', 1)], false);
    const activity = page([], false, true);
    expect(visible(notifications, activity)).toEqual([]);
    activity.isLoading = false;
    activity.entities = [entity('new', 10)];
    expect(visible(notifications, activity)).toEqual(['new', 'old']);
  });

  it('advances empty pages and ignores unstamped optimistic inserts', () => {
    const notifications = page([entity('n9', 9)]);
    const activity = page([
      { ...entity('unstamped', 1), touchedAt: undefined },
    ]);
    expect(visible(notifications, activity)).toEqual([]);
    expect(getHomePagination(notifications, activity)).toMatchObject({
      cutoff: Infinity,
      loadActivity: true,
    });
    activity.entities = [];
    expect(getHomePagination(notifications, activity).loadActivity).toBe(true);
  });

  it('releases the available source when the other source is exhausted or failed', () => {
    expect(visible(page([], false), page([entity('a9', 9)], false))).toEqual([
      'a9',
    ]);
  });

  it('uses content ordering when notification sorting is disabled', () => {
    const notifications = page([
      { ...entity('n', 9), updatedAt: new Date(2026, 8, 1) },
    ]);
    const activity = page([entity('a', 8)]);
    expect(
      getHomePagination(
        {
          ...notifications,
          oldestFetchedTimestamp: soupPageTimestamp(
            notifications.entities,
            'updated_at'
          ),
        },
        activity
      )
    ).toMatchObject({ loadActivity: true, loadNotifications: false });
  });
});
