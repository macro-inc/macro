import type { ResultError } from '@core/util/result';
import { errAsync, okAsync } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type LocalDatabaseAwareness,
  useDatabaseAwareness,
  useDatabaseTableChanges,
} from './databases-sync';

const mock = vi.hoisted(() => ({
  event: undefined as
    | ((message: { type: string; data: unknown }) => void)
    | undefined,
  shareAwareness: vi.fn(
    (_request: { id: string; state: Record<string, unknown> }) =>
      okAsync<Record<string, never>, ResultError[]>({})
  ),
  warn: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: (handler: typeof mock.event) => {
    mock.event = handler;
  },
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: { shareAwareness: mock.shareAwareness } },
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { warn: mock.warn },
}));
vi.mock('./databases', () => ({
  invalidateDatabase: vi.fn(),
}));

function relay(
  userId: string,
  state: Record<string, unknown>,
  relayedAt: number,
  databaseId = 'db'
) {
  mock.event?.({
    type: 'database_awareness',
    data: JSON.stringify({ databaseId, userId, state, relayedAt }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  mock.shareAwareness.mockClear();
  mock.warn.mockClear();
});

it('sends the local state debounced, heartbeats it, and announces leaving on dispose', () => {
  const [local, setLocal] = createSignal<LocalDatabaseAwareness | undefined>({
    tableId: 'tasks',
    rowId: 'row-1',
    columnId: 'name',
  });
  const dispose = createRoot((dispose) => {
    useDatabaseAwareness(() => 'db', local);
    return dispose;
  });
  expect(mock.shareAwareness).not.toHaveBeenCalled();
  setLocal({ tableId: 'tasks', rowId: 'row-1', columnId: 'notes' });
  setLocal({
    tableId: 'tasks',
    rowId: 'row-1',
    columnId: 'notes',
    endRowId: 'row-3',
    endColumnId: 'status',
    editing: true,
  });
  vi.advanceTimersByTime(150);
  expect(mock.shareAwareness).toHaveBeenCalledTimes(1);
  expect(mock.shareAwareness).toHaveBeenCalledWith({
    id: 'db',
    state: {
      tableId: 'tasks',
      rowId: 'row-1',
      columnId: 'notes',
      endRowId: 'row-3',
      endColumnId: 'status',
      editing: true,
    },
  });
  vi.advanceTimersByTime(20_000);
  expect(mock.shareAwareness).toHaveBeenCalledTimes(2);
  expect(mock.shareAwareness).toHaveBeenLastCalledWith({
    id: 'db',
    state: {
      tableId: 'tasks',
      rowId: 'row-1',
      columnId: 'notes',
      endRowId: 'row-3',
      endColumnId: 'status',
      editing: true,
    },
  });
  setLocal({ tableId: 'tasks' });
  vi.advanceTimersByTime(150);
  expect(mock.shareAwareness).toHaveBeenLastCalledWith({
    id: 'db',
    state: {
      tableId: 'tasks',
    },
  });
  dispose();
  expect(mock.shareAwareness).toHaveBeenLastCalledWith({
    id: 'db',
    state: {
      tableId: 'tasks',
      left: true,
    },
  });
  expect(mock.shareAwareness).toHaveBeenCalledTimes(4);
});

it('merges remote states per user, drops stale relays, itself, other databases, leavers, and silent viewers', () => {
  const { remote, dispose } = createRoot((dispose) => ({
    remote: useDatabaseAwareness(
      () => 'db',
      () => ({ tableId: 'tasks' })
    ).remote,
    dispose,
  }));
  relay('alex', { tableId: 'tasks', rowId: 'row-1', columnId: 'name' }, 100);
  relay('me', { tableId: 'tasks', rowId: 'row-2', columnId: 'name' }, 101);
  relay(
    'sam',
    { tableId: 'tasks', rowId: 'row-3', columnId: 'name' },
    102,
    'other-db'
  );
  expect(remote()).toEqual([
    {
      userId: 'alex',
      tableId: 'tasks',
      rowId: 'row-1',
      columnId: 'name',
      editing: false,
    },
  ]);
  // An older relay arriving late never rewinds a viewer.
  relay('alex', { tableId: 'tasks', rowId: 'row-9', columnId: 'name' }, 99);
  expect(remote()[0].rowId).toBe('row-1');
  relay(
    'alex',
    {
      tableId: 'tasks',
      rowId: 'row-1',
      columnId: 'notes',
      endRowId: 'row-3',
      endColumnId: 'status',
      editing: true,
    },
    103
  );
  expect(remote()[0]).toMatchObject({
    columnId: 'notes',
    endRowId: 'row-3',
    endColumnId: 'status',
    editing: true,
  });
  relay('sam', { tableId: 'people' }, 104);
  expect(remote().map((user) => user.userId)).toEqual(['alex', 'sam']);
  relay('sam', { tableId: 'people', left: true }, 105);
  expect(remote().map((user) => user.userId)).toEqual(['alex']);
  vi.advanceTimersByTime(30_000);
  relay('sam', { tableId: 'people' }, 106);
  vi.advanceTimersByTime(20_000);
  // Alex went quiet for 50 s; Sam refreshed 20 s ago.
  expect(remote().map((user) => user.userId)).toEqual(['sam']);
  dispose();
});

it('reports an awareness update the service refused', async () => {
  mock.shareAwareness.mockReturnValueOnce(
    errAsync([{ code: 'FORBIDDEN', message: 'no access' } as ResultError])
  );
  const dispose = createRoot((dispose) => {
    useDatabaseAwareness(
      () => 'db',
      () => ({ tableId: 'tasks' })
    );
    return dispose;
  });
  vi.advanceTimersByTime(150);
  await vi.waitFor(() =>
    expect(mock.warn).toHaveBeenCalledWith(
      'database awareness was not shared',
      {
        databaseId: 'db',
        errors: JSON.stringify([{ code: 'FORBIDDEN', message: 'no access' }]),
      }
    )
  );
  dispose();
});

it('reports table changes the gateway announces and drops a payload that does not fit', () => {
  const onChange = vi.fn();
  const dispose = createRoot((dispose) => {
    useDatabaseTableChanges(onChange);
    return dispose;
  });
  mock.event?.({
    type: 'database_table_changed',
    data: JSON.stringify({ databaseId: 'db', tableId: 'tasks', version: 7 }),
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    databaseId: 'db',
    tableId: 'tasks',
    version: 7,
  });
  mock.event?.({
    type: 'database_table_changed',
    data: { databaseId: 'db', tableId: 'tasks', version: '8' },
  });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(mock.warn).toHaveBeenCalledWith(
    'gateway payload did not match its schema',
    {
      type: 'database_table_changed',
      issues: JSON.stringify([
        {
          expected: 'number',
          code: 'invalid_type',
          path: ['version'],
          message: 'Invalid input: expected number, received string',
        },
      ]),
    }
  );
  dispose();
});

it('drops an awareness relay without its relay time', () => {
  const { remote, dispose } = createRoot((dispose) => ({
    remote: useDatabaseAwareness(
      () => 'db',
      () => ({ tableId: 'tasks' })
    ).remote,
    dispose,
  }));
  mock.event?.({
    type: 'database_awareness',
    data: JSON.stringify({
      databaseId: 'db',
      userId: 'alex',
      state: { tableId: 'tasks' },
      ts: 100,
    }),
  });
  expect(remote()).toEqual([]);
  expect(mock.warn).toHaveBeenCalledWith(
    'gateway payload did not match its schema',
    {
      type: 'database_awareness',
      issues: JSON.stringify([
        {
          expected: 'number',
          code: 'invalid_type',
          path: ['relayedAt'],
          message: 'Invalid input: expected number, received undefined',
        },
      ]),
    }
  );
  dispose();
});
