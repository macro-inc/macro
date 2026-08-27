import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { createMemo, createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotificationSource } from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  graphqlCacheEnabled: true,
  graphqlEnabled: false,
  graphqlPatchCallback: undefined as
    | ((patch: Record<string, unknown>) => void)
    | undefined,
  notificationsQuery: {} as Record<string, unknown>,
  optimisticInsertNotification: vi.fn(),
  socketCallback: undefined as
    | ((data: { type: string; data: string }) => void)
    | undefined,
  seenMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
  doneMutation: {
    isPending: false,
    mutateAsync: vi.fn(),
  },
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_DOCUMENT_MENTION_NOTIFICATIONS: true,
  ENABLE_GRAPHQL_SOUP: () => mocks.graphqlEnabled,
}));

vi.mock('@macro-inc/collaboration/websocket', () => ({
  createSocketEffect: vi.fn(
    (
      _ws: unknown,
      callback: (data: { type: string; data: string }) => void
    ) => {
      mocks.socketCallback = callback;
    }
  ),
}));

vi.mock('@queries/notification/user-notifications', () => ({
  optimisticInsertNotification: mocks.optimisticInsertNotification,
  useMarkNotificationsAsDoneMutation: () => mocks.doneMutation,
  useMarkNotificationsAsSeenMutation: () => mocks.seenMutation,
  useUserNotificationsQuery: () => mocks.notificationsQuery,
}));

vi.mock('@queries/notification/unsubscribes', () => ({
  useMuteItemMutation: () => ({ mutateAsync: vi.fn() }),
  useUnmuteItemMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  graphqlCacheEnabled: () => mocks.graphqlCacheEnabled,
  mapGraphqlNotification: (notification: UnifiedNotification) => notification,
}));

vi.mock('@service-storage/graphql-soup-websocket', () => ({
  subscribeToGraphqlNotificationPatches: vi.fn(
    (callback: (patch: Record<string, unknown>) => void) => {
      mocks.graphqlPatchCallback = callback;
      return () => {
        mocks.graphqlPatchCallback = undefined;
      };
    }
  ),
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
    mocks.graphqlCacheEnabled = true;
    mocks.graphqlEnabled = false;
    mocks.graphqlPatchCallback = undefined;
    mocks.socketCallback = undefined;
    mocks.optimisticInsertNotification.mockReset();
    mocks.seenMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mocks.doneMutation.mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('coalesces uncached GraphQL patches and ignores connection gateway notifications when enabled', async () => {
    const incoming = notification('new-notification', 'channel', 'channel-1');
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.graphqlCacheEnabled = false;
    mocks.graphqlEnabled = true;
    mocks.notificationsQuery = {
      data: [],
      fetchNextPage: vi.fn(),
      refetch,
      hasNextPage: false,
      isFetching: false,
      isLoading: false,
      transport: 'graphql',
    };
    const onNotification = vi.fn();
    const subscriber = vi.fn();

    let dispose = () => {};
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const source = createNotificationSource(
        {} as ConnectionGatewayWebsocket,
        onNotification
      );
      source.subscribe(subscriber);
    });

    try {
      mocks.socketCallback?.({
        type: 'notification',
        data: JSON.stringify({
          ...incoming,
          notification_id: incoming.id,
          notification_metadata: incoming.notification_metadata,
        }),
      });
      expect(onNotification).not.toHaveBeenCalled();
      expect(subscriber).not.toHaveBeenCalled();

      mocks.graphqlPatchCallback?.({
        __typename: 'GraphqlUpdatedNotification',
        notification: incoming,
      });
      expect(onNotification).not.toHaveBeenCalled();
      expect(refetch).not.toHaveBeenCalled();

      mocks.graphqlPatchCallback?.({
        __typename: 'GraphqlNewNotification',
        notification: incoming,
      });
      expect(onNotification).toHaveBeenCalledOnce();
      expect(onNotification).toHaveBeenCalledWith(incoming);
      expect(subscriber).toHaveBeenCalledOnce();
      expect(subscriber).toHaveBeenCalledWith(incoming);
      expect(refetch).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(refetch).toHaveBeenCalledOnce();
      expect(mocks.optimisticInsertNotification).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('revalidates the notification query for new patches when the GraphQL cache is enabled', async () => {
    const incoming = notification('new-notification', 'channel', 'channel-1');
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.graphqlCacheEnabled = true;
    mocks.graphqlEnabled = true;
    mocks.notificationsQuery = {
      data: [],
      fetchNextPage: vi.fn(),
      refetch,
      hasNextPage: false,
      isFetching: false,
      isLoading: false,
      transport: 'graphql',
    };

    let dispose = () => {};
    createRoot((rootDispose) => {
      dispose = rootDispose;
      createNotificationSource({} as ConnectionGatewayWebsocket);
    });

    try {
      mocks.graphqlPatchCallback?.({
        __typename: 'GraphqlNewNotification',
        notification: incoming,
      });
      expect(refetch).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(refetch).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('keeps connection gateway notifications authoritative when GraphQL is disabled', () => {
    const incoming: UnifiedNotification = {
      ...notification(
        '00000000-0000-4000-8000-000000000001',
        'reminder',
        'reminder-1'
      ),
      notification_event_type: 'reminder',
      notification_metadata: {
        tag: 'reminder',
        content: {
          description: 'Review the notification source',
          reminderId: '00000000-0000-4000-8000-000000000002',
        },
      },
    };
    mocks.notificationsQuery = {
      data: [],
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetching: false,
      isLoading: false,
      transport: 'rest',
    };
    const onNotification = vi.fn();

    let dispose = () => {};
    createRoot((rootDispose) => {
      dispose = rootDispose;
      createNotificationSource(
        {} as ConnectionGatewayWebsocket,
        onNotification
      );
    });

    try {
      mocks.socketCallback?.({
        type: 'notification',
        data: JSON.stringify({
          ...incoming,
          notification_id: incoming.id,
          notification_metadata: incoming.notification_metadata,
        }),
      });
      expect(onNotification).toHaveBeenCalledOnce();
      expect(mocks.optimisticInsertNotification).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
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
