import { getEntityNotifications } from '@app/features/soup/entity-notifications';
import type { EntityData } from '@entity/types/entity';
import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { createEffect, createMemo, createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markNotificationForEntityIdAsRead,
  markNotificationsForEntityAsDone,
  markNotificationsForEntityAsRead,
  markNotificationsForEntityAsReadInBackground,
} from '../notification-helpers';
import {
  createNotificationSource,
  setDoneOverride,
} from '../notification-source';
import type { UnifiedNotification } from '../types';

const mocks = vi.hoisted(() => ({
  graphqlCacheEnabled: true,
  graphqlEnabled: false,
  documentMentionsEnabled: true,
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
  get ENABLE_DOCUMENT_MENTION_NOTIFICATIONS() {
    return mocks.documentMentionsEnabled;
  },
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
  useUserNotificationsQuery: () => {
    if (!('isStarted' in mocks.notificationsQuery)) {
      mocks.notificationsQuery.isStarted = true;
    }
    return mocks.notificationsQuery;
  },
}));

vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@queries/notification/entity-mutations', () => ({
  toNotificationEntityRef: vi.fn(),
  updateNotificationsForEntities: vi.fn(),
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
    mocks.documentMentionsEnabled = true;
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

  it.each([true, false])(
    'keeps an unused GraphQL feed asleep (document mentions enabled=%s)',
    async (enabled) => {
      mocks.documentMentionsEnabled = enabled;
      const incoming = notification(
        `lazy-notification-${enabled}`,
        'channel',
        'channel'
      );
      const dataRead = vi.fn(() => [incoming]);
      const refetch = vi.fn(async () => {});
      let started = false;
      mocks.notificationsQuery = {
        transport: 'graphql',
        get isStarted() {
          return started;
        },
        get isLoading() {
          started = true;
          return false;
        },
        get data() {
          return dataRead();
        },
        refetch,
      };
      const receive = vi.fn();
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource(
          {} as ConnectionGatewayWebsocket,
          receive
        ),
        dispose,
      }));
      try {
        expect(source.withLocalOverrides).toBeTypeOf('function');
        expect(source.mutedEntities()).toEqual([]);
        mocks.graphqlPatchCallback?.({
          __typename: 'GraphqlNewNotification',
          notification: incoming,
        });
        await Promise.resolve();
        expect(receive).toHaveBeenCalledWith(incoming);
        expect(started).toBe(false);
        expect(dataRead).not.toHaveBeenCalled();
        expect(refetch).not.toHaveBeenCalled();

        await source.markAsRead(incoming);
        expect(
          source.withLocalState?.({ id: incoming.id, state: 'unseen' })
        ).toBe('seen');
        expect(started).toBe(false);
        expect(source.notifications()[0].state).toBe('seen');
        expect(source.notificationsByEntity()['channel@channel']).toHaveLength(
          1
        );
        expect(started).toBe(true);
        expect(dataRead).toHaveBeenCalledOnce();
        mocks.graphqlPatchCallback?.({
          __typename: 'GraphqlUpdatedNotification',
          notification: incoming,
        });
        await Promise.resolve();
        expect(refetch).toHaveBeenCalledOnce();
      } finally {
        dispose();
      }
    }
  );

  it.each(['rest', 'graphql'] as const)(
    'cleans up disabled document mentions only once the %s feed is active',
    async (transport) => {
      mocks.documentMentionsEnabled = false;
      const [started, setStarted] = createSignal(transport === 'rest');
      const mention = {
        ...notification(`disabled-mention-${transport}`, 'document', 'doc'),
        notification_event_type: 'document_mention',
      };
      const [rows, setRows] = createSignal([
        mention,
        { ...mention, id: 'already-done', state: 'done' as const },
        notification('ordinary', 'document', 'doc'),
      ]);
      const readData = vi.fn(() => rows());
      mocks.notificationsQuery = {
        transport,
        get isStarted() {
          return started();
        },
        isLoading: false,
        get data() {
          return readData();
        },
        isFetching: false,
      };
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource({} as ConnectionGatewayWebsocket),
        dispose,
      }));
      try {
        if (transport === 'graphql') {
          expect(readData).not.toHaveBeenCalled();
          expect(mocks.doneMutation.mutateAsync).not.toHaveBeenCalled();
          setStarted(true);
        }
        expect(mocks.doneMutation.mutateAsync).toHaveBeenCalledExactlyOnceWith({
          notificationIds: [mention.id],
        });
        expect(source.notifications()).toHaveLength(3);
        setRows([{ ...mention, id: `later-${transport}` }]);
        expect(mocks.doneMutation.mutateAsync).toHaveBeenLastCalledWith({
          notificationIds: [`later-${transport}`],
        });
        await Promise.resolve();
      } finally {
        dispose();
      }
    }
  );

  it('handles document-mention cleanup failures without an unhandled rejection', async () => {
    mocks.documentMentionsEnabled = false;
    const failure = new Error('offline');
    mocks.doneMutation.mutateAsync.mockRejectedValueOnce(failure);
    mocks.notificationsQuery = {
      transport: 'graphql',
      isStarted: true,
      isLoading: false,
      data: [
        {
          ...notification('cleanup-error', 'document', 'doc'),
          notification_event_type: 'document_mention',
        },
      ],
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispose = createRoot((dispose) => {
      createNotificationSource({} as ConnectionGatewayWebsocket);
      return dispose;
    });
    try {
      await Promise.resolve();
      expect(error).toHaveBeenCalledWith(
        'Failed to discard document mention notifications',
        failure
      );
    } finally {
      dispose();
      error.mockRestore();
    }
  });

  it('catches background read failures while leaving the awaited helper rejecting', async () => {
    const failure = new Error('offline');
    const row = notification('background-failure', 'document', 'doc');
    mocks.seenMutation.mutateAsync.mockRejectedValue(failure);
    mocks.notificationsQuery = {
      transport: 'rest',
      data: [row],
      isLoading: false,
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource({} as ConnectionGatewayWebsocket),
      dispose,
    }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        markNotificationsForEntityAsRead(source, {
          type: 'document',
          id: 'doc',
        })
      ).rejects.toBe(failure);
      await expect(
        markNotificationsForEntityAsReadInBackground(source, {
          type: 'document',
          id: 'doc',
        })
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledExactlyOnceWith(
        'Failed to mark entity notifications as read',
        failure
      );
      expect(source.notifications()[0].state).toBe('unseen');
    } finally {
      dispose();
      error.mockRestore();
    }
  });

  it.each(['read', 'done'] as const)(
    'loads a cold full feed before a bulk %s action',
    async (operation) => {
      const row = notification(`lazy-action-${operation}`, 'document', 'doc');
      let release!: () => void;
      let loaded = false;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.notificationsQuery = {
        transport: 'graphql',
        isStarted: false,
        get isLoading() {
          return !loaded;
        },
        get data() {
          return loaded ? [row] : undefined;
        },
        refetch: vi.fn(async () => {
          await pending;
          loaded = true;
        }),
      };
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource({} as ConnectionGatewayWebsocket),
        dispose,
      }));
      try {
        const action =
          operation === 'read'
            ? markNotificationForEntityIdAsRead(source, 'doc')
            : markNotificationsForEntityAsDone(source, {
                type: 'document',
                id: 'doc',
              });
        expect(mocks.notificationsQuery.refetch).toHaveBeenCalledOnce();
        expect(mocks.seenMutation.mutateAsync).not.toHaveBeenCalled();
        expect(mocks.doneMutation.mutateAsync).not.toHaveBeenCalled();
        release();
        await action;
        expect(
          (operation === 'read' ? mocks.seenMutation : mocks.doneMutation)
            .mutateAsync
        ).toHaveBeenCalledWith({ notificationIds: [row.id] });
      } finally {
        setDoneOverride([row.id], undefined);
        dispose();
      }
    }
  );

  it('does not silently perform an empty bulk action when cold loading fails', async () => {
    mocks.notificationsQuery = {
      transport: 'graphql',
      isStarted: false,
      isLoading: false,
      refetch: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource({} as ConnectionGatewayWebsocket),
      dispose,
    }));
    try {
      await expect(
        markNotificationForEntityIdAsRead(source, 'doc')
      ).rejects.toThrow('offline');
      expect(mocks.seenMutation.mutateAsync).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it.each(['array', 'accessor'] as const)(
    'applies done and undo to GraphQL-attached notifications (%s) before server snapshots change',
    (attachment) => {
      mocks.graphqlEnabled = true;
      mocks.graphqlCacheEnabled = true;
      const row = notification(
        `soup-attached-${attachment}`,
        'document',
        'task'
      );
      mocks.notificationsQuery = {
        data: [row],
        transport: 'graphql',
        isFetching: false,
      };
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource({} as ConnectionGatewayWebsocket),
        dispose,
      }));
      const entity = {
        id: 'task',
        type: 'document',
        name: 'Task',
        notifications: attachment === 'array' ? [row] : () => [row],
      } as EntityData & {
        notifications: UnifiedNotification[] | (() => UnifiedNotification[]);
      };
      const displayedState = () =>
        getEntityNotifications(entity, source)[0].state;
      try {
        expect(displayedState()).toBe('unseen');
        setDoneOverride([row.id], true);
        expect(source.notifications()[0].state).toBe('done'); // control: the override is installed
        expect(
          displayedState(),
          'GraphQL Soup must honor the same in-flight done override'
        ).toBe('done');
        setDoneOverride([row.id], false);
        expect(source.notifications()[0].state).toBe('seen');
        expect(
          displayedState(),
          'Undo must reopen the row without waiting for server data'
        ).toBe('seen');
        expect(row.state).toBe('unseen'); // never mutate the server snapshot
      } finally {
        setDoneOverride([row.id], undefined);
        dispose();
      }
    }
  );

  it('undo reopens a GraphQL-attached notification whose cached server state is already done', () => {
    mocks.graphqlEnabled = true;
    mocks.graphqlCacheEnabled = true;
    const row = {
      ...notification('soup-undo-committed', 'document', 'task'),
      state: 'done' as const,
    };
    mocks.notificationsQuery = {
      data: [row],
      transport: 'graphql',
      isFetching: false,
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource({} as ConnectionGatewayWebsocket),
      dispose,
    }));
    const entity = {
      id: 'task',
      type: 'document',
      name: 'Task',
      notifications: [row],
    } as EntityData & { notifications: UnifiedNotification[] };
    try {
      expect(getEntityNotifications(entity, source)[0].state).toBe('done');
      setDoneOverride([row.id], false);
      expect(source.notifications()[0].state).toBe('seen');
      expect(getEntityNotifications(entity, source)[0].state).toBe('seen');
      expect(row.state).toBe('done');
    } finally {
      setDoneOverride([row.id], undefined);
      dispose();
    }
  });

  it.each([true, false])(
    'only overlays attached Soup edges when GraphQL is enabled (%s)',
    (graphql) => {
      mocks.graphqlEnabled = graphql;
      const row = notification('edge-outside-feed', 'document', 'task');
      const attached = [row];
      mocks.notificationsQuery = {
        data: [],
        transport: graphql ? 'graphql' : 'rest',
        isFetching: false,
      };
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource({} as ConnectionGatewayWebsocket),
        dispose,
      }));
      const entity = {
        id: 'task',
        type: 'document',
        name: 'Task',
        notifications: attached,
      } as EntityData & { notifications: UnifiedNotification[] };
      try {
        setDoneOverride([row.id], true);
        expect(getEntityNotifications(entity, source)[0].state).toBe(
          graphql ? 'done' : 'unseen'
        );
        if (!graphql)
          expect(getEntityNotifications(entity, source)).toBe(attached);
        expect(row.state).toBe('unseen');
      } finally {
        setDoneOverride([row.id], undefined);
        dispose();
      }
    }
  );

  it.each(['seen', 'done'] as const)(
    'retains %s intent on a stale Soup edge when its feed row disappears or confirms the write',
    async (state) => {
      mocks.graphqlEnabled = true;
      const row = notification(`edge-leaves-feed-${state}`, 'document', 'task');
      const [raw, setRaw] = createSignal<UnifiedNotification[]>([row]);
      const [pending, setPending] = createSignal(true);
      let finish!: () => void;
      const mutation =
        state === 'seen' ? mocks.seenMutation : mocks.doneMutation;
      mutation.mutateAsync.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
      mocks.notificationsQuery = {
        get data() {
          return raw();
        },
        get isFetching() {
          return pending();
        },
        transport: 'graphql',
      };
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource({} as ConnectionGatewayWebsocket),
        dispose,
      }));
      const edge = () => source.withLocalOverrides!(row);
      const result =
        state === 'seen' ? source.markAsRead(row) : source.markAsDone(row);
      try {
        expect(edge().state).toBe(state);
        setRaw([]);
        await Promise.resolve();
        expect(edge().state).toBe(state);
        finish();
        await result;
        setPending(false);
        setRaw([{ ...row, state }]);
        await Promise.resolve();
        // A quiet, acknowledged feed is not proof that every Soup edge caught up.
        expect(edge().state).toBe(state);
        setRaw([]);
        await Promise.resolve();
        expect(edge().state).toBe(state);
        expect(row.state).toBe('unseen');
      } finally {
        finish();
        await result;
        setDoneOverride([row.id], undefined);
        dispose();
      }
    }
  );

  it.each(['seen', 'done'] as const)(
    'rolls back a failed %s action after its notification leaves the feed',
    async (state) => {
      mocks.graphqlEnabled = true;
      const row = notification(
        `edge-leaves-feed-rollback-${state}`,
        'document',
        'task'
      );
      const [raw, setRaw] = createSignal<UnifiedNotification[]>([row]);
      let fail!: (error: Error) => void;
      const mutation =
        state === 'seen' ? mocks.seenMutation : mocks.doneMutation;
      mutation.mutateAsync.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          })
      );
      mocks.notificationsQuery = {
        get data() {
          return raw();
        },
        isFetching: false,
        transport: 'graphql',
      };
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource({} as ConnectionGatewayWebsocket),
        dispose,
      }));
      const result =
        state === 'seen' ? source.markAsRead(row) : source.markAsDone(row);
      const rejected = expect(result).rejects.toThrow('failed');
      try {
        setRaw([]);
        await Promise.resolve();
        expect(source.withLocalOverrides!(row).state).toBe(state);
        fail(new Error('failed'));
        await rejected;
        expect(source.withLocalOverrides!(row).state).toBe('unseen');
      } finally {
        fail(new Error('failed'));
        await rejected;
        dispose();
      }
    }
  );

  it.each(['seen', 'done'] as const)(
    'still prunes absent %s overrides for REST-only readers',
    async (state) => {
      const row = notification(`rest-leaves-feed-${state}`, 'document', 'task');
      const [raw, setRaw] = createSignal<UnifiedNotification[]>([row]);
      mocks.notificationsQuery = {
        get data() {
          return raw();
        },
        isFetching: false,
        transport: 'rest',
      };
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource({} as ConnectionGatewayWebsocket),
        dispose,
      }));
      try {
        await (state === 'seen'
          ? source.markAsRead(row)
          : source.markAsDone(row));
        expect(source.notifications()[0].state).toBe(state);
        setRaw([]);
        await Promise.resolve();
        setRaw([row]);
        expect(source.notifications()[0].state).toBe('unseen');
      } finally {
        setDoneOverride([row.id], undefined);
        dispose();
      }
    }
  );

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

  it('follows the query transport for pagination, realtime delivery and edge overrides', async () => {
    // An imperative flag snapshot can disagree with the mounted query during
    // startup. Only the facade's reactive transport owns source behavior.
    mocks.graphqlEnabled = true;
    const [transport, setTransport] = createSignal<'rest' | 'graphql'>('rest');
    const fetchNextPage = vi.fn(async () => undefined);
    const refetch = vi.fn(async () => undefined);
    mocks.notificationsQuery = {
      data: [],
      get transport() {
        return transport();
      },
      hasNextPage: true,
      isFetching: false,
      fetchNextPage,
      refetch,
    };
    const incoming: UnifiedNotification = {
      ...notification(
        '00000000-0000-4000-8000-000000000011',
        'reminder',
        'reminder-transport'
      ),
      notification_event_type: 'reminder',
      notification_metadata: {
        tag: 'reminder',
        content: {
          description: 'Transport transition',
          reminderId: '00000000-0000-4000-8000-000000000012',
        },
      },
    };
    const restEvent = {
      type: 'notification',
      data: JSON.stringify({ ...incoming, notification_id: incoming.id }),
    };
    const graphqlEvent = {
      __typename: 'GraphqlNewNotification',
      notification: incoming,
    };
    const receive = vi.fn();
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(
        {} as ConnectionGatewayWebsocket,
        receive
      ),
      dispose,
    }));
    try {
      expect(fetchNextPage).toHaveBeenCalledOnce();
      expect(source.withLocalOverrides).toBeUndefined();
      mocks.graphqlPatchCallback?.(graphqlEvent);
      expect(receive).not.toHaveBeenCalled();
      mocks.socketCallback?.(restEvent);
      expect(receive).toHaveBeenCalledOnce();
      expect(mocks.optimisticInsertNotification).toHaveBeenCalledOnce();

      setTransport('graphql');
      expect(source.withLocalOverrides).toBeTypeOf('function');
      expect(fetchNextPage).toHaveBeenCalledOnce();
      mocks.socketCallback?.(restEvent);
      expect(receive).toHaveBeenCalledOnce();
      mocks.graphqlPatchCallback?.(graphqlEvent);
      expect(receive).toHaveBeenCalledTimes(2);
      await Promise.resolve();
      expect(refetch).toHaveBeenCalledOnce();

      setTransport('rest');
      expect(source.withLocalOverrides).toBeUndefined();
      expect(fetchNextPage).toHaveBeenCalledTimes(2);
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
