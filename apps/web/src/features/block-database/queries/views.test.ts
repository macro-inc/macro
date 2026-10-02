import { queryClient } from '@queries/client';
import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { OpResult } from '@service-storage/generated/schemas/opResult';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDatabaseView,
  moveDatabaseCard,
  reorderDatabaseViews,
  updateDatabaseView,
} from './views';

const transport = vi.hoisted(() => ({
  applyDatabaseOps: vi.fn(),
  applyDatabaseTableVersions: vi.fn(),
  invalidateDatabase: vi.fn(),
}));
vi.mock('@queries/storage/databases', () => transport);
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

afterEach(() => {
  queryClient.clear();
  vi.resetAllMocks();
});

const detail: DatabaseDetail = {
  database: {
    id: 'db',
    name: 'Party Planner',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
  },
  grant: 'owner',
  tables: [
    {
      table: {
        id: 'invites',
        database_id: 'db',
        name: 'Invites',
        position: 'a',
        version: 3,
      },
      sql_name: '"Invites"',
      columns: [],
      views: [
        {
          id: 'first',
          databaseId: 'db',
          tableId: 'invites',
          name: 'First',
          position: 'a0',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
        {
          id: 'second',
          databaseId: 'db',
          tableId: 'invites',
          name: 'Second',
          position: 'a1',
          query: { filter: null, sort: [] },
          layout: { kind: 'table', columns: [] },
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ],
    },
  ],
};

function cachedViews() {
  return queryClient
    .getQueryData<DatabaseDetail>(databasesKeys.detail('db').queryKey)
    ?.tables[0].views.map((view) => [view.id, view.position]);
}

describe('creating a view', () => {
  it('sends the view under an id minted here and adds the stored view', async () => {
    queryClient.setQueryData(databasesKeys.detail('db').queryKey, detail);
    const stored = {
      id: '0199a3c4-0000-7000-8000-000000000003',
      databaseId: 'db',
      tableId: 'invites',
      name: 'Third',
      position: 'a2',
      query: { filter: null, sort: [] },
      layout: { kind: 'table' as const, columns: [] },
      createdAt: '2026-10-01T00:03:00Z',
      updatedAt: '2026-10-01T00:03:00Z',
    };
    transport.applyDatabaseOps.mockReturnValue(
      ResultAsync.fromSafePromise(
        Promise.resolve<OpResult[]>([
          {
            kind: 'view',
            table: 'invites',
            view: '0199a3c4-0000-7000-8000-000000000003',
            tableVersion: 4,
            change: { kind: 'created', view: stored },
          },
        ])
      )
    );

    const created = await createDatabaseView(
      'db',
      'invites',
      { name: 'Third', layout: { kind: 'table', columns: [] } },
      '0199a3c4-0000-7000-8000-000000000003'
    );

    expect(created._unsafeUnwrap()).toEqual(stored);
    expect(transport.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith('db', [
      {
        kind: 'view',
        table: 'invites',
        view: '0199a3c4-0000-7000-8000-000000000003',
        change: {
          kind: 'create',
          view: { name: 'Third', layout: { kind: 'table', columns: [] } },
        },
      },
    ]);
    expect(cachedViews()).toEqual([
      ['first', 'a0'],
      ['second', 'a1'],
      ['0199a3c4-0000-7000-8000-000000000003', 'a2'],
    ]);
  });

  it('mints a UUIDv7 view id when none is given', async () => {
    transport.applyDatabaseOps.mockReturnValue(
      errAsync({
        code: 'INVALID_OP',
        message: 'the view needs a name',
        refusal: null,
      })
    );

    await createDatabaseView('db', 'invites', {
      name: '',
      layout: { kind: 'table', columns: [] },
    });

    expect(transport.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith('db', [
      {
        kind: 'view',
        table: 'invites',
        view: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        ),
        change: {
          kind: 'create',
          view: { name: '', layout: { kind: 'table', columns: [] } },
        },
      },
    ]);
  });
});

describe('reordering a table’s views', () => {
  it('sends reorder_views with every view, shows the order at once and keeps the keys the server wrote', async () => {
    queryClient.setQueryData(databasesKeys.detail('db').queryKey, detail);
    const { promise: answered, resolve: answer } =
      Promise.withResolvers<OpResult[]>();
    transport.applyDatabaseOps.mockReturnValue(
      ResultAsync.fromSafePromise(answered)
    );

    const reordered = reorderDatabaseViews('db', 'invites', [
      'second',
      'first',
    ]);
    await vi.waitFor(() =>
      expect(transport.applyDatabaseOps).toHaveBeenCalled()
    );
    expect(cachedViews()).toEqual([
      ['second', 'a1'],
      ['first', 'a0'],
    ]);
    answer([
      {
        kind: 'table',
        table: 'invites',
        tableVersion: 4,
        change: {
          kind: 'views_reordered',
          positions: [
            { view: 'second', position: 'Zz' },
            { view: 'first', position: 'a0' },
          ],
        },
      },
    ]);
    expect((await reordered).isOk()).toBe(true);

    expect(transport.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith('db', [
      {
        kind: 'table',
        table: 'invites',
        change: { kind: 'reorder_views', order: ['second', 'first'] },
      },
    ]);
    expect(transport.applyDatabaseTableVersions).toHaveBeenCalledWith('db', {
      invites: 4,
    });
    expect(cachedViews()).toEqual([
      ['second', 'Zz'],
      ['first', 'a0'],
    ]);
  });

  it('reads the views again when the server refuses the order', async () => {
    queryClient.setQueryData(databasesKeys.detail('db').queryKey, detail);
    transport.applyDatabaseOps.mockReturnValue(
      errAsync({
        code: 'INVALID_OP',
        message: 'the order must name every view of the table once',
        refusal: {
          op: 0,
          row: null,
          column: null,
          message: 'the order must name every view of the table once',
        },
      })
    );

    const reordered = await reorderDatabaseViews('db', 'invites', ['second']);

    expect(reordered.isErr()).toBe(true);
    expect(transport.invalidateDatabase).toHaveBeenCalledExactlyOnceWith('db');
  });
});

describe('changing a view', () => {
  it('keeps a later change on screen when an earlier one answers after it was made', async () => {
    queryClient.setQueryData(databasesKeys.detail('db').queryKey, detail);
    const { promise: firstAnswered, resolve: answerFirst } =
      Promise.withResolvers<OpResult[]>();
    const { promise: secondAnswered, resolve: answerSecond } =
      Promise.withResolvers<OpResult[]>();
    transport.applyDatabaseOps
      .mockReturnValueOnce(ResultAsync.fromSafePromise(firstAnswered))
      .mockReturnValueOnce(ResultAsync.fromSafePromise(secondAnswered));
    const first = detail.tables[0].views[0];

    const renamed = updateDatabaseView(first, { name: 'Guests' });
    const renamedAgain = updateDatabaseView(first, { name: 'Attendees' });
    await vi.waitFor(() =>
      expect(transport.applyDatabaseOps).toHaveBeenCalledTimes(1)
    );
    answerFirst([
      {
        kind: 'view',
        table: 'invites',
        view: 'first',
        tableVersion: 4,
        change: {
          kind: 'updated',
          view: {
            ...first,
            name: 'Guests',
            updatedAt: '2026-10-01T00:01:00Z',
          },
        },
      },
    ]);
    expect((await renamed).isOk()).toBe(true);

    expect(
      queryClient.getQueryData<DatabaseDetail>(
        databasesKeys.detail('db').queryKey
      )?.tables[0].views[0].name
    ).toBe('Attendees');

    await vi.waitFor(() =>
      expect(transport.applyDatabaseOps).toHaveBeenCalledTimes(2)
    );
    answerSecond([
      {
        kind: 'view',
        table: 'invites',
        view: 'first',
        tableVersion: 5,
        change: {
          kind: 'updated',
          view: {
            ...first,
            name: 'Attendees',
            updatedAt: '2026-10-01T00:02:00Z',
          },
        },
      },
    ]);
    expect((await renamedAgain).isOk()).toBe(true);
    expect(
      queryClient.getQueryData<DatabaseDetail>(
        databasesKeys.detail('db').queryKey
      )?.tables[0].views[0]
    ).toEqual({
      id: 'first',
      databaseId: 'db',
      tableId: 'invites',
      name: 'Attendees',
      position: 'a0',
      query: { filter: null, sort: [] },
      layout: { kind: 'table', columns: [] },
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:02:00Z',
    });
    expect(transport.applyDatabaseOps).toHaveBeenNthCalledWith(1, 'db', [
      {
        kind: 'view',
        table: 'invites',
        view: 'first',
        change: { kind: 'update', name: 'Guests' },
      },
    ]);
    expect(transport.applyDatabaseOps).toHaveBeenNthCalledWith(2, 'db', [
      {
        kind: 'view',
        table: 'invites',
        view: 'first',
        change: { kind: 'update', name: 'Attendees' },
      },
    ]);
  });
});

it('removes the sort before a following card move even while the optimistic cache patch waits', async () => {
  const view = detail.tables[0].views[0];
  queryClient.setQueryData(databasesKeys.detail('db').queryKey, detail);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cancel = vi
    .spyOn(queryClient, 'cancelQueries')
    .mockImplementationOnce(() => waiting);
  transport.applyDatabaseOps
    .mockReturnValueOnce(
      okAsync([
        {
          kind: 'view',
          table: 'invites',
          view: view.id,
          tableVersion: 4,
          change: { kind: 'updated', view },
        },
      ])
    )
    .mockReturnValueOnce(
      okAsync([
        {
          kind: 'view',
          table: 'invites',
          view: view.id,
          tableVersion: 5,
          change: { kind: 'card_moved', positions: [] },
        },
      ])
    );
  const updated = updateDatabaseView(view, {
    query: { filter: null, sort: [] },
  });
  const moved = moveDatabaseCard(view, {
    row: 'row',
    lane: { kind: 'none' },
    before: null,
    after: null,
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(transport.applyDatabaseOps).not.toHaveBeenCalled();
  release();
  expect((await updated).isOk()).toBe(true);
  expect((await moved).isOk()).toBe(true);
  expect(
    transport.applyDatabaseOps.mock.calls.map((call) => call[1][0].change.kind)
  ).toEqual(['update', 'move_card']);
  cancel.mockRestore();
});
