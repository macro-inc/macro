import { toast } from '@core/component/Toast/Toast';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import {
  applyDatabaseTableVersions,
  ExecError,
  execSql,
  invalidateDatabaseRows,
} from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type {
  DatabaseColumnDetail,
  DatabaseTableDetail,
  ExecOutcome,
  SqlValue,
} from '@service-storage/databases';
import { Key } from '@solid-primitives/keyed';
import { useQuery } from '@tanstack/solid-query';
import { cn, Tooltip } from '@ui';
import { createMemo, For, Show, Suspense } from 'solid-js';
import {
  deleteRowStatement,
  insertEmptyRowStatement,
  ROW_ID_COLUMN,
  selectAllStatement,
  updateCellStatement,
} from '../sql';
import { AddColumnMenu } from './AddColumnMenu';
import { GridCell } from './GridCell';

type DatabaseGridProps = {
  databaseId: string;
  table: DatabaseTableDetail;
  canEdit: boolean;
};

/** Width of the trailing row-actions track. */
const ACTIONS_COLUMN = '2.25rem';

/** One rendered column: where it sits in the result, and what it is. */
type GridColumn = {
  index: number;
  name: string;
  detail: DatabaseColumnDetail | undefined;
};

/** One rendered row, identified so refetches reuse the same DOM. */
type GridRow = {
  rowId: string;
  cells: SqlValue[];
};

export function DatabaseGrid(props: DatabaseGridProps) {
  const rowsQuery = useQuery(() => ({
    queryKey: databasesKeys.rows(props.databaseId, props.table.table.id)
      .queryKey,
    queryFn: async (): Promise<ExecOutcome> =>
      await execSql({ sql: selectAllStatement(props.table.sql_name) }),
  }));

  const outcome = () => rowsQuery.data;
  const result = () => outcome()?.results[0];

  /**
   * Result columns paired with their schema column. `row_id` has no schema
   * column — it is the row's identity, not a property — so it is filtered out
   * of the rendered set and kept only as an index.
   */
  const columns = createMemo<GridColumn[]>(() => {
    const resultColumns = result()?.columns ?? [];
    return resultColumns
      .map((resultColumn, index) => ({
        index,
        name: resultColumn.name,
        detail: props.table.columns.find(
          (column) => column.sql_name === resultColumn.name
        ),
      }))
      .filter((column) => column.name !== ROW_ID_COLUMN);
  });

  const rowIdIndex = () =>
    (result()?.columns ?? []).findIndex(
      (column) => column.name === ROW_ID_COLUMN
    );

  /**
   * Rows keyed by their server id.
   *
   * `exec` hands back fresh `SqlValue[]` arrays on every refetch; keying on
   * `rowId` is what lets `<Key>` keep an unchanged row's cells mounted, so a
   * refetch triggered by one cell's write does not yank focus out of another.
   */
  const rows = createMemo<GridRow[]>(() => {
    const index = rowIdIndex();
    if (index < 0) return [];
    return (result()?.rows ?? []).flatMap((cells) => {
      const rowId = cells[index];
      return typeof rowId === 'string' ? [{ rowId, cells }] : [];
    });
  });

  const templateColumns = () =>
    [
      ...columns().map(() => 'minmax(9rem, 1fr)'),
      props.canEdit ? ACTIONS_COLUMN : undefined,
    ]
      .filter(Boolean)
      .join(' ');

  /**
   * Run a write against this table, guarded by the version the rendered rows
   * were read at.
   *
   * The base version comes from the rows response, not from the schema query:
   * a compare-and-swap is only meaningful against the same read the user is
   * looking at. On success the reported versions are folded into the cached
   * schema, so the only refetch a write costs is this table's rows.
   */
  const runWrite = async (buildSql: () => string, retryLabel?: string) => {
    const baseVersion = outcome()?.read_versions[props.table.table.id];

    try {
      const written = await execSql({
        // Built inside the `try`: the builders reject values that have no SQL
        // spelling (an infinite number, an empty identifier).
        sql: buildSql(),
        baseVersions:
          baseVersion === undefined
            ? undefined
            : { [props.table.table.id]: baseVersion },
      });
      applyDatabaseTableVersions(props.databaseId, written.new_versions);
      await invalidateDatabaseRows(props.databaseId, props.table.table.id);
      return;
    } catch (error) {
      if (error instanceof ExecError && error.code === 'VERSION_CONFLICT') {
        // Only a conflict means the rendered rows are stale. Refetching is the
        // recovery; the user's own edit is then the one thing still lost, so
        // offer to replay it against the rows that come back.
        await invalidateDatabaseRows(props.databaseId, props.table.table.id);
        toast.failure('Someone else changed this table first', {
          subtext: retryLabel
            ? `Your change to ${retryLabel} was not saved.`
            : 'Your change was not saved.',
          actions: [{ label: 'Retry', onClick: () => void runWrite(buildSql) }],
        });
        return;
      }

      toast.failure('That change could not be saved', {
        // SQLite's message is exact but unreadable — keep it as the secondary
        // line rather than as the whole toast.
        subtext: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const writeCell = (
    column: DatabaseColumnDetail,
    rowId: string,
    value: SqlValue
  ) =>
    runWrite(
      () =>
        updateCellStatement({
          tableSqlName: props.table.sql_name,
          columnSqlName: column.sql_name,
          rowId,
          value,
        }),
      column.definition.definition.display_name
    );

  const addRow = () =>
    runWrite(() => insertEmptyRowStatement(props.table.sql_name));

  const deleteRow = (rowId: string) =>
    runWrite(() =>
      deleteRowStatement({ tableSqlName: props.table.sql_name, rowId })
    );

  /**
   * Arrow-key movement between cells.
   *
   * Cells carry their coordinates as data attributes, so a move is a lookup
   * rather than a list of refs to keep in sync with the rendered rows.
   */
  const moveFocus = (event: KeyboardEvent) => {
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = deltas[event.key];
    if (!delta) return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    // Let a focused editor keep its own arrow keys (caret movement, menus).
    if (target.closest('input, textarea, [contenteditable="true"]')) return;

    const cell = target.closest<HTMLElement>('[data-grid-cell]');
    const grid = cell?.closest<HTMLElement>('[data-grid]');
    if (!cell || !grid) return;

    const row = Number(cell.dataset.gridRow);
    const column = Number(cell.dataset.gridColumn);
    const next = grid.querySelector<HTMLElement>(
      `[data-grid-row="${row + delta[0]}"][data-grid-column="${column + delta[1]}"]`
    );
    if (!next) return;

    event.preventDefault();
    (next.querySelector<HTMLElement>('button, [tabindex]') ?? next).focus();
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-auto">
      <Show
        when={!rowsQuery.isError}
        fallback={
          <div class="p-4 text-failure-ink text-xs">
            {rowsQuery.error instanceof Error
              ? rowsQuery.error.message
              : 'Could not read this table.'}
          </div>
        }
      >
        {/*
          The grid keeps its own boundary: reading rows suspends, and without
          this the tab strip above would vanish along with the rows every time
          the user switches tables.
        */}
        <Suspense fallback={<GridSkeleton />}>
          <Show when={!rowsQuery.isPending} fallback={<GridSkeleton />}>
            <div
              class="min-w-fit"
              role="grid"
              data-grid
              aria-label={props.table.table.name}
              aria-colcount={columns().length}
              aria-rowcount={rows().length + 1}
              onKeyDown={moveFocus}
            >
              {/* Header */}
              <div
                class="sticky top-0 z-1 grid border-edge border-b bg-canvas-base"
                style={{ 'grid-template-columns': templateColumns() }}
                role="row"
                aria-rowindex={1}
              >
                <For each={columns()}>
                  {(column, columnIndex) => (
                    <div
                      class="truncate px-2 py-1.5 font-medium text-ink-muted text-xs"
                      role="columnheader"
                      aria-colindex={columnIndex() + 1}
                    >
                      {column.detail?.definition.definition.display_name ??
                        column.name}
                    </div>
                  )}
                </For>
                <Show when={props.canEdit}>
                  <div class="grid place-items-center" role="columnheader">
                    <AddColumnMenu
                      databaseId={props.databaseId}
                      tableId={props.table.table.id}
                      columns={props.table.columns}
                    />
                  </div>
                </Show>
              </div>

              {/* Rows */}
              <Key each={rows()} by="rowId">
                {(row, rowIndex) => (
                  <div
                    class="group grid items-center border-edge/60 border-b hover:bg-hover/40"
                    style={{ 'grid-template-columns': templateColumns() }}
                    role="row"
                    aria-rowindex={rowIndex() + 2}
                  >
                    <For each={columns()}>
                      {(column, columnIndex) => (
                        <div
                          class="min-w-0 px-0.5 py-0.5"
                          role="gridcell"
                          aria-colindex={columnIndex() + 1}
                          data-grid-cell
                          data-grid-row={rowIndex()}
                          data-grid-column={columnIndex()}
                        >
                          <Show
                            when={column.detail}
                            fallback={
                              <div class="truncate px-2 py-1 text-ink-muted text-xs">
                                {row().cells[column.index] === null
                                  ? ''
                                  : String(row().cells[column.index])}
                              </div>
                            }
                          >
                            {(detail) => (
                              <GridCell
                                column={detail()}
                                rowId={row().rowId}
                                value={row().cells[column.index] ?? null}
                                canEdit={props.canEdit && detail().writable}
                                onWrite={(value) =>
                                  writeCell(detail(), row().rowId, value)
                                }
                              />
                            )}
                          </Show>
                        </div>
                      )}
                    </For>
                    <Show when={props.canEdit}>
                      <div
                        class="grid place-items-center"
                        role="gridcell"
                        aria-colindex={columns().length + 1}
                        data-grid-cell
                        data-grid-row={rowIndex()}
                        data-grid-column={columns().length}
                      >
                        <Tooltip label="Remove row">
                          <button
                            type="button"
                            class="rounded-sm p-1 text-ink-extra-muted opacity-0 hover:bg-hover hover:text-failure-ink group-hover:opacity-100 focus:opacity-100"
                            aria-label="Remove row"
                            onClick={() => deleteRow(row().rowId)}
                          >
                            <TrashIcon class="size-3" />
                          </button>
                        </Tooltip>
                      </div>
                    </Show>
                  </div>
                )}
              </Key>

              <Show when={rows().length === 0}>
                <div class="px-2 py-2 text-ink-extra-muted text-xs">
                  No rows yet.
                </div>
              </Show>

              <Show when={props.canEdit}>
                <button
                  type="button"
                  class={cn(
                    'flex w-full items-center gap-1.5 px-2 py-1.5 text-ink-extra-muted text-xs',
                    'hover:bg-hover hover:text-ink'
                  )}
                  onClick={addRow}
                >
                  <PlusIcon class="size-3" />
                  New row
                </button>
              </Show>
            </div>
          </Show>
        </Suspense>
      </Show>
    </div>
  );
}

/** Placeholder rows, so loading never reads as "this table is empty". */
function GridSkeleton() {
  return (
    <div class="flex flex-col gap-1.5 p-2" aria-busy="true">
      <For each={[0, 1, 2, 3, 4]}>
        {() => <div class="h-6 animate-pulse rounded-sm bg-hover" />}
      </For>
    </div>
  );
}
