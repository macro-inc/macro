import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { createMemo, createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  notificationsQuery: {} as Record<string, unknown>,
  seenMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  doneMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
}));

vi.mock('@macro-inc/collaboration/websocket', () => ({
  createSocketEffect: vi.fn(),
}));

vi.mock('@queries/notification/user-notifications', () => ({
  optimisticInsertNotification: vi.fn(),
  useMarkNotificationsAsDoneMutation: () => mocks.doneMutation,
  useMarkNotificationsAsSeenMutation: () => mocks.seenMutation,
  useUserNotificationsQuery: () => mocks.notificationsQuery,
}));

vi.mock('@service-notification/client', () => ({
  notificationServiceClient: {
    removeUnsubscribeItem: vi.fn(),
    unsubscribeItem: vi.fn(),
  },
}));

vi.mock('../queries/muted-entities-query', () => ({
  createMutedEntitiesQuery: () => ({
    data: undefined,
    isLoading: false,
    isSuccess: false,
    refetch: vi.fn(),
  }),
}));

function notification(
  id: string,
  entityType: UnifiedNotification['entity_type'],
  entityId: string
): UnifiedNotification {
  return {
    id,
    entity_id: entityId,
    entity_type: entityType,
    created_at: '2026-08-17T00:00:00.000Z',
    done: false,
    notification_event_type: 'test',
    notification_metadata: {} as UnifiedNotification['notification_metadata'],
    sent: true,
    updated_at: '2026-08-17T00:00:00.000Z',
    viewed_at: null,
  };
}

describe('createNotificationSource', () => {
  beforeEach(() => {
    mocks.seenMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mocks.doneMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('updates only consumers that read the marked notification seen state', async () => {
    const email = notification(
      'email-notification',
      'email_thread',
      'thread-1'
    );
    const channel = notification(
      'channel-notification',
      'channel',
      'channel-1'
    );
    mocks.notificationsQuery = {
      data: [email, channel],
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetching: false,
      isLoading: false,
      transport: 'graphql',
    };

    let dispose = () => {};
    const result = createRoot((rootDispose) => {
      dispose = rootDispose;
      const source = createNotificationSource({} as ConnectionGatewayWebsocket);
      let channelMemoRuns = 0;
      let emailMemoRuns = 0;
      const unreadChannels = createMemo(() => {
        channelMemoRuns += 1;
        return source
          .notifications()
          .filter((item) => item.entity_type === 'channel' && !item.viewed_at);
      });
      const emailViewedAt = createMemo(() => {
        emailMemoRuns += 1;
        return source.notifications().find((item) => item.id === email.id)
          ?.viewed_at;
      });

      return {
        channelMemoRuns: () => channelMemoRuns,
        emailMemoRuns: () => emailMemoRuns,
        emailViewedAt,
        source,
        unreadChannels,
      };
    });

    try {
      const notificationsBefore = result.source.notifications();
      const groupedBefore = result.source.notificationsByEntity();
      expect(result.unreadChannels()).toEqual([
        expect.objectContaining({ id: channel.id }),
      ]);
      expect(result.emailViewedAt()).toBeNull();
      expect(result.channelMemoRuns()).toBe(1);
      expect(result.emailMemoRuns()).toBe(1);

      const markPromise = result.source.bulkMarkAsRead([
        notificationsBefore[0],
      ]);

      expect(result.source.notifications()).toBe(notificationsBefore);
      expect(result.source.notificationsByEntity()).toBe(groupedBefore);
      expect(result.unreadChannels()).toHaveLength(1);
      expect(result.channelMemoRuns()).toBe(1);
      expect(result.emailViewedAt()).toEqual(expect.any(String));
      expect(result.emailMemoRuns()).toBe(2);

      await markPromise;
      expect(mocks.seenMutation.mutateAsync).toHaveBeenCalledWith({
        notificationIds: [email.id],
      });
    } finally {
      dispose();
    }
  });
});
