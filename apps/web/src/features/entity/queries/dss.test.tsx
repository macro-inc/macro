import type { EntityData } from '@entity';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskEntity } from '../types/entity';

const mocks = vi.hoisted(() => ({
  graphqlEnabled: vi.fn(() => true),
  deleteItem: vi.fn(),
  deleteCall: vi.fn(),
  deleteReminder: vi.fn(),
  deleteSchedule: vi.fn(),
  moveToFolder: vi.fn(),
  copyItem: vi.fn(),
  removeSoup: vi.fn(),
  removeSearch: vi.fn(),
  rollbackSoup: vi.fn(),
  rollbackSearch: vi.fn(),
  refresh: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@core/component/FileList/itemOperations', () => ({
  deleteItem: mocks.deleteItem,
  copyItem: mocks.copyItem,
  moveToFolder: mocks.moveToFolder,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: mocks.graphqlEnabled,
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@queries/agent-session/entity-mutations', () => ({
  deleteAgentSession: vi.fn(),
}));
vi.mock('@queries/soup/cache', () => ({
  removeSoupEntities: mocks.removeSoup,
  removeSearchEntities: mocks.removeSearch,
  getSoupEntityById: vi.fn(),
  optimisticUpdateSoupEntity: vi.fn(() => ({ rollback: vi.fn() })),
  invalidateSoupEntity: vi.fn(),
  invalidateSoupQueriesReferencing: vi.fn(),
  removeSoupEntitiesFromQueriesReferencing: vi.fn(() => ({
    rollback: vi.fn(),
  })),
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
}));
vi.mock('@service-call/client', () => ({
  callServiceClient: { deleteCallRecord: mocks.deleteCall },
}));
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: { deleteSchedule: mocks.deleteSchedule },
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { reminders: { deleteReminder: mocks.deleteReminder } },
}));

import { scheduledActionKeys } from '@queries/agent-schedule/keys';
import { callKeys } from '@queries/call/keys';
import { notificationKeys } from '@queries/notification/keys';
import { reminderKeys } from '@queries/reminders/keys';
import {
  GRAPHQL_SOUP_DELETE_MUTATION_KEY,
  GRAPHQL_SOUP_DELETE_RETENTION_MS,
  type GraphqlSoupDeleteContext,
  usePendingGraphqlSoupDeleteIds,
} from '@queries/soup/graphql/optimistic-deletions';
import { BulkDeleteFailure } from './bulk-delete-result';
import {
  createBulkCopyDssEntityMutation,
  createBulkDeleteDssItemsMutation,
  createBulkMoveToProjectDssEntityMutation,
  createBulkRemoveFromProjectDssEntityMutation,
  createMoveToProjectDssEntityMutation,
} from './dss';

let client: QueryClient;
let dispose: (() => void) | undefined;
const entity = (id: string, type: EntityData['type'] = 'document') =>
  ({ id, type }) as EntityData;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mount() {
  let result!: {
    mutation: ReturnType<typeof createBulkDeleteDssItemsMutation>;
    pendingIds: ReturnType<typeof usePendingGraphqlSoupDeleteIds>;
  };
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        {(() => {
          result = {
            mutation: createBulkDeleteDssItemsMutation(),
            pendingIds: usePendingGraphqlSoupDeleteIds(),
          };
          return null;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.graphqlEnabled.mockReturnValue(true);
  mocks.removeSoup.mockReturnValue({ rollback: mocks.rollbackSoup });
  mocks.removeSearch.mockReturnValue({ rollback: mocks.rollbackSearch });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.deleteItem.mockResolvedValue(true);
  mocks.moveToFolder.mockResolvedValue(true);
  mocks.copyItem.mockResolvedValue('copied-task');
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => {
  for (const mutation of client.getMutationCache().getAll()) {
    (
      mutation.state.context as GraphqlSoupDeleteContext | undefined
    )?.graphqlDeletion?.release();
  }
  dispose?.();
  client.clear();
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function cacheRows(
  remove: typeof mocks.removeSoup,
  rollback: typeof mocks.rollbackSoup,
  initial: string[]
) {
  let rows = new Set(initial);
  remove.mockImplementation((ids: Set<string>) => {
    const previous = new Set(rows);
    rows = new Set([...rows].filter((id) => !ids.has(id)));
    return {
      rollback: () => {
        rollback();
        rows = new Set(previous);
      },
    };
  });
  return () => [...rows].sort();
}

function mountMutation<T>(factory: () => T): T {
  let mutation!: T;
  function Probe() {
    mutation = factory();
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ),
    document.body
  );
  return mutation;
}

const folderTask: TaskEntity = {
  id: 'task',
  type: 'document',
  name: 'Task',
  ownerId: 'viewer',
  fileType: 'md',
  subType: { type: 'task' },
  projectId: 'source',
};

// These writes still use REST transport even when Soup readers use GraphQL.
// Their successful completion must revalidate GraphQL membership too; marking
// only TanStack soup keys stale cannot update a mounted urql list.
describe('GraphQL Soup membership after list actions', () => {
  it.each([true, false])(
    'revalidates single folder moves only for GraphQL Soup (%s)',
    async (graphql) => {
      mocks.graphqlEnabled.mockReturnValue(graphql);
      const mutation = mountMutation(createMoveToProjectDssEntityMutation);
      await mutation.mutateAsync({
        entity: folderTask,
        project: { id: 'destination' },
      });
      expect(mocks.moveToFolder).toHaveBeenCalledWith({
        itemType: 'document',
        id: 'task',
        folderId: 'destination',
      });
      expect(mocks.refresh).toHaveBeenCalledTimes(graphql ? 1 : 0);
    }
  );

  it.each([true, false])(
    'revalidates bulk folder moves only for GraphQL Soup (%s)',
    async (graphql) => {
      mocks.graphqlEnabled.mockReturnValue(graphql);
      const mutation = mountMutation(createBulkMoveToProjectDssEntityMutation);
      await mutation.mutateAsync({
        entities: [folderTask],
        project: { id: 'destination', name: 'Destination' },
      });
      expect(mocks.moveToFolder).toHaveBeenCalledWith({
        itemType: 'document',
        id: 'task',
        folderId: 'destination',
      });
      expect(mocks.refresh).toHaveBeenCalledTimes(graphql ? 1 : 0);
    }
  );

  it.each([true, false])(
    'revalidates folder removal only for GraphQL Soup (%s)',
    async (graphql) => {
      mocks.graphqlEnabled.mockReturnValue(graphql);
      const mutation = mountMutation(
        createBulkRemoveFromProjectDssEntityMutation
      );
      await mutation.mutateAsync({
        entities: [folderTask],
      });
      expect(mocks.moveToFolder).toHaveBeenCalledWith({
        itemType: 'document',
        id: 'task',
        folderId: null,
      });
      expect(mocks.refresh).toHaveBeenCalledTimes(graphql ? 1 : 0);
    }
  );

  it.each([true, false])(
    'refreshes GraphQL Soup after duplicate returns its new id (%s)',
    async (graphql) => {
      mocks.graphqlEnabled.mockReturnValue(graphql);
      const response = deferred<string>();
      mocks.copyItem.mockReturnValue(response.promise);
      const mutation = mountMutation(createBulkCopyDssEntityMutation);
      const result = mutation.mutateAsync({
        entities: [folderTask],
        name: 'Task copy',
      });
      try {
        await vi.waitFor(() => expect(mocks.copyItem).toHaveBeenCalledOnce());
        // No optimistic placeholder is required when the new id is unknown.
        expect(mocks.refresh).not.toHaveBeenCalled();
      } finally {
        response.resolve('copied-task');
        await result;
      }
      expect(mocks.refresh).toHaveBeenCalledTimes(graphql ? 1 : 0);
    }
  );
});

describe('bulk delete GraphQL optimism', () => {
  it.each(['throw', 'false'] as const)(
    'restores only failed rows in Soup and search after a partial %s failure',
    async (failure) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const soup = cacheRows(mocks.removeSoup, mocks.rollbackSoup, [
        'failed',
        'deleted',
        'other',
      ]);
      const search = cacheRows(mocks.removeSearch, mocks.rollbackSearch, [
        'failed',
        'deleted',
        'other',
      ]);
      const failed = entity('failed');
      const deleted = entity('deleted');
      if (failure === 'throw')
        mocks.deleteItem.mockRejectedValueOnce(new Error('failed delete'));
      else mocks.deleteItem.mockResolvedValueOnce(false);
      mocks.deleteItem.mockResolvedValueOnce(true);
      const refreshed = deferred<void>();
      mocks.refresh.mockReturnValue(refreshed.promise);
      const { mutation, pendingIds } = mount();
      try {
        await expect(
          mutation.mutateAsync([failed, deleted])
        ).rejects.toMatchObject({
          results: [false, true],
          deletedEntities: [deleted],
          failedEntities: [failed],
        });
        expect(soup()).toEqual(['failed', 'other']);
        expect(search()).toEqual(['failed', 'other']);
        expect([...pendingIds()]).toEqual(['deleted']);
        expect(mocks.failure).toHaveBeenCalledWith(
          'Deleted 1 of 2 items; 1 failed'
        );
        expect(mocks.removeSoup).toHaveBeenLastCalledWith(new Set(['deleted']));
        expect(mocks.removeSearch).toHaveBeenLastCalledWith(
          new Set(['deleted'])
        );
      } finally {
        refreshed.resolve();
      }
    }
  );

  it('reconciles successful call/reminder/automation deletes despite sibling failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockResolvedValue(undefined);
    const schedules = [
      { id: 'deleted-auto' },
      { id: 'failed-auto' },
      { id: 'other-auto' },
    ];
    client.setQueryData(scheduledActionKeys.list.queryKey, schedules);
    mocks.deleteItem.mockRejectedValue(new Error('document delete failed'));
    mocks.deleteCall.mockResolvedValue(ok(undefined));
    mocks.deleteReminder.mockResolvedValue(ok(undefined));
    mocks.deleteSchedule.mockImplementation(
      async ({ scheduleId }: { scheduleId: string }) =>
        scheduleId === 'deleted-auto'
          ? ok(undefined)
          : err([{ code: 'FORBIDDEN', message: 'schedule delete failed' }])
    );
    const { mutation } = mount();
    await expect(
      mutation.mutateAsync([
        entity('failed-document'),
        entity('deleted-call', 'call'),
        entity('deleted-reminder', 'reminder'),
        entity('deleted-auto', 'automation'),
        entity('failed-auto', 'automation'),
      ])
    ).rejects.toBeInstanceOf(BulkDeleteFailure);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: callKeys._def });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: reminderKeys._def });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: notificationKeys._def,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: scheduledActionKeys.list.queryKey,
    });
    expect(client.getQueryData(scheduledActionKeys.list.queryKey)).toEqual([
      schedules[1],
      schedules[2],
    ]);
    expect(mocks.failure).toHaveBeenCalledWith(
      'Deleted 3 of 5 items; 2 failed'
    );
  });

  it('does not remove or invalidate unsuccessful side-effect entities', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockResolvedValue(undefined);
    const schedules = [{ id: 'failed-auto' }];
    client.setQueryData(scheduledActionKeys.list.queryKey, schedules);
    mocks.deleteCall.mockRejectedValue(new Error('failed call'));
    mocks.deleteReminder.mockRejectedValue(new Error('failed reminder'));
    mocks.deleteSchedule.mockRejectedValue(new Error('failed schedule'));
    const { mutation } = mount();
    await expect(
      mutation.mutateAsync([
        entity('failed-call', 'call'),
        entity('failed-reminder', 'reminder'),
        entity('failed-auto', 'automation'),
      ])
    ).rejects.toThrow('failed call');
    expect(invalidate).not.toHaveBeenCalled();
    expect(client.getQueryData(scheduledActionKeys.list.queryKey)).toEqual(
      schedules
    );
  });

  it.each([true, false])(
    'handles boolean-only total failure without changing the disabled path (%s)',
    async (graphql) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.graphqlEnabled.mockReturnValue(graphql);
      mocks.deleteItem.mockResolvedValue(false);
      const { mutation } = mount();
      const result = mutation.mutateAsync([entity('failed')]);
      if (graphql) {
        await expect(result).rejects.toThrow('Failed to delete items');
        expect(mocks.rollbackSoup).toHaveBeenCalledOnce();
        expect(mocks.rollbackSearch).toHaveBeenCalledOnce();
        expect(mocks.failure).toHaveBeenCalledWith('Failed to delete items');
      } else {
        await expect(result).resolves.toEqual([false]);
        expect(mocks.rollbackSoup).not.toHaveBeenCalled();
        expect(mocks.rollbackSearch).not.toHaveBeenCalled();
        expect(mocks.failure).not.toHaveBeenCalled();
      }
    }
  );

  it('hides only deletable ids until deletion and GraphQL refresh both finish', async () => {
    const network = deferred<boolean>();
    const refreshed = deferred<void>();
    mocks.deleteItem.mockReturnValue(network.promise);
    mocks.refresh.mockReturnValue(refreshed.promise);
    const { mutation, pendingIds } = mount();
    const result = mutation.mutateAsync([
      entity('task-1'),
      entity('task-2'),
      entity('channel', 'channel'),
    ]);
    await vi.waitFor(() =>
      expect([...pendingIds()]).toEqual(['task-1', 'task-2'])
    );
    expect(mocks.deleteItem).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
    network.resolve(true);
    await expect(result).resolves.toEqual([true, true]);
    await vi.waitFor(() => expect(mutation.isPending).toBe(false));
    expect(mocks.refresh).toHaveBeenCalledWith({ throwOnError: true });
    expect([...pendingIds()]).toEqual(['task-1', 'task-2']);
    refreshed.resolve();
    await vi.waitFor(() => expect(pendingIds().size).toBe(0));
  });

  it('restores failed deletions even while revalidation is still pending', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const network = deferred<boolean>();
    const refreshed = deferred<void>();
    mocks.deleteItem.mockReturnValue(network.promise);
    mocks.refresh.mockReturnValue(refreshed.promise);
    const { mutation, pendingIds } = mount();
    const error = new Error('delete failed');
    const result = expect(
      mutation.mutateAsync([entity('task')])
    ).rejects.toThrow(error);
    await vi.waitFor(() => expect(pendingIds().has('task')).toBe(true));
    network.reject(error);
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.rollbackSoup).toHaveBeenCalledOnce();
    expect(mocks.rollbackSearch).toHaveBeenCalledOnce();
    expect(mocks.failure).toHaveBeenCalledWith('Failed to delete items');
    expect(pendingIds().has('task')).toBe(false);
    await result;
    refreshed.resolve();
    await vi.waitFor(() => expect(pendingIds().size).toBe(0));
  });

  it('revalidates partial boolean failures without treating every item as deleted', async () => {
    mocks.deleteItem.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const refreshed = deferred<void>();
    mocks.refresh.mockReturnValue(refreshed.promise);
    const { mutation, pendingIds } = mount();
    await expect(
      mutation.mutateAsync([entity('deleted'), entity('retained')])
    ).rejects.toMatchObject({
      results: [true, false],
      message: 'Deleted 1 of 2 items; 1 failed',
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect([...pendingIds()]).toEqual(['deleted']);
    refreshed.resolve();
    await vi.waitFor(() => expect(pendingIds().size).toBe(0));
  });

  it.each([true, false])(
    'latches the GraphQL flag at creation (initially %s)',
    async (enabled) => {
      mocks.graphqlEnabled.mockReturnValue(enabled);
      const network = deferred<boolean>();
      const refreshed = deferred<void>();
      mocks.deleteItem.mockReturnValue(network.promise);
      mocks.refresh.mockReturnValue(refreshed.promise);
      const { mutation, pendingIds } = mount();
      mocks.graphqlEnabled.mockReturnValue(!enabled);
      const result = mutation.mutateAsync([entity('task')]);
      await vi.waitFor(() => expect(mocks.deleteItem).toHaveBeenCalledOnce());
      expect(pendingIds().has('task')).toBe(enabled);
      const cached = client.getMutationCache().getAll()[0];
      expect(cached.options.mutationKey).toEqual(
        enabled ? GRAPHQL_SOUP_DELETE_MUTATION_KEY : undefined
      );
      expect(
        Boolean(
          (cached.state.context as GraphqlSoupDeleteContext).graphqlDeletion
        )
      ).toBe(enabled);
      mocks.graphqlEnabled.mockReturnValue(enabled);
      network.resolve(true);
      await result;
      expect(mocks.refresh).toHaveBeenCalledTimes(enabled ? 1 : 0);
      expect(mocks.graphqlEnabled).toHaveBeenCalledTimes(1);
      refreshed.resolve();
      await vi.waitFor(() => expect(pendingIds().size).toBe(0));
    }
  );

  it('does not recreate deletion state after the client is cleared during an API request', async () => {
    const network = deferred<boolean>();
    mocks.deleteItem.mockReturnValue(network.promise);
    const { mutation } = mount();
    const result = mutation.mutateAsync([entity('task')]);
    await vi.waitFor(() => expect(mocks.deleteItem).toHaveBeenCalledOnce());
    client.clear();
    network.resolve(true);
    await result;
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it('does not restore old snapshots when a partial failure arrives after client clearing', async () => {
    const network = deferred<boolean>();
    mocks.deleteItem
      .mockReturnValueOnce(network.promise)
      .mockResolvedValueOnce(true);
    const { mutation } = mount();
    const result = expect(
      mutation.mutateAsync([entity('failed'), entity('deleted')])
    ).rejects.toBeInstanceOf(BulkDeleteFailure);
    await vi.waitFor(() => expect(mocks.deleteItem).toHaveBeenCalledTimes(2));
    client.clear();
    network.resolve(false);
    await result;
    expect(mocks.rollbackSoup).not.toHaveBeenCalled();
    expect(mocks.rollbackSearch).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it('retains successful deletes after a refresh error and clears them on retry success', async () => {
    vi.useFakeTimers();
    mocks.refresh
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const { mutation, pendingIds } = mount();
    await mutation.mutateAsync([entity('task')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mutation.isPending).toBe(false);
    expect([...pendingIds()]).toEqual(['task']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(pendingIds().size).toBe(0);
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it('retains the successful siblings when another delete throws, waiting for every outcome', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const slowSuccess = deferred<boolean>();
    const refreshed = deferred<void>();
    mocks.deleteItem
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockReturnValueOnce(slowSuccess.promise);
    mocks.refresh.mockReturnValue(refreshed.promise);
    const { mutation, pendingIds } = mount();
    const result = expect(
      mutation.mutateAsync([entity('failed'), entity('deleted')])
    ).rejects.toThrow('Deleted 1 of 2 items; 1 failed');
    await vi.waitFor(() => expect(mocks.deleteItem).toHaveBeenCalledTimes(2));
    expect(mocks.refresh).not.toHaveBeenCalled();
    slowSuccess.resolve(true);
    await result;
    expect([...pendingIds()]).toEqual(['deleted']);
    refreshed.resolve();
    await vi.waitFor(() => expect(pendingIds().size).toBe(0));
  });

  it.each([false, true])(
    'preserves disabled-path behavior (failure: %s)',
    async (fails) => {
      mocks.graphqlEnabled.mockReturnValue(false);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const network = deferred<boolean>();
      mocks.deleteItem.mockReturnValue(network.promise);
      const { mutation, pendingIds } = mount();
      const result = mutation.mutateAsync([entity('task')]);
      const settled = fails
        ? expect(result).rejects.toThrow('delete failed')
        : expect(result).resolves.toEqual([true]);
      await vi.waitFor(() => expect(mocks.deleteItem).toHaveBeenCalledOnce());
      expect(mocks.removeSoup).toHaveBeenCalledWith(new Set(['task']));
      expect(mocks.removeSearch).toHaveBeenCalledWith(new Set(['task']));
      expect(pendingIds().size).toBe(0);
      expect(
        client.getMutationCache().getAll()[0].options.mutationKey
      ).toBeUndefined();
      expect(
        client.getMutationCache().getAll()[0].options.onSettled
      ).toBeUndefined();
      if (fails) network.reject(new Error('delete failed'));
      else network.resolve(true);
      await settled;
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.rollbackSoup).toHaveBeenCalledTimes(fails ? 1 : 0);
      expect(mocks.rollbackSearch).toHaveBeenCalledTimes(fails ? 1 : 0);
    }
  );
});
