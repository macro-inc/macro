import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { refreshInBackground } from '@queries/database-sql/create-database-sql-query';
import {
  applyDatabaseOps,
  applyDatabaseTableVersions,
  onDatabaseBatchCommitted,
  onDatabaseTableAdvanced,
  useDatabaseDetailQuery,
} from '@queries/storage/databases';
import {
  useDatabaseAwareness,
  useDatabaseTableChanges,
} from '@queries/storage/databases-sync';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { ResultAsync } from 'neverthrow';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { DatabaseRelationCell } from '../components/database-relation-cell';
import type { DatabaseCellFocus } from '../components/database-table';
import {
  type OptionEditing,
  OptionEditingContext,
} from '../context/option-editing';
import type { DatabaseRelationSource } from '../context/relation-source';
import type { DatabaseRowsSource } from '../context/table-source';
import type { DatabaseEntityType } from '../core/column-inference';
import { mergeDatabaseColumnOrder } from '../core/column-order';
import { convertedColumnName } from '../core/column-schema';
import type { DatabaseRelatedDestination } from '../core/database-relations';
import type { ViewChange } from '../core/view-state';
import {
  DatabaseMentionPicker,
  DatabaseMentionValue,
  DatabaseTextEditor,
  DatabaseTextValue,
} from '../database-mentions';
import type { BoardPositionsState } from '../primitives/board-layout';
import { createColumnCasts } from '../queries/column-casts';
import { opColumnKind } from '../queries/column-schema';
import {
  addDatabaseColumnOptions,
  convertDatabaseColumn,
} from '../queries/columns';
import { createDatabaseRelations } from '../queries/database-relations';
import { useRelatedDatabaseSync } from '../queries/database-relations-sync';
import { patchTable } from '../queries/detail-cache';
import { deleteDatabaseOption, updateDatabaseOption } from '../queries/options';
import { tableChangesOf } from '../queries/table-changes';
import { createDatabaseRowsSource, toViewColumn } from '../queries/table-rows';
import {
  moveDatabaseCard,
  refreshCardPositions,
  setCardPositions,
  useCardPositions,
} from '../queries/views';
import type { BoardPositions } from '../views/database-board-view';
import {
  type DatabaseRecordsActions,
  DatabaseRecordsView,
} from '../views/database-records-view';
import { AddColumnMenu, createDefaultColumn } from './AddColumnMenu';
import type {
  DatabaseMentionPickerProps,
  DatabaseTextEditorProps,
} from './GridCell';

export type DatabaseGridProps = {
  databaseId: string;
  table: TableDetail;
  canEdit: boolean;
  /** The view on screen: a stored one, or the table's own All records. */
  view: DatabaseView;
  stored: boolean;
  preparingView?: boolean;
  onViewChange?: (change: ViewChange) => void;
  onClearConstraints?: () => void;
  actionsRef?: (actions: DatabaseRecordsActions) => void;
  renderToolbar?: (actions: DatabaseRecordsActions) => JSX.Element;
  onOpenRelated?: (destination: DatabaseRelatedDestination) => void;
};

/** Production composition. A table switch owns a new query/controller lifetime. */
export function DatabaseGrid(props: DatabaseGridProps) {
  return (
    <Suspense
      fallback={<div class="p-6 text-xs text-ink-muted">Loading records…</div>}
    >
      <Show when={props.table.table.id} keyed>
        {(tableId) => <TableAdapter {...props} tableId={tableId} />}
      </Show>
    </Suspense>
  );
}

const renderTextEditor = (editor: DatabaseTextEditorProps) => (
  <DatabaseTextEditor {...editor} />
);
const renderTextValue = (value: string) => <DatabaseTextValue value={value} />;
const renderMentionPicker = (picker: DatabaseMentionPickerProps) => (
  <DatabaseMentionPicker {...picker} />
);
const renderMentionValue = (id: string, entityType: DatabaseEntityType) => (
  <DatabaseMentionValue id={id} entityType={entityType} />
);

/** A link column's target: the database and table its rows live in. */
type LinkTarget = { databaseId: string; tableId: string };

/** The source with each relation column carrying the related rows' names. */
function withRelationLabels(
  source: DatabaseRowsSource,
  relations: (tableId: string) => DatabaseRelationSource
): DatabaseRowsSource {
  const columns = createMemo(() =>
    source.columns().map((column) =>
      column.relation
        ? {
            ...column,
            relation: {
              ...column.relation,
              labels: Object.fromEntries(
                relations(column.relation.tableId)
                  .rows()
                  .map((row) => [row.id, row.name])
              ),
            },
          }
        : column
    )
  );
  return { ...source, columns };
}

/** Refreshes the related tables of one other database when it changes. */
function RelatedDatabaseSync(props: {
  databaseId: string;
  targets: LinkTarget[];
  relations: (tableId: string) => DatabaseRelationSource;
}) {
  useRelatedDatabaseSync(props.databaseId, () => {
    for (const target of props.targets)
      if (target.databaseId === props.databaseId)
        refreshInBackground(props.relations(target.tableId));
  });
  return null;
}

function TableAdapter(props: DatabaseGridProps & { tableId: string }) {
  // Keep the final schema for this table available to already-queued writes
  // after its tab is closed; a new selected table must never redirect them.
  let ownedTable = props.table;
  const table = () => {
    if (props.table.table.id === props.tableId) ownedTable = props.table;
    return ownedTable;
  };
  const databaseId = props.databaseId;
  const detail = useDatabaseDetailQuery(() => databaseId);
  const linkTargets = (): LinkTarget[] =>
    table().columns.flatMap((column) =>
      column.column.config?.kind === 'link'
        ? [
            {
              databaseId: column.column.config.database_id,
              tableId: column.column.config.table_id,
            },
          ]
        : []
    );
  const relatedDatabases = () => [
    ...new Set(
      linkTargets()
        .map((target) => target.databaseId)
        .filter((id) => id !== databaseId)
    ),
  ];
  const relations = createDatabaseRelations({
    targets: linkTargets,
    onTableChanged: (listener) =>
      useDatabaseTableChanges((change) => listener(change.tableId)),
  });
  const source = withRelationLabels(
    createDatabaseRowsSource({
      databaseId,
      table,
      view: () => props.view,
      applyOps: (ops) => applyDatabaseOps(databaseId, ops),
      changes: (readRows) =>
        tableChangesOf({ databaseId, tableId: props.tableId, readRows }),
      onTableChanged: (listener) => {
        useDatabaseTableChanges((change) => {
          if (change.tableId !== props.tableId) return;
          listener(change.version);
          if (props.stored && props.view.layout.kind === 'board')
            void refreshCardPositions(databaseId, props.view.id);
        });
        // An undo or redo is read back as soon as it answers, ahead of its ping.
        onCleanup(
          onDatabaseTableAdvanced((change) => {
            if (
              change.databaseId === databaseId &&
              change.tableId === props.tableId
            )
              listener(change.version);
          })
        );
      },
      onCommitted: (listener) => {
        onCleanup(
          onDatabaseBatchCommitted((batch) => {
            const version = batch.tableVersions[props.tableId];
            if (batch.databaseId === databaseId && version !== undefined)
              listener(version);
          })
        );
      },
      applyVersions: (versions) =>
        applyDatabaseTableVersions(databaseId, versions),
      addOption: (columnId, label) =>
        addDatabaseColumnOptions({
          databaseId,
          tableId: props.tableId,
          columnId,
          labels: [label],
        }),
    }),
    relations
  );
  const boardViewId = () =>
    props.stored && props.view.layout.kind === 'board'
      ? props.view.id
      : undefined;
  const positions = useCardPositions(databaseId, boardViewId);
  const boardPositions: BoardPositions = {
    state: (): BoardPositionsState => {
      if (!props.stored) return { kind: 'ready', positions: [] };
      if (positions.isSuccess)
        return { kind: 'ready', positions: positions.data };
      if (positions.isError)
        return { kind: 'failed', retry: () => void positions.refetch() };
      return { kind: 'loading' };
    },
    setPositions: (change) => {
      const viewId = boardViewId();
      if (viewId) setCardPositions(databaseId, viewId, change);
    },
    move: (move) => moveDatabaseCard(props.view, move),
  };
  const optionEditing: OptionEditing = {
    update: (columnId, optionId, change) =>
      updateDatabaseOption(
        { databaseId, tableId: props.tableId, columnId, optionId },
        change
      ),
    remove: (columnId, optionId) =>
      deleteDatabaseOption({
        databaseId,
        tableId: props.tableId,
        columnId,
        optionId,
      }),
  };
  const [focusedCell, setFocusedCell] = createSignal<DatabaseCellFocus>();
  const awareness = useDatabaseAwareness(
    () => databaseId,
    () => ({ tableId: props.tableId, ...focusedCell() })
  );
  const remoteUsers = () =>
    awareness.remote().filter((user) => user.tableId === props.tableId);
  const relationTables = () =>
    detail.isSuccess
      ? detail.data.tables.map(({ table }) => ({
          id: table.id,
          name: table.name,
        }))
      : [];
  const columnCasts = createColumnCasts({
    databaseId,
    tableId: props.tableId,
    version: () => table().table.version,
  });
  return (
    <>
      <For each={relatedDatabases()}>
        {(id) => (
          <RelatedDatabaseSync
            databaseId={id}
            targets={linkTargets()}
            relations={relations}
          />
        )}
      </For>
      <StaticMarkdownContext>
        <OptionEditingContext.Provider
          value={props.canEdit ? optionEditing : undefined}
        >
          <DatabaseRecordsView
            name={table().table.name}
            source={source}
            canEdit={props.canEdit}
            view={props.view}
            stored={props.stored}
            preparingView={props.preparingView}
            onViewChange={props.onViewChange}
            onClearConstraints={props.onClearConstraints}
            boardPositions={boardPositions}
            onCellFocus={setFocusedCell}
            remoteUsers={remoteUsers()}
            renderTextEditor={renderTextEditor}
            renderTextValue={renderTextValue}
            renderMentionPicker={renderMentionPicker}
            renderMentionValue={renderMentionValue}
            renderRelationCell={(cell) => (
              <DatabaseRelationCell
                {...cell}
                source={relations(cell.column.relation.tableId)}
                onOpen={(rowId) =>
                  props.onOpenRelated?.({ ...cell.column.relation, rowId })
                }
              />
            )}
            relationTables={relationTables()}
            columnCasts={columnCasts}
            onChangeColumnType={(columnId, change) =>
              // Checked against the version the menu's dry run read, so a
              // change made since is not converted blind.
              applyDatabaseOps(
                databaseId,
                [
                  {
                    kind: 'column',
                    table: props.tableId,
                    column: columnId,
                    change: {
                      kind: 'change_type',
                      to: opColumnKind(databaseId, change.to),
                    },
                  },
                ],
                { [props.tableId]: change.baseVersion ?? table().table.version }
              ).map(() => undefined)
            }
            onConvertColumn={(columnId, conversion) =>
              convertDatabaseColumn({
                databaseId,
                tableId: props.tableId,
                columnId,
                to: conversion.to,
                name: convertedColumnName(
                  conversion.columnName,
                  conversion.label,
                  table().columns.map((column) => toViewColumn(column).name)
                ),
              })
            }
            onDeleteColumn={(columnId) => {
              const tableId = props.tableId;
              const version = table().table.version;
              return ResultAsync.fromSafePromise(
                patchTable(databaseId, tableId, (entry) => ({
                  ...entry,
                  columns: entry.columns.filter(
                    ({ column }) => column.id !== columnId
                  ),
                }))
              )
                .andThen((rollback) =>
                  applyDatabaseOps(
                    databaseId,
                    [
                      {
                        kind: 'column',
                        table: tableId,
                        column: columnId,
                        change: { kind: 'delete' },
                      },
                    ],
                    { [tableId]: version }
                  ).mapErr((error) => {
                    rollback();
                    return error;
                  })
                )
                .map(() => undefined);
            }}
            onReorderColumns={(columnIds) => {
              const tableId = props.tableId;
              const version = table().table.version;
              const order = mergeDatabaseColumnOrder(
                table().columns.map(({ column }) => column.id),
                columnIds
              );
              const rank = new Map(order.map((id, i) => [id, i]));
              return ResultAsync.fromSafePromise(
                patchTable(databaseId, tableId, (entry) => ({
                  ...entry,
                  columns: entry.columns.toSorted(
                    (a, b) =>
                      (rank.get(a.column.id) ?? Infinity) -
                      (rank.get(b.column.id) ?? Infinity)
                  ),
                }))
              )
                .andThen((rollback) =>
                  applyDatabaseOps(
                    databaseId,
                    [
                      {
                        kind: 'table',
                        table: tableId,
                        change: { kind: 'reorder_columns', order },
                      },
                    ],
                    { [tableId]: version }
                  ).mapErr((error) => {
                    rollback();
                    return error;
                  })
                )
                .map(() => undefined);
            }}
            onRenameColumn={(columnId, name, previousName) => {
              const tableId = props.tableId;
              return ResultAsync.fromSafePromise(
                patchTable(databaseId, tableId, (entry) => ({
                  ...entry,
                  columns: entry.columns.map((column) =>
                    column.column.id === columnId
                      ? {
                          ...column,
                          column: { ...column.column, display_name: name },
                        }
                      : column
                  ),
                }))
              )
                .andThen((rollback) =>
                  applyDatabaseOps(databaseId, [
                    {
                      kind: 'column',
                      table: tableId,
                      column: columnId,
                      change: { kind: 'rename', name, previousName },
                    },
                  ]).mapErr((error) => {
                    rollback();
                    return error;
                  })
                )
                .map(() => undefined);
            }}
            actionsRef={props.actionsRef}
            renderToolbar={props.renderToolbar}
            createColumn={() =>
              createDefaultColumn({
                databaseId,
                tableId: props.tableId,
                columns: table().columns,
              })
            }
            addColumn={(label, onCreated) => (
              <AddColumnMenu
                databaseId={databaseId}
                tableId={props.tableId}
                columns={table().columns}
                label={label}
                onCreated={onCreated}
              />
            )}
          />
        </OptionEditingContext.Provider>
      </StaticMarkdownContext>
    </>
  );
}
