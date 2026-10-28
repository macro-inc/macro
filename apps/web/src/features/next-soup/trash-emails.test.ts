import { afterEach, describe, expect, it, vi } from 'vitest';

// updateThreadState returns a Result (an HTTP failure resolves to Err rather
// than rejecting), so the mock mirrors that shape; trashEmails wraps it in
// throwOnErr.
type ResultLike = {
  isErr: () => boolean;
  value?: undefined;
  error?: { code: string; message: string }[];
};
const okResult: ResultLike = { isErr: () => false, value: undefined };
const errResult: ResultLike = {
  isErr: () => true,
  error: [{ code: 'ERR', message: 'boom' }],
};

const operationMocks = vi.hoisted(() => ({
  cancelQueries: vi.fn(async () => {}),
  fetchAndCacheThread: vi.fn(),
  fetchQuery: vi.fn(),
  getQueriesData: vi.fn(() => []),
  getQueryData: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
  invalidateSoupEntity: vi.fn(async () => {}),
  setQueryData: vi.fn(),
  refreshGraphqlSoup: vi.fn(async () => {}),
  updateThreadState: vi.fn(
    async (_args: {
      thread_id: string;
      field: 'trashed';
      value: boolean;
    }): Promise<ResultLike> => ({ isErr: () => false, value: undefined })
  ),
}));

// utils.ts transitively imports websocket clients that would otherwise open
// real sockets at module scope under jsdom.
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
vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    alert: vi.fn(),
    dismiss: vi.fn(),
    failure: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    cancelQueries: operationMocks.cancelQueries,
    fetchQuery: operationMocks.fetchQuery,
    getQueriesData: operationMocks.getQueriesData,
    getQueryData: operationMocks.getQueryData,
    invalidateQueries: operationMocks.invalidateQueries,
    setQueryData: operationMocks.setQueryData,
  },
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => true,
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: operationMocks.refreshGraphqlSoup,
}));
vi.mock('@queries/email/thread', () => ({
  fetchAndCacheThread: operationMocks.fetchAndCacheThread,
}));
vi.mock('@queries/notification/entity-mutations', () => ({
  updateNotificationsForEntities: vi.fn(async () => []),
}));
vi.mock('@queries/notification/user-notifications', () => ({
  bulkMarkNotificationsAsDone: vi.fn(async () => {}),
  bulkMarkNotificationsAsUndone: vi.fn(async () => {}),
  restoreUserNotifications: vi.fn(),
  snapshotUserNotifications: vi.fn(() => []),
}));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: vi.fn(),
  invalidateSoupEntity: operationMocks.invalidateSoupEntity,
  optimisticUpdateSoupEntity: vi.fn(() => ({ rollback: vi.fn() })),
  removeSoupEntities: vi.fn(() => ({ rollback: vi.fn() })),
  removeSoupEntitiesFromDoneFilteredQueries: vi.fn(() => ({
    rollback: vi.fn(),
  })),
}));
vi.mock('@service-email/client', () => ({
  emailClient: {
    flagArchived: vi.fn(async () => {}),
    getUserLabels: vi.fn(async () => ({ labels: [] })),
    updateThreadState: operationMocks.updateThreadState,
  },
}));

import { trashEmails } from './utils';

afterEach(() => {
  vi.clearAllMocks();
  operationMocks.getQueriesData.mockReturnValue([]);
  operationMocks.getQueryData.mockReturnValue(undefined);
  operationMocks.updateThreadState.mockImplementation(async () => okResult);
  operationMocks.fetchAndCacheThread.mockReset();
});

describe('trashEmails', () => {
  it('revalidates mounted GraphQL Soup membership after trash succeeds', async () => {
    const handle = trashEmails([{ id: 'thread-a', linkId: 'link-a' }]);
    await handle.done;
    expect(operationMocks.updateThreadState).toHaveBeenCalledWith({
      thread_id: 'thread-a',
      field: 'trashed',
      value: true,
    });
    expect(
      operationMocks.refreshGraphqlSoup,
      'TanStack invalidation cannot remove a row from a mounted GraphQL Soup list'
    ).toHaveBeenCalled();
  });

  it('revalidates mounted GraphQL Soup membership after trash undo succeeds', async () => {
    const handle = trashEmails([{ id: 'thread-b', linkId: 'link-b' }]);
    await handle.done;
    operationMocks.refreshGraphqlSoup.mockClear();
    await handle.undo();
    expect(operationMocks.updateThreadState).toHaveBeenLastCalledWith({
      thread_id: 'thread-b',
      field: 'trashed',
      value: false,
    });
    expect(
      operationMocks.refreshGraphqlSoup,
      'Restoring a legacy snapshot cannot restore GraphQL Soup membership'
    ).toHaveBeenCalled();
  });

  it('trashes and restores threads across providers independently', async () => {
    const handle = trashEmails([
      { id: 'thread-a', linkId: 'link-a' },
      { id: 'thread-b', linkId: 'link-b' },
    ]);

    await handle.done;

    expect(operationMocks.updateThreadState).toHaveBeenCalledTimes(2);
    expect(operationMocks.updateThreadState).toHaveBeenCalledWith({
      thread_id: 'thread-a',
      field: 'trashed',
      value: true,
    });
    expect(operationMocks.updateThreadState).toHaveBeenCalledWith({
      thread_id: 'thread-b',
      field: 'trashed',
      value: true,
    });
    expect(operationMocks.fetchAndCacheThread).not.toHaveBeenCalled();

    await handle.undo();

    expect(operationMocks.updateThreadState).toHaveBeenCalledTimes(4);
    expect(operationMocks.updateThreadState).toHaveBeenCalledWith({
      thread_id: 'thread-a',
      field: 'trashed',
      value: false,
    });
    expect(operationMocks.updateThreadState).toHaveBeenCalledWith({
      thread_id: 'thread-b',
      field: 'trashed',
      value: false,
    });
  });

  it('lets the server resolve the owning inbox when linkId is missing', async () => {
    const handle = trashEmails([{ id: 'thread-b' }]);
    await handle.done;
    expect(operationMocks.fetchAndCacheThread).not.toHaveBeenCalled();
    expect(operationMocks.fetchQuery).not.toHaveBeenCalled();
    expect(operationMocks.updateThreadState).toHaveBeenCalledWith({
      thread_id: 'thread-b',
      field: 'trashed',
      value: true,
    });
  });

  it('works for Outlook without Gmail system labels', async () => {
    operationMocks.fetchQuery.mockResolvedValue({ labels: [] });
    const handle = trashEmails([{ id: 'outlook-thread', linkId: 'outlook' }]);
    await handle.done;
    expect(operationMocks.fetchQuery).not.toHaveBeenCalled();
    expect(operationMocks.updateThreadState).toHaveBeenCalledWith({
      thread_id: 'outlook-thread',
      field: 'trashed',
      value: true,
    });
  });

  it('surfaces an API failure and rejects done', async () => {
    operationMocks.updateThreadState.mockImplementation(async () => errResult);

    const handle = trashEmails([{ id: 'thread-a', linkId: 'link-a' }]);

    await expect(handle.done).rejects.toThrow();
    // A failed trash must not silently look like a success (throwOnErr).
    expect(operationMocks.updateThreadState).toHaveBeenCalledWith({
      thread_id: 'thread-a',
      field: 'trashed',
      value: true,
    });
  });

  it('reverts threads that trashed when a sibling fails', async () => {
    operationMocks.updateThreadState.mockImplementation(async (args) =>
      args.thread_id === 'thread-b' && args.value === true
        ? errResult
        : okResult
    );

    const handle = trashEmails([
      { id: 'thread-a', linkId: 'link-a' },
      { id: 'thread-b', linkId: 'link-b' },
    ]);

    await expect(handle.done).rejects.toThrow();

    // thread-a trashed, thread-b failed -> thread-a is reverted so the server
    // matches the rolled-back UI, and undo has nothing left to restore.
    expect(operationMocks.updateThreadState).toHaveBeenCalledWith({
      thread_id: 'thread-a',
      field: 'trashed',
      value: false,
    });

    await handle.undo();
    expect(operationMocks.updateThreadState).not.toHaveBeenCalledWith(
      expect.objectContaining({ value: false, thread_id: 'thread-b' })
    );
  });
});
