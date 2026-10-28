import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { okAsync } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import { vi } from 'vitest';
import type {
  DatabaseRowsSnapshot,
  DatabaseRowsSource,
} from '../context/table-source';
import type { DatabaseViewColumn } from '../core/database-view';
import { type DatabaseRow, optimisticRows } from '../core/table';

/** What the fake table holds, before the view's statement narrows it. */
export type FakeStoredTable = Omit<DatabaseRowsSnapshot, 'retained'>;

/**
 * A rows source over an in-memory table. The engine's answer is every row in
 * order until `setAnswer` narrows it; writes succeed without changing the
 * table until `persistWrites` makes them apply.
 */
export function createFakeRowsSource(initial: {
  columns: DatabaseViewColumn[];
  table: FakeStoredTable;
  /** The view the engine reports it ran. */
  view: DatabaseView;
}) {
  const [columns, setColumns] = createSignal(initial.columns);
  const [table, setTable] = createSignal<FakeStoredTable>(initial.table);
  const [answer, setAnswer] = createSignal<
    (rows: DatabaseRow[]) => DatabaseRow[]
  >((rows) => rows);
  const [retainedIds, setRetainedIds] = createSignal<
    Accessor<readonly string[]>
  >(() => []);
  const source: DatabaseRowsSource = {
    columns,
    snapshot: () => ({
      version: table().version,
      rows: answer()(table().rows),
      retained: table().rows.filter((row) =>
        retainedIds()().includes(row.rowId)
      ),
    }),
    read: () => {
      const answered = answer()(table().rows);
      return {
        catalog: { tables: [] },
        view: initial.view,
        outcome: {
          columns: columns().map((column) => ({
            name: column.name,
            column: column.id,
            kind: 'select' as const,
          })),
          rows: answered.map((row) =>
            columns().map((column) => ({
              type: 'options' as const,
              value: column.options
                .filter((option) => option.label === row.cells[column.id])
                .map((option) => option.id),
            }))
          ),
          rowIds: answered.map((row) => row.rowId),
          readTables: [],
          truncated: false,
          insertedRowIds: [],
          changesApplied: 0,
        },
      };
    },
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    refresh: vi.fn<DatabaseRowsSource['refresh']>(() => okAsync(undefined)),
    write: vi.fn<DatabaseRowsSource['write']>(() =>
      okAsync({ version: 2, insertedRowIds: [] })
    ),
    addOption: vi.fn<DatabaseRowsSource['addOption']>(() => okAsync(undefined)),
    retain: (rowIds) => setRetainedIds(() => rowIds),
  };
  /** Writes change the table: creates add `created`, `created-2`, …; the version counts up. */
  function persistWrites() {
    let createdCount = 0;
    vi.mocked(source.write).mockImplementation((mutation) => {
      const snapshot = table();
      const version = (snapshot.version ?? 0) + 1;
      const insertedRowIds =
        mutation.kind === 'create'
          ? [++createdCount === 1 ? 'created' : `created-${createdCount}`]
          : [];
      const rows =
        mutation.kind === 'create'
          ? [
              ...snapshot.rows,
              { rowId: insertedRowIds[0], cells: mutation.values },
            ]
          : optimisticRows(snapshot.rows, [mutation]);
      setTable({ version, rows });
      return okAsync({ version, insertedRowIds });
    });
  }
  return { source, table, setTable, setColumns, setAnswer, persistWrites };
}

/** A title search the way the engine answers it: case-insensitive contains. */
export function titleContains(term: string) {
  return (rows: DatabaseRow[]) =>
    rows.filter((row) =>
      String(row.cells.title ?? '')
        .toLowerCase()
        .includes(term)
    );
}
