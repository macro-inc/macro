import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';
import {
  getEntityNotifications,
  withEntityNotifications,
} from './entity-notifications';

type TestEntity = EntityData & { notifications?: UnifiedNotification[] };

const entity = (id: string, notificationIds: string[] = []): TestEntity =>
  ({
    id,
    type: 'document',
    notifications: notificationIds.map((nid) => ({ id: nid })),
  }) as TestEntity;

const source = {} as NotificationSource;
const ids = (notifications: UnifiedNotification[] | undefined) =>
  notifications?.map(({ id }) => id);

describe('withEntityNotifications', () => {
  it('reuses the accessor for the same entity, source and scope', () => {
    const task = entity('a', ['n1']);
    const first = withEntityNotifications(task, source);
    const second = withEntityNotifications(task, source);

    expect(second).not.toBe(first);
    expect(second.notifications).toBe(first.notifications);
    expect(ids(first.notifications?.())).toEqual(['n1']);
  });

  it('keeps separate accessors per source and per scope', () => {
    const task = entity('a');
    const plain = withEntityNotifications(task, source).notifications;

    expect(
      withEntityNotifications(task, {} as NotificationSource).notifications
    ).not.toBe(plain);
    expect(
      withEntityNotifications(task, source, { scopeChannelThreads: true })
        .notifications
    ).not.toBe(plain);
  });

  it('reads the current notifications of a store entity', () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({ tasks: [entity('a', ['n1'])] });
      const accessor = withEntityNotifications(
        store.tasks[0]!,
        source
      ).notifications;

      setStore('tasks', 0, 'notifications', [
        { id: 'n1' },
        { id: 'n2' },
      ] as UnifiedNotification[]);
      expect(ids(accessor?.())).toEqual(['n1', 'n2']);
      expect(
        withEntityNotifications(store.tasks[0]!, source).notifications
      ).toBe(accessor);
      dispose();
    });
  });
});

type FeedTransport = {
  transport: 'rest' | 'graphql';
  isTransportPending: boolean;
};

/** A global feed that files one notification under each key. */
function feedSource(transport: FeedTransport, keys: string[]) {
  const byEntity = Object.fromEntries(
    keys.map((key) => [key, [{ id: key } as UnifiedNotification]])
  );
  const notificationsByEntity = vi.fn(() => byEntity);
  const notifications = vi.fn(() => Object.values(byEntity).flat());
  const feed = {
    notificationsByEntity,
    notifications,
    _notificationsQuery: transport,
  } as unknown as NotificationSource;
  return { feed, notificationsByEntity, notifications };
}

describe('getEntityNotifications without an attached edge', () => {
  it.each([
    { type: 'call', id: 'call-1' },
    { type: 'crm_company', id: 'company-1' },
    { type: 'crm_contact', id: 'contact-1' },
    { type: 'database', id: 'database-1' },
    { type: 'form', id: 'form-1' },
    { type: 'harness', id: 'harness-1' },
    { type: 'team', id: 'team-1' },
    { type: 'initiative', id: 'initiative-1' },
    { type: 'agent_session', id: 'session-1' },
  ] as EntityData[])(
    'reads nothing for a $type row with GraphQL Soup, without reading the feed',
    (row) => {
      const { feed, notificationsByEntity, notifications } = feedSource(
        { transport: 'graphql', isTransportPending: false },
        [`${row.type}@${row.id}`]
      );

      expect(getEntityNotifications(row, feed)).toEqual([]);
      expect(notificationsByEntity).not.toHaveBeenCalled();
      expect(notifications).not.toHaveBeenCalled();
    }
  );

  it.each([
    { row: { type: 'document', id: 'doc-1' }, key: 'document@doc-1' },
    { row: { type: 'chat', id: 'chat-1' }, key: 'chat@chat-1' },
    { row: { type: 'project', id: 'folder-1' }, key: 'project@folder-1' },
    { row: { type: 'channel', id: 'channel-1' }, key: 'channel@channel-1' },
    {
      row: {
        type: 'channel_thread',
        id: 'thread-1',
        channelId: 'channel-1',
        messageId: 'root',
      },
      key: 'channel@channel-1',
    },
    { row: { type: 'email', id: 'thread-1' }, key: 'email_thread@thread-1' },
    {
      row: { type: 'calendar_event', id: 'event-1' },
      key: 'calendar_event@event-1',
    },
    { row: { type: 'foreign', id: 'pr-1' }, key: 'foreign_entity@pr-1' },
  ] as { row: EntityData; key: string }[])(
    'still reads $key from the GraphQL feed',
    ({ row, key }) => {
      const { feed } = feedSource(
        { transport: 'graphql', isTransportPending: false },
        [key]
      );

      expect(ids(getEntityNotifications(row, feed))).toEqual([key]);
    }
  );

  it('reads every type from the REST feed', () => {
    const { feed } = feedSource(
      { transport: 'rest', isTransportPending: false },
      ['crm_contact@contact-1', 'call@call-1']
    );

    expect(
      ids(
        getEntityNotifications(
          { type: 'crm_contact', id: 'contact-1' } as EntityData,
          feed
        )
      )
    ).toEqual(['crm_contact@contact-1']);
    expect(
      ids(
        getEntityNotifications(
          { type: 'call', id: 'call-1' } as EntityData,
          feed
        )
      )
    ).toEqual(['call@call-1']);
  });

  it('reads nothing for those types until the flags settle, then the REST feed', () => {
    const transport: FeedTransport = {
      transport: 'rest',
      isTransportPending: true,
    };
    const { feed, notificationsByEntity } = feedSource(transport, [
      'crm_contact@contact-1',
      'document@doc-1',
    ]);
    const contact = { type: 'crm_contact', id: 'contact-1' } as EntityData;

    expect(getEntityNotifications(contact, feed)).toEqual([]);
    expect(notificationsByEntity).not.toHaveBeenCalled();
    expect(
      ids(
        getEntityNotifications(
          { type: 'document', id: 'doc-1' } as EntityData,
          feed
        )
      )
    ).toEqual(['document@doc-1']);

    transport.isTransportPending = false;
    expect(ids(getEntityNotifications(contact, feed))).toEqual([
      'crm_contact@contact-1',
    ]);
  });
});
