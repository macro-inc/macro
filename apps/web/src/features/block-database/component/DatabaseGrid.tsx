import { toast } from '@core/component/Toast/Toast';
import PlusIcon from '@phosphor/plus.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import {
  execSql,
  invalidateDatabase,
  invalidateDatabaseRows,
} from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type {
  DatabaseTableDetail,
  ExecOutcome,
  SqlValue,
} from '@service-storage/databases';
import { useQuery } from '@tanstack/solid-query';
import { cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';
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

export function DatabaseGrid(props: DatabaseGridProps) {
  const rowsQuery = useQuery(() => ({
    queryKey: databasesKeys.rows(props.databaseId, props.table.table.id)
      .queryKey,
    queryFn: async (): Promise<ExecOutcome> =>
      await execSql({ sql: selectAllStatement(props.table.sql_name) }),
  }));

  const result = () => rowsQuery.data?.results[0];

  /**
   * Result columns paired with their schema column. `row_id` has no schema
   * column — it is the row's identity, not a property — so it is filtered out
   * of the rendered set and kept only as an index.
   */
  const columns = createMemo(() => {
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

  const rows = () => result()?.rows ?? [];

  const templateColumns = () =>
    [
      ...columns().map(() => 'minmax(9rem, 1fr)'),
      props.canEdit ? ACTIONS_COLUMN : undefined,
    ]
      .filter(Boolean)
      .join(' ');

  /**
   * Run a write against this table, guarded by the table version we rendered
   * from. A conflict means someone else wrote first; the rendered rows are
   * stale either way, so refetching is the whole recovery.
   */
  const runWrite = async (sql: string) => {
    try {
      await execSql({
        sql,
        baseVersions: { [props.table.table.id]: props.table.table.version },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('409')) {
        toast.failure('Someone else changed this table — reloading');
      } else {
        toast.failure(message);
      }
    }
    await Promise.all([
      invalidateDatabaseRows(props.databaseId, props.table.table.id),
      invalidateDatabase(props.databaseId),
    ]);
  };

  const writeCell = (columnSqlName: string, rowId: string, value: SqlValue) =>
    runWrite(
      updateCellStatement({
        tableSqlName: props.table.sql_name,
        columnSqlName,
        rowId,
        value,
      })
    );

  const addRow = () => runWrite(insertEmptyRowStatement(props.table.sql_name));

  const deleteRow = (rowId: string) =>
    runWrite(deleteRowStatement({ tableSqlName: props.table.sql_name, rowId }));

  const rowIdOf = (row: SqlValue[]): string | undefined => {
    const index = rowIdIndex();
    if (index < 0) return undefined;
    const value = row[index];
    return typeof value === 'string' ? value : undefined;
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
        <div class="min-w-fit">
          {/* Header */}
          <div
            class="sticky top-0 z-1 grid border-edge border-b bg-canvas-base"
            style={{ 'grid-template-columns': templateColumns() }}
          >
            <For each={columns()}>
              {(column) => (
                <div class="truncate px-2 py-1.5 font-medium text-ink-muted text-xs">
                  {column.detail?.definition.definition.display_name ??
                    column.name}
                </div>
              )}
            </For>
            <Show when={props.canEdit}>
              <div class="grid place-items-center">
                <AddColumnMenu
                  databaseId={props.databaseId}
                  tableId={props.table.table.id}
                />
              </div>
            </Show>
          </div>

          {/* Rows */}
          <For each={rows()}>
            {(row) => {
              const rowId = rowIdOf(row);
              return (
                <div
                  class="group grid items-center border-edge/60 border-b hover:bg-hover/40"
                  style={{ 'grid-template-columns': templateColumns() }}
                >
                  <For each={columns()}>
                    {(column) => (
                      <div class="min-w-0 px-0.5 py-0.5">
                        <Show
                          when={column.detail && rowId}
                          fallback={
                            <div class="truncate px-2 py-1 text-ink-muted text-xs">
                              {row[column.index] === null
                                ? ''
                                : String(row[column.index])}
                            </div>
                          }
                        >
                          <GridCell
                            column={column.detail!}
                            rowId={rowId!}
                            value={row[column.index] ?? null}
                            canEdit={
                              props.canEdit &&
                              (column.detail?.writable ?? false)
                            }
                            onWrite={(value) =>
                              writeCell(column.detail!.sql_name, rowId!, value)
                            }
                          />
                        </Show>
                      </div>
                    )}
                  </For>
                  <Show when={props.canEdit}>
                    <div class="grid place-items-center">
                      <Show when={rowId}>
                        {(id) => (
                          <button
                            type="button"
                            class="rounded-sm p-1 text-ink-extra-muted opacity-0 hover:bg-hover hover:text-failure-ink group-hover:opacity-100 focus:opacity-100"
                            title="Remove row"
                            onClick={() => deleteRow(id())}
                          >
                            <TrashIcon class="size-3" />
                          </button>
                        )}
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>

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
    </div>
  );
}
