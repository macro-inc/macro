import { getEntityNotifications } from '@app/features/soup/entity-notifications';
import type { EntityData } from '@entity/types/entity';
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
import { type UnifiedNotification, unifiedNotificationSchema } from '../types';

const mocks = vi.hoisted(() => ({
  fetchActiveNotificationIds: vi.fn(),
  graphqlCacheEnabled: true,
  documentMentionsEnabled: true,
  graphqlPatchCallback: undefined as
    | ((patch: Record<string, unknown>) => void)
    | undefined,
  mutedEntitiesQuery: {} as Record<string, unknown>,
  notificationsQuery: {} as Record<string, unknown>,
  updateSoupForNotification: vi.fn(),
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
}));

vi.mock(
  '@queries/notification/graphql/active-notification-ids',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchActiveNotificationIds: mocks.fetchActiveNotificationIds,
  })
);

vi.mock('@queries/notification/notification-soup', () => ({
  updateSoupForNotification: mocks.updateSoupForNotification,
}));

vi.mock('@queries/notification/user-notifications', () => ({
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

vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => ({
    userId: 'macro|viewer@example.com',
    session: 1,
  }),
  isCurrentQueryAccount: () => true,
  queryAccountSessionPending: () => false,
}));

vi.mock('@service-storage/graphql-soup', () => ({
  graphqlCacheEnabled: () => mocks.graphqlCacheEnabled,
  mapGraphqlNotification: (notification: UnifiedNotification) => notification,
  subscribeGraphqlSoupReconnected: () => () => {},
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
    mocks.documentMentionsEnabled = true;
    mocks.graphqlPatchCallback = undefined;
    mocks.fetchActiveNotificationIds.mockReset().mockResolvedValue([]);
    mocks.updateSoupForNotification.mockReset();
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
        source: createNotificationSource(receive),
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
        expect(mocks.updateSoupForNotification).toHaveBeenCalledWith(incoming);
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

  it('cleans up disabled document mentions by id, never through the feed, even once it starts', async () => {
    mocks.documentMentionsEnabled = false;
    mocks.fetchActiveNotificationIds.mockResolvedValue(['outside-feed']);
    const [started, setStarted] = createSignal(false);
    const mention = {
      ...notification('in-feed', 'document', 'doc'),
      notification_event_type: 'document_mention',
    };
    const [rows, setRows] = createSignal([mention]);
    const readData = vi.fn(() => rows());
    mocks.notificationsQuery = {
      get isStarted() {
        return started();
      },
      isLoading: false,
      get data() {
        return readData();
      },
      isFetching: false,
    };
    const dispose = createRoot((dispose) => {
      createNotificationSource();
      return dispose;
    });
    try {
      await vi.waitFor(() =>
        expect(mocks.doneMutation.mutateAsync).toHaveBeenCalledExactlyOnceWith({
          notificationIds: ['outside-feed'],
        })
      );
      expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledExactlyOnceWith(
        ['document_mention'],
        500
      );

      // Another reader starting the feed must not turn the cleanup into one.
      setStarted(true);
      setRows([{ ...mention, id: 'later-graphql' }]);
      await Promise.resolve();
      expect(readData).not.toHaveBeenCalled();
      expect(mocks.doneMutation.mutateAsync).toHaveBeenCalledOnce();
      expect(mocks.fetchActiveNotificationIds).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('catches background read failures while leaving the awaited helper rejecting', async () => {
    const failure = new Error('offline');
    const row = notification('background-failure', 'document', 'doc');
    mocks.seenMutation.mutateAsync.mockRejectedValue(failure);
    mocks.notificationsQuery = {
      data: [row],
      isLoading: false,
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
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
        source: createNotificationSource(),
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
      isStarted: false,
      isLoading: false,
      refetch: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
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
      mocks.graphqlCacheEnabled = true;
      const row = notification(
        `soup-attached-${attachment}`,
        'document',
        'task'
      );
      mocks.notificationsQuery = {
        data: [row],
        isFetching: false,
      };
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource(),
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

  it('tells an entity-wide mark seen which notifications it expects to change', async () => {
    const { toNotificationEntityRef, updateNotificationsForEntities } =
      await import('@queries/notification/entity-mutations');
    vi.mocked(toNotificationEntityRef).mockReturnValue({
      type: 'document',
      id: 'doc',
    });
    vi.mocked(updateNotificationsForEntities).mockResolvedValue([]);
    const unseen = notification('expected-unseen', 'document', 'doc');
    const seen = {
      ...notification('already-seen', 'document', 'doc'),
      state: 'seen' as const,
    };
    mocks.notificationsQuery = {
      data: [unseen, seen],
      isFetching: false,
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
      dispose,
    }));
    try {
      await markNotificationsForEntityAsRead(source, {
        type: 'document',
        id: 'doc',
      });
      // A reply without one of these means this tab was stale.
      expect(updateNotificationsForEntities).toHaveBeenCalledWith({
        entities: [{ type: 'document', id: 'doc' }],
        operation: 'MARK_SEEN',
        expectedNotificationIds: ['expected-unseen'],
      });
    } finally {
      dispose();
    }
  });

  it('expects nothing from a feed that has not started, without starting it', async () => {
    const { toNotificationEntityRef, updateNotificationsForEntities } =
      await import('@queries/notification/entity-mutations');
    vi.mocked(toNotificationEntityRef).mockReturnValue({
      type: 'document',
      id: 'doc',
    });
    vi.mocked(updateNotificationsForEntities).mockResolvedValue([]);
    const read = vi.fn(() => [notification('unseen', 'document', 'doc')]);
    mocks.notificationsQuery = {
      isStarted: false,
      get data() {
        return read();
      },
      isFetching: false,
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
      dispose,
    }));
    try {
      await markNotificationsForEntityAsRead(source, {
        type: 'document',
        id: 'doc',
      });
      expect(updateNotificationsForEntities).toHaveBeenCalledWith(
        expect.objectContaining({ expectedNotificationIds: [] })
      );
      expect(read).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('can release a failed reversal to authoritative state without clearing newer intent', () => {
    const row: UnifiedNotification = {
      ...notification('partial-reversal', 'document', 'task'),
      state: 'seen',
    };
    mocks.notificationsQuery = {
      data: [row],
      isFetching: false,
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
      dispose,
    }));
    try {
      setDoneOverride([row.id], true);
      const inverse = setDoneOverride([row.id], false);
      inverse.release();
      expect(source.notifications()[0].state).toBe('seen'); // not the prior done override

      const older = setDoneOverride([row.id], true);
      setDoneOverride([row.id], false);
      row.state = 'done';
      older.release();
      expect(source.notifications()[0].state).toBe('seen'); // newer local Undo still owns the id
    } finally {
      setDoneOverride([row.id], undefined);
      dispose();
    }
  });

  it('undo reopens a GraphQL-attached notification whose cached server state is already done', () => {
    mocks.graphqlCacheEnabled = true;
    const row = {
      ...notification('soup-undo-committed', 'document', 'task'),
      state: 'done' as const,
    };
    mocks.notificationsQuery = {
      data: [row],
      isFetching: false,
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
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

  it('overlays local intent on attached Soup edges outside the feed', () => {
    const row = notification('edge-outside-feed', 'document', 'task');
    mocks.notificationsQuery = {
      data: [],
      isFetching: false,
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
      dispose,
    }));
    const entity = {
      id: 'task',
      type: 'document',
      name: 'Task',
      notifications: [row],
    } as EntityData & { notifications: UnifiedNotification[] };
    try {
      setDoneOverride([row.id], true);
      expect(getEntityNotifications(entity, source)[0].state).toBe('done');
      expect(row.state).toBe('unseen');
    } finally {
      setDoneOverride([row.id], undefined);
      dispose();
    }
  });

  it.each(['seen', 'done'] as const)(
    'retains %s intent on a stale Soup edge when its feed row disappears or confirms the write',
    async (state) => {
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
      };
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource(),
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
      };
      const { source, dispose } = createRoot((dispose) => ({
        source: createNotificationSource(),
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

  it('keeps done through a late seen action, and reopens as seen across stale snapshots', async () => {
    const row = notification('lifecycle-stale', 'document', 'doc');
    mocks.notificationsQuery = {
      data: [row],
      isFetching: false,
    };
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
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
      isFetching: false,
    };
    mocks.doneMutation.mutateAsync.mockRejectedValueOnce(new Error('failed'));
    const { source, dispose } = createRoot((dispose) => ({
      source: createNotificationSource(),
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
      source: createNotificationSource(),
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
        isFetching: false,
      };
      let runs = 0;
      let first: Promise<unknown> | undefined;
      const { source, dispose } = createRoot((dispose) => {
        const source = createNotificationSource();
        createEffect(() => {
          runs += 1;
          // Bound a regression so an accidental subscription cannot loop the test.
          if (runs > 1) return;
          first =
            operation === 'seen'
              ? source.bulkMarkAsRead([row])
              : source.bulkMarkAsDone([row]);
        });
        return { source, dispose };
      });
      try {
        await Promise.resolve();
        await (operation === 'seen'
          ? source.bulkMarkAsRead([row])
          : source.bulkMarkAsDone([row]));
        await first;
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
      const source = createNotificationSource();
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

  it('coalesces uncached GraphQL patches into one refetch', async () => {
    const incoming = notification('new-notification', 'channel', 'channel-1');
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.graphqlCacheEnabled = false;
    mocks.notificationsQuery = {
      data: [],
      fetchNextPage: vi.fn(),
      refetch,
      hasNextPage: false,
      isFetching: false,
      isLoading: false,
    };
    const onNotification = vi.fn();
    const subscriber = vi.fn();

    let dispose = () => {};
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const source = createNotificationSource(onNotification);
      source.subscribe(subscriber);
    });

    try {
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
      expect(mocks.updateSoupForNotification).toHaveBeenCalledExactlyOnceWith(
        incoming
      );
      expect(
        mocks.updateSoupForNotification.mock.invocationCallOrder[0]
      ).toBeLessThan(subscriber.mock.invocationCallOrder[0]);
      expect(refetch).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(refetch).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('revalidates the notification query for new patches when the GraphQL cache is enabled', async () => {
    const incoming = notification('new-notification', 'channel', 'channel-1');
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.graphqlCacheEnabled = true;
    mocks.notificationsQuery = {
      data: [],
      fetchNextPage: vi.fn(),
      refetch,
      hasNextPage: false,
      isFetching: false,
      isLoading: false,
    };

    let dispose = () => {};
    createRoot((rootDispose) => {
      dispose = rootDispose;
      createNotificationSource();
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
    };

    let dispose = () => {};
    const result = createRoot((rootDispose) => {
      dispose = rootDispose;
      const source = createNotificationSource();
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

it('accepts the independent external chat notification through the generated wire schema', () => {
  const row: UnifiedNotification = {
    ...notification(
      '019a061e-0000-7000-8000-000000000003',
      'external_chat',
      '019a061e-0000-7000-8000-000000000001'
    ),
    notification_event_type: 'external_chat_message',
    notification_metadata: {
      tag: 'external_chat_message',
      content: {
        provider: 'whatsapp',
        chatName: 'Design Crit',
        messageId: '019a061e-0000-7000-8000-000000000002',
      },
    },
  };
  expect(unifiedNotificationSchema.safeParse(row).success).toBe(true);
});
