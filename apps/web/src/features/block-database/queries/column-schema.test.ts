import { okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateDatabaseColumns } from './column-schema';

const storage = vi.hoisted(() => ({ applyDatabaseOps: vi.fn() }));
vi.mock('@queries/storage/databases', () => storage);
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('column schema changes', () => {
  it('sends a type change, with nothing but its type, against the table version it was made at', async () => {
    storage.applyDatabaseOps.mockReturnValue(
      okAsync([
        {
          kind: 'column',
          table: 'tasks',
          column: 'price',
          tableVersion: 5,
          change: { kind: 'type_changed' },
        },
      ])
    );

    const changed = await updateDatabaseColumns({
      databaseId: 'db',
      tableId: 'tasks',
      baseVersion: 4,
      mutation: {
        kind: 'type',
        columnId: 'price',
        change: { to: { type: 'number' }, baseVersion: 4 },
      },
    });

    expect(changed.isOk()).toBe(true);
    expect(storage.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith(
      'db',
      [
        {
          kind: 'column',
          table: 'tasks',
          column: 'price',
          change: { kind: 'change_type', to: { type: 'number' } },
        },
      ],
      { tasks: 4 }
    );
    const [[, [op]]] = storage.applyDatabaseOps.mock.calls;
    expect(op).not.toHaveProperty('clearInvalid');
  });

  it('names this database as a relation target', async () => {
    storage.applyDatabaseOps.mockReturnValue(
      okAsync([
        {
          kind: 'column',
          table: 'tasks',
          column: 'owner',
          tableVersion: 5,
          change: { kind: 'type_changed' },
        },
      ])
    );

    await updateDatabaseColumns({
      databaseId: 'db',
      tableId: 'tasks',
      baseVersion: 4,
      mutation: {
        kind: 'type',
        columnId: 'owner',
        change: { to: { type: 'relation', table: 'people' } },
      },
    });

    expect(storage.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith(
      'db',
      [
        {
          kind: 'column',
          table: 'tasks',
          column: 'owner',
          change: {
            kind: 'change_type',
            to: { type: 'relation', database: 'db', table: 'people' },
          },
        },
      ],
      { tasks: 4 }
    );
  });

  it('deletes a column against the table version', async () => {
    storage.applyDatabaseOps.mockReturnValue(
      okAsync([
        {
          kind: 'column',
          table: 'tasks',
          column: 'notes',
          tableVersion: 8,
          change: { kind: 'deleted' },
        },
      ])
    );

    await updateDatabaseColumns({
      databaseId: 'db',
      tableId: 'tasks',
      baseVersion: 7,
      mutation: { kind: 'delete', columnId: 'notes' },
    });

    expect(storage.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith(
      'db',
      [
        {
          kind: 'column',
          table: 'tasks',
          column: 'notes',
          change: { kind: 'delete' },
        },
      ],
      { tasks: 7 }
    );
  });

  it('reorders columns against the table version', async () => {
    storage.applyDatabaseOps.mockReturnValue(
      okAsync([
        {
          kind: 'table',
          table: 'tasks',
          tableVersion: 9,
          change: { kind: 'columns_reordered' },
        },
      ])
    );

    await updateDatabaseColumns({
      databaseId: 'db',
      tableId: 'tasks',
      baseVersion: 8,
      mutation: { kind: 'order', columnIds: ['title', 'status'] },
    });

    expect(storage.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith(
      'db',
      [
        {
          kind: 'table',
          table: 'tasks',
          change: { kind: 'reorder_columns', order: ['title', 'status'] },
        },
      ],
      { tasks: 8 }
    );
  });
});
