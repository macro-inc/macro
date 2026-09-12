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
  updateThreadLabel: vi.fn(async () => {}),
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
});
