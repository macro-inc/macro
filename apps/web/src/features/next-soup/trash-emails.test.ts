import { afterEach, describe, expect, it, vi } from 'vitest';

const operationMocks = vi.hoisted(() => ({
  cancelQueries: vi.fn(async () => {}),
  fetchAndCacheThread: vi.fn(),
  fetchQuery: vi.fn(),
  getQueriesData: vi.fn(() => []),
  getQueryData: vi.fn(),
  invalidateQueries: vi.fn(async () => {}),
  invalidateSoupEntity: vi.fn(async () => {}),
  setQueryData: vi.fn(),
  setMailboxState:
    vi.fn<
      (input: {
        threadId: string;
        field: 'TRASHED';
        value: boolean;
      }) => Promise<void>
    >(),
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
vi.mock('@queries/email/mailbox-state', () => ({
  setEmailMailboxFolderStates: (
    ids: string[],
    field: 'TRASHED',
    value: boolean
  ) =>
    Promise.allSettled(
      ids.map((threadId) =>
        operationMocks.setMailboxState({ threadId, field, value })
      )
    ),
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
}));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: vi.fn(),
  invalidateSoupEntity: operationMocks.invalidateSoupEntity,
  optimisticUpdateSoupEntity: vi.fn(() => ({ rollback: vi.fn() })),
  removeSoupEntities: vi.fn(() => ({ rollback: vi.fn() })),
}));
vi.mock('@service-email/client', () => ({
  emailClient: {
    getUserLabels: vi.fn(async () => ({ labels: [] })),
  },
}));

import { trashEmails } from './utils';

afterEach(() => {
  vi.clearAllMocks();
  operationMocks.getQueriesData.mockReturnValue([]);
  operationMocks.getQueryData.mockReturnValue(undefined);
  operationMocks.setMailboxState.mockResolvedValue(undefined);
  operationMocks.fetchAndCacheThread.mockReset();
});

describe('trashEmails', () => {
  it('trashes and restores threads across providers independently', async () => {
    const handle = trashEmails([
      { id: 'thread-a', linkId: 'link-a' },
      { id: 'thread-b', linkId: 'link-b' },
    ]);

    await handle.done;

    expect(operationMocks.setMailboxState).toHaveBeenCalledTimes(2);
    expect(operationMocks.setMailboxState).toHaveBeenCalledWith({
      threadId: 'thread-a',
      field: 'TRASHED',
      value: true,
    });
    expect(operationMocks.setMailboxState).toHaveBeenCalledWith({
      threadId: 'thread-b',
      field: 'TRASHED',
      value: true,
    });
    expect(operationMocks.fetchAndCacheThread).not.toHaveBeenCalled();

    await handle.undo();

    expect(operationMocks.setMailboxState).toHaveBeenCalledTimes(4);
    expect(operationMocks.setMailboxState).toHaveBeenCalledWith({
      threadId: 'thread-a',
      field: 'TRASHED',
      value: false,
    });
    expect(operationMocks.setMailboxState).toHaveBeenCalledWith({
      threadId: 'thread-b',
      field: 'TRASHED',
      value: false,
    });
  });

  it('lets the server resolve the owning inbox when linkId is missing', async () => {
    const handle = trashEmails([{ id: 'thread-b' }]);
    await handle.done;
    expect(operationMocks.fetchAndCacheThread).not.toHaveBeenCalled();
    expect(operationMocks.fetchQuery).not.toHaveBeenCalled();
    expect(operationMocks.setMailboxState).toHaveBeenCalledWith({
      threadId: 'thread-b',
      field: 'TRASHED',
      value: true,
    });
  });

  it('works for Outlook without Gmail system labels', async () => {
    operationMocks.fetchQuery.mockResolvedValue({ labels: [] });
    const handle = trashEmails([{ id: 'outlook-thread', linkId: 'outlook' }]);
    await handle.done;
    expect(operationMocks.fetchQuery).not.toHaveBeenCalled();
    expect(operationMocks.setMailboxState).toHaveBeenCalledWith({
      threadId: 'outlook-thread',
      field: 'TRASHED',
      value: true,
    });
  });

  it('surfaces an API failure and rejects done', async () => {
    operationMocks.setMailboxState.mockRejectedValue(
      new Error('Provider unavailable')
    );

    const handle = trashEmails([{ id: 'thread-a', linkId: 'link-a' }]);

    await expect(handle.done).rejects.toThrow();
    expect(operationMocks.setMailboxState).toHaveBeenCalledWith({
      threadId: 'thread-a',
      field: 'TRASHED',
      value: true,
    });
  });

  it('reverts threads that trashed when a sibling fails', async () => {
    operationMocks.setMailboxState.mockImplementation(async (args) => {
      if (args.threadId === 'thread-b' && args.value)
        throw new Error('Provider unavailable');
    });

    const handle = trashEmails([
      { id: 'thread-a', linkId: 'link-a' },
      { id: 'thread-b', linkId: 'link-b' },
    ]);

    await expect(handle.done).rejects.toThrow();

    // thread-a trashed, thread-b failed -> thread-a is reverted so the server
    // matches the rolled-back UI, and undo has nothing left to restore.
    expect(operationMocks.setMailboxState).toHaveBeenCalledWith({
      threadId: 'thread-a',
      field: 'TRASHED',
      value: false,
    });

    await handle.undo();
    expect(operationMocks.setMailboxState).not.toHaveBeenCalledWith(
      expect.objectContaining({ value: false, threadId: 'thread-b' })
    );
  });
});
