import type { EntityData } from '@entity';
import { notificationIsRead } from '@entity/utils/notification';
import type { NotificationSource, UnifiedNotification } from '@notifications';
import { compositeEntity } from '@notifications/types';
import { boundedCount } from '@queries/soup/bounded-count';
import { describe, expect, it, vi } from 'vitest';
import { INBOX_FACETS } from '../inbox-view/inbox-facets';
import { selectInboxEntities } from '../inbox-view/queries/inbox-eligibility';
import { withEntityNotifications } from './entity-notifications';
import { testFacets } from './filters/facets';
import { hasNotificationCoverage } from './notification-coverage';

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

const context = {
  tab: 'signal' as const,
  capabilities: {
    calendar: false,
    foreignEntities: false,
    notifiedSort: true,
    reminders: false,
    snippets: false,
  },
};

function notification(id: string, threadId?: string): UnifiedNotification {
  return {
    id,
    entity_type: 'channel',
    entity_id: 'channel-1',
    created_at: new Date().toISOString(),
    done: false,
    notification_metadata: threadId
      ? {
          tag: 'channel_message_reply',
          content: { threadId, messageId: id, senderId: 'sender' },
        }
      : {
          tag: 'channel_message_send',
          content: { messageId: id, senderId: 'sender' },
        },
  } as unknown as UnifiedNotification;
}

function source(notifications: UnifiedNotification[], complete = true) {
  return {
    notificationsByEntity: () => ({
      [compositeEntity({ type: 'channel', id: 'channel-1' })]: notifications,
    }),
    isLoading: () => false,
    _notificationsQuery: { error: null, hasNextPage: !complete },
  } as unknown as NotificationSource;
}

function rows(notifications: UnifiedNotification[]): EntityData[] {
  return [
    { id: 'channel-1', type: 'channel', notifications },
    {
      id: 'thread-1',
      messageId: 'thread-1',
      channelId: 'channel-1',
      type: 'channel_thread',
      notifications,
    },
  ] as unknown as EntityData[];
}

function inboxCount(entities: EntityData[], notifications: NotificationSource) {
  const unread = selectInboxEntities(entities, context, notifications).filter(
    (entity) =>
      testFacets({ read: ['unread'] }, INBOX_FACETS, entity, {
        notificationSource: notifications,
      })
  );
  return boundedCount(
    unread.map((entity) => `${entity.type}:${entity.id}`),
    true
  );
}

describe('sidebar count row identities', () => {
  it('uses the same row identities with REST notification data', () => {
    const entities = [
      { id: 'channel-1', type: 'channel' },
      {
        id: 'thread-1',
        messageId: 'thread-1',
        channelId: 'channel-1',
        type: 'channel_thread',
      },
    ] as EntityData[];
    expect(
      inboxCount(
        entities,
        source([notification('send'), notification('reply', 'thread-1')])
      )
    ).toBe(2);
  });

  it('counts channel and thread Inbox rows separately, but the channel once', () => {
    const notifications = [
      notification('send-1'),
      notification('send-2'),
      notification('reply-1', 'thread-1'),
      notification('reply-2', 'thread-1'),
    ];
    const entities = rows(notifications);
    const notificationsSource = source([]);
    expect(inboxCount(entities, notificationsSource)).toBe(2);
    const channel = withEntityNotifications(entities[0], notificationsSource);
    expect(channel.notifications?.().some((n) => !notificationIsRead(n))).toBe(
      true
    );
    expect(boundedCount([channel.id, channel.id], true)).toBe(1);
  });

  it('removes a read top-level row but keeps unread thread activity', () => {
    const send = notification('send');
    send.viewed_at = new Date().toISOString();
    const notifications = [send, notification('reply', 'thread-1')];
    const entities = rows(notifications);
    const notificationsSource = source([]);
    expect(inboxCount(entities, notificationsSource)).toBe(1);
    expect(
      withEntityNotifications(entities[0], notificationsSource)
        .notifications?.()
        .some((n) => !notificationIsRead(n))
    ).toBe(true);
  });

  it('does not count done rows', () => {
    const done = notification('send');
    done.done = true;
    expect(inboxCount(rows([done]), source([]))).toBe(0);
  });
});

describe('count completeness', () => {
  it('does not use the global GraphQL page size as a limit on attached edges', () => {
    expect(hasNotificationCoverage(rows([]), source([], false))).toBe(true);
  });

  it('waits for REST notification coverage before claiming a total', () => {
    const entities = [{ id: 'channel-1', type: 'channel' }] as EntityData[];
    expect(hasNotificationCoverage(entities, source([], false))).toBe(false);
    expect(hasNotificationCoverage(entities, source([]))).toBe(true);
  });

  it('distinguishes unknown, zero, exact, and capped counts', () => {
    expect(boundedCount([], false)).toBeUndefined();
    expect(boundedCount([], true)).toBe(0);
    expect(boundedCount(['a', 'a', 'b'], true)).toBe(2);
    expect(boundedCount(['a', 'b'], false)).toBeUndefined();
    expect(
      boundedCount(
        Array.from({ length: 100 }, (_, i) => `${i}`),
        false
      )
    ).toBe('99+');
  });
});
