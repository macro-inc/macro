import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markChannelsAsRead } from '../notification-helpers';
import type { NotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  graphqlSoup: false,
  entitySeen: vi.fn(async () => []),
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  isFeatureEnabled: () => mocks.graphqlSoup,
}));
vi.mock('@queries/notification/entity-mutations', () => ({
  toNotificationEntityRef: vi.fn(),
  updateNotificationsForEntities: mocks.entitySeen,
}));

const feed = [
  {
    id: 'message',
    entity_type: 'channel',
    entity_id: 'one',
    state: 'unseen',
    notification_metadata: { tag: 'channel_message_send' },
  },
  {
    id: 'access-request',
    entity_type: 'channel',
    entity_id: 'two',
    state: 'unseen',
    notification_metadata: { tag: 'channel_access_requested' },
  },
  {
    id: 'invite',
    entity_type: 'channel',
    entity_id: 'one',
    state: 'unseen',
    notification_metadata: { tag: 'channel_invite' },
  },
  {
    id: 'seen',
    entity_type: 'channel',
    entity_id: 'one',
    state: 'seen',
    notification_metadata: { tag: 'channel_message_send' },
  },
  {
    id: 'other-channel',
    entity_type: 'channel',
    entity_id: 'outside',
    state: 'unseen',
    notification_metadata: { tag: 'channel_message_send' },
  },
  {
    id: 'document',
    entity_type: 'document',
    entity_id: 'one',
    state: 'unseen',
    notification_metadata: { tag: 'document_mention' },
  },
] as UnifiedNotification[];

function createSource() {
  const refetch = vi.fn(async () => {});
  const notifications = vi.fn(() => feed);
  const bulkMarkAsRead = vi.fn(async () => {});
  const source = {
    notifications,
    bulkMarkAsRead,
    _notificationsQuery: { isStarted: false, isLoading: false, refetch },
  } as unknown as NotificationSource;
  return { source, refetch, notifications, bulkMarkAsRead };
}

beforeEach(() => {
  mocks.graphqlSoup = false;
  mocks.entitySeen.mockClear();
});

describe('marking channels as read', () => {
  it('writes by channel in GraphQL mode without loading the notification feed', async () => {
    mocks.graphqlSoup = true;
    const { source, refetch, notifications, bulkMarkAsRead } = createSource();
    await markChannelsAsRead(source, ['one', 'two', 'one']);
    expect(mocks.entitySeen).toHaveBeenCalledExactlyOnceWith({
      entities: [
        { type: 'channel', id: 'one' },
        { type: 'channel', id: 'two' },
      ],
      operation: 'MARK_SEEN',
    });
    expect(refetch).not.toHaveBeenCalled();
    expect(notifications).not.toHaveBeenCalled();
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
  });

  it('loads the REST feed and marks only the unread notifications of those channels', async () => {
    const { source, refetch, bulkMarkAsRead } = createSource();
    await markChannelsAsRead(source, ['one', 'two']);
    expect(refetch).toHaveBeenCalledOnce();
    expect(bulkMarkAsRead).toHaveBeenCalledExactlyOnceWith([feed[0], feed[1]]);
    expect(mocks.entitySeen).not.toHaveBeenCalled();
  });

  it('drops a REST mark that stopped being current while the feed loaded', async () => {
    const { source, refetch, notifications, bulkMarkAsRead } = createSource();
    await markChannelsAsRead(source, ['one'], () => false);
    expect(refetch).toHaveBeenCalledOnce();
    expect(notifications).not.toHaveBeenCalled();
    expect(bulkMarkAsRead).not.toHaveBeenCalled();
  });
});
