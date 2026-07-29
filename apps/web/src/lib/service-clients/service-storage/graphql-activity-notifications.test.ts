import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityData } from '../../../features/entity/types/entity';
import type { WithNotification } from '../../../features/entity/types/notification';
import { unreadFilterFn } from '../../../features/entity/utils/filter';
import {
  RecordChannelActivityDocument,
  UpdateNotificationsDocument,
} from './graphql/generated/graphql';
import { recordChannelActivity } from './graphql-channel-activity';
import { updateNotifications } from './graphql-notifications';

const { mutationMock } = vi.hoisted(() => ({ mutationMock: vi.fn() }));

vi.mock('./graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ mutation: mutationMock }),
}));

describe('channel activity and notification GraphQL cache separation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks the linked notification seen while VIEW activity leaves unread state unchanged', async () => {
    const notificationRecord = {
      __typename: 'GraphqlSoupNotification' as const,
      id: 'notification-1',
      eventType: 'channel_message_send',
      entityType: 'CHANNEL' as const,
      entityId: 'channel-1',
      sent: true,
      done: false,
      seen: false,
      createdAt: '2025-01-01T00:00:00Z',
      viewedAt: null as string | null,
      updatedAt: '2025-01-01T00:00:00Z',
      senderId: null,
      metadata: { messageId: 'message-1' },
    };
    const channel = {
      type: 'channel',
      notifications: () => [
        {
          id: notificationRecord.id,
          entity_type: 'channel',
          entity_id: notificationRecord.entityId,
          done: notificationRecord.done,
          viewed_at: notificationRecord.viewedAt,
          notification_event_type: notificationRecord.eventType,
          notification_metadata: {
            tag: notificationRecord.eventType,
            content: notificationRecord.metadata,
          },
        },
      ],
    } as unknown as WithNotification<EntityData>;

    mutationMock.mockImplementation((document) => ({
      toPromise: async () => {
        if (document === RecordChannelActivityDocument) {
          return {
            data: {
              recordChannelActivity: {
                __typename: 'GraphqlChannelActivity',
                id: 'activity-1',
                userId: 'macro|user@example.com',
                channelId: 'channel-1',
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:01Z',
                viewedAt: '2025-01-01T00:00:01Z',
                interactedAt: null,
              },
            },
          };
        }
        if (document === UpdateNotificationsDocument) {
          const updated = {
            ...notificationRecord,
            seen: true,
            viewedAt: '2025-01-01T00:00:02Z',
            updatedAt: '2025-01-01T00:00:02Z',
          };
          // Model the normalized cache's __typename:id merge. The channel's
          // notification edge keeps pointing at this same record.
          Object.assign(notificationRecord, updated);
          return { data: { updateNotifications: [updated] } };
        }
        throw new Error('unexpected GraphQL document');
      },
    }));

    expect(unreadFilterFn(channel)).toBe(true);

    await recordChannelActivity({
      channelId: 'channel-1',
      activityType: 'view',
    });
    expect(unreadFilterFn(channel)).toBe(true);

    const updated = await updateNotifications({
      notificationIds: ['notification-1'],
      operation: 'MARK_SEEN',
    });
    expect(updated[0].__typename).toBe('GraphqlSoupNotification');
    expect(updated[0].id).toBe('notification-1');
    expect(unreadFilterFn(channel)).toBe(false);
  });
});
