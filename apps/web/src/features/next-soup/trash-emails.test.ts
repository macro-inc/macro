import { afterEach, describe, expect, it, vi } from 'vitest';

// updateThreadLabel returns a Result (an HTTP failure resolves to Err rather
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
  updateThreadLabel: vi.fn(
    async (_args: {
      thread_id: string;
      label_id: string;
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
vi.mock('@queries/reminders/reminders', () => ({
  invalidateRemindersById: vi.fn(),
  setReminderCompleted: vi.fn(async () => {}),
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
    updateThreadLabel: operationMocks.updateThreadLabel,
  },
}));

import { trashEmails } from './utils';

const trashLabels = [
  {
    id: 'trash-a',
    linkId: 'link-a',
    providerLabelId: 'TRASH',
  },
  {
    id: 'trash-b',
    linkId: 'link-b',
    providerLabelId: 'TRASH',
  },
];

afterEach(() => {
  vi.clearAllMocks();
  operationMocks.fetchQuery.mockResolvedValue({ labels: trashLabels });
  operationMocks.getQueriesData.mockReturnValue([]);
  operationMocks.getQueryData.mockReturnValue(undefined);
  operationMocks.updateThreadLabel.mockImplementation(async () => okResult);
  operationMocks.fetchAndCacheThread.mockReset();
});

describe('trashEmails', () => {
  it('uses and undoes the TRASH label for each inbox independently', async () => {
    operationMocks.fetchQuery.mockResolvedValue({ labels: trashLabels });

    const handle = trashEmails([
      { id: 'thread-a', linkId: 'link-a' },
      { id: 'thread-b', linkId: 'link-b' },
    ]);

    await handle.done;

    expect(operationMocks.updateThreadLabel).toHaveBeenCalledTimes(2);
    expect(operationMocks.updateThreadLabel).toHaveBeenCalledWith({
      thread_id: 'thread-a',
      label_id: 'trash-a',
      value: true,
    });
    expect(operationMocks.updateThreadLabel).toHaveBeenCalledWith({
      thread_id: 'thread-b',
      label_id: 'trash-b',
      value: true,
    });
    expect(operationMocks.fetchAndCacheThread).not.toHaveBeenCalled();

    await handle.undo();

    expect(operationMocks.updateThreadLabel).toHaveBeenCalledTimes(4);
    expect(operationMocks.updateThreadLabel).toHaveBeenCalledWith({
      thread_id: 'thread-a',
      label_id: 'trash-a',
      value: false,
    });
    expect(operationMocks.updateThreadLabel).toHaveBeenCalledWith({
      thread_id: 'thread-b',
      label_id: 'trash-b',
      value: false,
    });
  });

  it('fetches the thread through queries when multi-inbox linkId is missing', async () => {
    operationMocks.fetchQuery.mockResolvedValue({ labels: trashLabels });
    operationMocks.fetchAndCacheThread.mockResolvedValueOnce({
      isErr: () => false,
      value: { thread: { link_id: 'link-b' } },
    });

    const handle = trashEmails([{ id: 'thread-b' }]);
    await handle.done;

    expect(operationMocks.fetchAndCacheThread).toHaveBeenCalledWith('thread-b');
    expect(operationMocks.updateThreadLabel).toHaveBeenCalledWith({
      thread_id: 'thread-b',
      label_id: 'trash-b',
      value: true,
    });
  });

  it('falls back to the sole TRASH label only when the inbox is unknown', async () => {
    operationMocks.fetchQuery.mockResolvedValue({ labels: [trashLabels[0]] });

    const handle = trashEmails([{ id: 'thread-x' }]);
    await handle.done;

    // A single inbox needs no thread fetch to disambiguate.
    expect(operationMocks.fetchAndCacheThread).not.toHaveBeenCalled();
    expect(operationMocks.updateThreadLabel).toHaveBeenCalledWith({
      thread_id: 'thread-x',
      label_id: 'trash-a',
      value: true,
    });
  });

  it('fails without trashing when a known inbox has no matching label', async () => {
    operationMocks.fetchQuery.mockResolvedValue({ labels: trashLabels });

    const handle = trashEmails([{ id: 'thread-c', linkId: 'link-c' }]);

    await expect(handle.done).rejects.toThrow();
    // The mismatch is caught before any label is applied, so nothing is trashed
    // into the wrong inbox.
    expect(operationMocks.updateThreadLabel).not.toHaveBeenCalled();
  });

  it('surfaces an API failure and rejects done', async () => {
    operationMocks.fetchQuery.mockResolvedValue({ labels: trashLabels });
    operationMocks.updateThreadLabel.mockImplementation(async () => errResult);

    const handle = trashEmails([{ id: 'thread-a', linkId: 'link-a' }]);

    await expect(handle.done).rejects.toThrow();
    // A failed trash must not silently look like a success (throwOnErr).
    expect(operationMocks.updateThreadLabel).toHaveBeenCalledWith({
      thread_id: 'thread-a',
      label_id: 'trash-a',
      value: true,
    });
  });

  it('reverts threads that trashed when a sibling fails', async () => {
    operationMocks.fetchQuery.mockResolvedValue({ labels: trashLabels });
    operationMocks.updateThreadLabel.mockImplementation(async (args) =>
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
    expect(operationMocks.updateThreadLabel).toHaveBeenCalledWith({
      thread_id: 'thread-a',
      label_id: 'trash-a',
      value: false,
    });

    await handle.undo();
    expect(operationMocks.updateThreadLabel).not.toHaveBeenCalledWith(
      expect.objectContaining({ value: false, thread_id: 'thread-b' })
    );
  });
});
