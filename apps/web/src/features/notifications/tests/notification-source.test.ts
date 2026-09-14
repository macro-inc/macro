import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { createEffect, createMemo, createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNotificationSource,
  setDoneOverride,
} from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  graphqlCacheEnabled: true,
  graphqlEnabled: false,
  graphqlPatchCallback: undefined as
    | ((patch: Record<string, unknown>) => void)
    | undefined,
  mutedEntitiesQuery: {} as Record<string, unknown>,
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
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => mocks.graphqlEnabled,
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
  createMutedEntitiesQuery: () => mocks.mutedEntitiesQuery,
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
    state: 'unseen',
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
    mocks.mutedEntitiesQuery = {
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    };
  });

  it('keeps done through a late seen action, and reopens as seen across stale snapshots', async () => {
    const row = notification('lifecycle-stale', 'document', 'doc');
    mocks.notificationsQuery = {
      data: [row],
      transport: 'graphql',
      isFetching: false,
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource({} as ConnectionGatewayWebsocket),
      dispose,
    }));
    try {
      await source.markAsDone(row);
      await source.markAsRead(row);
      expect(source.notifications()[0].state).toBe('done');
      setDoneOverride([row.id], false);
      expect(source.notifications()[0].state).toBe('seen');
      expect(row.state).toBe('unseen'); // The in-flight server snapshot is still stale.
    } finally {
      setDoneOverride([row.id], undefined);
      dispose();
    }
  });

  it('rolls a failed done action back to unseen rather than reopening as seen', async () => {
    const row = notification('lifecycle-rollback', 'document', 'doc');
    mocks.notificationsQuery = {
      data: [row],
      transport: 'graphql',
      isFetching: false,
    };
    mocks.doneMutation.mutateAsync.mockRejectedValueOnce(new Error('failed'));
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource({} as ConnectionGatewayWebsocket),
      dispose,
    }));
    try {
      await expect(source.markAsDone(row)).rejects.toThrow('failed');
      expect(source.notifications()[0].state).toBe('unseen');
      expect(source.notifications()[0].viewed_at).toBeNull();
    } finally {
      dispose();
    }
  });

  it('does not let an older failed seen action roll back a newer acknowledgment', async () => {
    const row = notification('lifecycle-overlap', 'document', 'doc');
    mocks.notificationsQuery = {
      data: [row],
      transport: 'graphql',
      isFetching: false,
    };
    let rejectFirst!: (error: Error) => void;
    mocks.seenMutation.mutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectFirst = reject;
        })
    );
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource({} as ConnectionGatewayWebsocket),
      dispose,
    }));
    try {
      const first = source.markAsRead(row).catch(() => {});
      await source.markAsRead(row);
      rejectFirst(new Error('older request failed'));
      await first;
      expect(source.notifications()[0].state).toBe('seen');
    } finally {
      dispose();
    }
  });

  it.each(['seen', 'done'] as const)(
    'does not subscribe an effect to %s rollback snapshots',
    async (operation) => {
      const row = notification(`untracked-${operation}`, 'document', 'doc');
      mocks.notificationsQuery = {
        data: [row],
        transport: 'graphql',
        isFetching: false,
      };
      let runs = 0;
      const { source, dispose } = createRoot((dispose) => {
        const source = createNotificationSource(
          {} as ConnectionGatewayWebsocket
        );
        createEffect(() => {
          runs += 1;
          // Bound a regression so an accidental subscription cannot loop the test.
          if (runs > 1) return;
          void (operation === 'seen'
            ? source.bulkMarkAsRead([row])
            : source.bulkMarkAsDone([row]));
        });
        return { source, dispose };
      });
      try {
        await Promise.resolve();
        await (operation === 'seen'
          ? source.bulkMarkAsRead([row])
          : source.bulkMarkAsDone([row]));
        await Promise.resolve();
        expect(runs).toBe(1);
      } finally {
        setDoneOverride([row.id], undefined);
        dispose();
      }
    }
  );

  it('reactively exposes muted entity cache updates', async () => {
    const [mutedEntities, setMutedEntities] = createSignal<
      UserUnsubscribe[] | undefined
    >([]);
    mocks.mutedEntitiesQuery = {
      get data() {
        return mutedEntities();
      },
      isLoading: false,
      refetch: vi.fn(),
    };

    let dispose = () => {};
    let memoRuns = 0;
    const mutedEntitiesValue = createRoot((rootDispose) => {
      dispose = rootDispose;
      const source = createNotificationSource({} as ConnectionGatewayWebsocket);
      return createMemo(() => {
        memoRuns += 1;
        return source.mutedEntities();
      });
    });

    try {
      await Promise.resolve();
      const initialMutedEntities = mutedEntitiesValue();
      expect(initialMutedEntities).toHaveLength(0);
      const runsBeforeUpdate = memoRuns;

      setMutedEntities([{ item_id: 'channel-1', item_type: 'channel' }]);
      await Promise.resolve();

      expect(mutedEntitiesValue()).toHaveLength(1);
      expect(mutedEntitiesValue()).not.toBe(initialMutedEntities);
      expect(memoRuns).toBeGreaterThan(runsBeforeUpdate);
    } finally {
      dispose();
    }
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

  it('rejects invalid lifecycle state even when metadata fallback is enabled', () => {
    mocks.notificationsQuery = { data: [], transport: 'rest' };
    const receive = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispose = createRoot((dispose) => {
      createNotificationSource({} as ConnectionGatewayWebsocket, receive);
      return dispose;
    });
    try {
      mocks.socketCallback?.({
        type: 'notification',
        data: JSON.stringify({
          notification_id: 'invalid',
          done: true,
          viewed_at: null,
        }),
      });
      expect(receive).not.toHaveBeenCalled();
      expect(mocks.optimisticInsertNotification).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
    } finally {
      dispose();
      error.mockRestore();
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
          .filter(
            (item) => item.entity_type === 'channel' && item.state === 'unseen'
          );
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
