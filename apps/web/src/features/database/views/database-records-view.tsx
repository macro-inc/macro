import { until } from '@solid-primitives/promise';
import { Button } from '@ui/components/Button';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import type { DatabaseBoardControls } from '../components/database-board';
import {
  DatabaseLoadFailure,
  TableSkeleton,
} from '../components/database-load-state';
import type {
  DatabaseCellFocus,
  DatabaseCellPresence,
  DatabaseTableControls,
} from '../components/database-table';
import {
  DraftFailureNotice,
  HiddenRecordNotice,
  RefreshNotice,
  SaveFailureNotice,
  SchemaErrorNotice,
} from '../components/database-table-notices';
import { filterConditionCount } from '../components/database-view-filters';
import { GridCell, type GridCellProps } from '../components/grid-cell';
import { RecordPanel } from '../components/record-panel';
import type { DatabaseRowsSource } from '../context/table-source';
import type { DatabaseColumnType } from '../core/column-inference';
import type {
  DatabaseColumnCastsSource,
  DatabaseColumnConversion,
  DatabaseColumnTypeChange,
  DatabaseSchemaChange,
} from '../core/column-schema';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../core/database-view';
import type { GridCellEditorOptions } from '../core/grid-cell-editor';
import {
  canEditCell,
  type DatabaseRow,
  rowTitle,
  rowValue,
  titleColumn,
} from '../core/table';
import type { DatabaseViewState, ViewChange } from '../core/view-state';
import {
  databaseReadMessage,
  databaseWriteMessage,
} from '../core/write-failure';
import { createColumnLayout } from '../primitives/column-layout';
import { createDraftRows } from '../primitives/draft-rows';
import { createHeldGridRows } from '../primitives/held-grid-rows';
import { createRecordActions } from '../primitives/record-actions';
import { createTableController } from '../primitives/table-controller';
import { type BoardPositions, DatabaseBoardView } from './database-board-view';
import { DatabaseTableView } from './database-table-view';

/** What the toolbar and the block can ask of the records on screen. */
export type DatabaseRecordsActions = {
  createRecord: () => Promise<boolean>;
  focusFirstCell: () => Promise<void>;
  focusColumn: (columnId: string) => boolean;
  openRecord: (rowId: string) => void;
  pending: Accessor<boolean>;
};

type RelationColumn = DatabaseViewColumn & {
  relation: NonNullable<DatabaseViewColumn['relation']>;
};

const isRelationColumn = (
  column: DatabaseViewColumn
): column is RelationColumn => column.relation !== undefined;

/** A relationship cell: the column always names the table its rows live in. */
export type RelationCellProps = GridCellEditorOptions & {
  column: RelationColumn;
  value: DatabaseCellValue;
  canEdit: boolean;
  onWrite: (value: DatabaseCellValue) => Promise<boolean>;
};

/** A table's records in the view's layout — a grid or a board — with the record panel over them. */
export type DatabaseRecordsViewProps = {
  /** Host framing for the records area, below the toolbar. */
  contentClass?: string;
  name: string;
  source: DatabaseRowsSource;
  canEdit: boolean;
  /** The view on screen: a stored one, or the table's own All records. */
  view: DatabaseViewState;
  /** Whether the view is stored, so changing it changes it for everyone. */
  preparingView?: boolean;
  stored: boolean;
  onViewChange?: (change: ViewChange) => void;
  /** Clear the view's filter. */
  onClearConstraints?: () => void;
  /** A board's card places. */
  boardPositions?: BoardPositions;
  renderTextEditor?: GridCellProps['renderTextEditor'];
  renderTextValue?: GridCellProps['renderTextValue'];
  renderMentionPicker?: GridCellProps['renderMentionPicker'];
  renderMentionValue?: GridCellProps['renderMentionValue'];
  renderRelationCell?: (props: RelationCellProps) => JSX.Element;
  relationTables?: { id: string; name: string }[];
  columnCasts?: DatabaseColumnCastsSource;
  onCellFocus?: (cell: DatabaseCellFocus | undefined) => void;
  remoteUsers?: DatabaseCellPresence[];
  onChangeColumnType?: (
    columnId: string,
    change: DatabaseColumnTypeChange
  ) => DatabaseSchemaChange;
  onConvertColumn?: (
    columnId: string,
    conversion: DatabaseColumnConversion
  ) => DatabaseSchemaChange<string>;
  onDeleteColumn?: (columnId: string) => DatabaseSchemaChange;
  onReorderColumns?: (columnIds: string[]) => DatabaseSchemaChange;
  onRenameColumn?: (
    columnId: string,
    name: string,
    previousName: string
  ) => DatabaseSchemaChange;
  /** Hands the host the records' actions once they exist. */
  actionsRef?: (actions: DatabaseRecordsActions) => void;
  renderToolbar?: (actions: DatabaseRecordsActions) => JSX.Element;
  /** Create a new column at the end of the table and return its id. */
  createColumn?: () => DatabaseSchemaChange<string>;
  addColumn?: (
    label?: string,
    onCreated?: (columnId: string) => boolean
  ) => JSX.Element;
};

export function DatabaseRecordsView(props: DatabaseRecordsViewProps) {
  const controller = createTableController(props.source, (mutation, result) =>
    records.recordSaved(mutation, result)
  );
  const draftRows = createDraftRows(controller);
  const columns = () => props.source.columns();
  const rows = controller.rows;
  const layoutKind = () => props.view.layout.kind;

  // Requests made while the grid is not mounted wait for it.
  let table: DatabaseTableControls | undefined;
  const waitingForTable: ((controls: DatabaseTableControls) => void)[] = [];
  function withTable(request: (controls: DatabaseTableControls) => void) {
    if (table) request(table);
    else waitingForTable.push(request);
  }
  function tableReady(controls: DatabaseTableControls) {
    table = controls;
    for (const request of waitingForTable.splice(0)) request(controls);
    // Called while the grid sets up, so this runs when that grid goes.
    onCleanup(() => {
      if (table === controls) table = undefined;
    });
  }
  const editCell = (rowId: string, columnId: string) =>
    withTable((controls) => controls.editCell(rowId, columnId));
  function focusColumn(columnId: string) {
    if (!props.canEdit || layoutKind() !== 'table') return false;
    withTable((controls) => controls.renameColumn(columnId));
    return true;
  }

  const columnLayout = createColumnLayout({
    view: () => props.view,
    columns,
    canEdit: () => props.canEdit,
    stored: () => props.stored,
    changeView: (change) => props.onViewChange?.(change),
    get saveColumnOrder() {
      return props.onReorderColumns;
    },
    get createColumn() {
      return props.createColumn;
    },
    renameColumn: (columnId) => void focusColumn(columnId),
  });
  const visibleColumns = columnLayout.visibleColumns;
  const filtered = () => filterConditionCount(props.view.query.filter) > 0;
  const records = createRecordActions({
    controller,
    draftRows,
    source: props.source,
    columns,
    visibleColumns,
    layout: layoutKind,
    canEdit: () => props.canEdit,
    constrained: filtered,
    editCell,
  });
  const gridRows = createHeldGridRows({
    rows: () =>
      props.canEdit && visibleColumns().some(canEditCell)
        ? draftRows.project(rows())
        : rows(),
    knownRows: controller.knownRows,
  });
  // Records being looked at or typed into stay readable when they leave the view.
  // Only saved rows: a draft's own id means nothing to the engine.
  props.source.retain(() =>
    [...records.heldRowIds(), gridRows.editingRowId(), ...draftRows.serverIds()]
      .map((rowId) =>
        rowId === undefined ? undefined : draftRows.savedRowId(rowId)
      )
      .filter((rowId): rowId is string => rowId !== undefined)
  );
  let boardControls: DatabaseBoardControls | undefined;
  const actions: DatabaseRecordsActions = {
    createRecord: async () =>
      layoutKind() === 'table'
        ? records.focusBlankRow()
        : boardControls?.addCard() || records.createRow({ open: true }),
    focusFirstCell: records.focusFirstCell,
    focusColumn,
    // A grid just mounted for a record from elsewhere has no rows to find it in yet.
    openRecord: (rowId) =>
      void until(() => props.source.snapshot()).then(() =>
        records.reveal(rowId)
      ),
    pending: controller.pending,
  };
  props.actionsRef?.(actions);

  async function writeCell(
    row: DatabaseRow,
    column: DatabaseViewColumn,
    value: DatabaseCellValue,
    option?: string,
    columnType?: DatabaseColumnType
  ) {
    if (!props.canEdit || !column.writable) return false;
    if (option === undefined && rowValue(row, column.id) === value) return true;
    const saved = await controller.save(
      {
        kind: 'cell',
        rowId: row.rowId,
        columnId: column.id,
        value,
        ...(columnType ? { columnTypes: { [column.id]: columnType } } : {}),
      },
      { label: column.name, option }
    );
    return saved.isOk();
  }
  /** A draft row's cells go to its draft; a saved row's to the table. */
  function writeValue(
    row: DatabaseRow,
    column: DatabaseViewColumn,
    value: DatabaseCellValue,
    option?: string,
    columnType?: DatabaseColumnType
  ) {
    return draftRows.has(row.rowId)
      ? draftRows.write(row.rowId, column.id, value, option, columnType)
      : writeCell(row, column, value, option, columnType);
  }
  function renderCell(
    row: Accessor<DatabaseRow>,
    column: Accessor<DatabaseViewColumn>,
    options?: GridCellEditorOptions
  ) {
    const write = (value: DatabaseCellValue) =>
      writeValue(row(), column(), value);
    const relationCell = () => {
      const render = props.renderRelationCell;
      const current = column();
      return render && isRelationColumn(current)
        ? { render, column: current }
        : undefined;
    };
    return (
      <Show
        when={relationCell()}
        fallback={
          <GridCell
            {...options}
            column={column()}
            emptyLabel={
              column().id === titleColumn(columns())?.id ? 'Unnamed' : undefined
            }
            value={rowValue(row(), column().id)}
            canEdit={props.canEdit}
            renderTextEditor={props.renderTextEditor}
            renderTextValue={props.renderTextValue}
            renderMentionPicker={props.renderMentionPicker}
            renderMentionValue={props.renderMentionValue}
            onMention={(mention) =>
              writeValue(row(), column(), mention.id, undefined, {
                dataType: 'ENTITY',
                entityType: mention.entityType,
              })
            }
            onWrite={write}
            onAddOption={(label, value) =>
              writeValue(row(), column(), value ?? label, label)
            }
          />
        }
      >
        {(cell) =>
          cell().render({
            ...options,
            get column() {
              return cell().column;
            },
            get value() {
              return rowValue(row(), column().id);
            },
            get canEdit() {
              return props.canEdit;
            },
            onWrite: write,
          })
        }
      </Show>
    );
  }
  const outcomeUnknown = () =>
    controller.failure()?.failure.kind === 'outcome-unknown';
  /** A failed change to this record, not to another row the panel does not show. */
  const recordSaveError = (rowId: string) => {
    const failed = controller.failure();
    return failed?.mutation.kind === 'cell' && failed.mutation.rowId === rowId
      ? `Your change to ${failed.label} was not saved.`
      : undefined;
  };
  const uncertainDraft = () => {
    const intent = controller.failure()?.createIntentId;
    return outcomeUnknown() && intent && draftRows.has(intent)
      ? intent
      : undefined;
  };
  const deleteColumn = () => {
    const remove = props.onDeleteColumn;
    return remove
      ? (columnId: string) =>
          remove(columnId).map(() => columnLayout.forgetColumn(columnId))
      : undefined;
  };
  const loadFailureMessage = () => {
    const failure = props.source.error();
    return failure ? databaseReadMessage(failure) : 'Try refreshing the table.';
  };

  return (
    <>
      {/* Rendered once: the toolbar's own props keep it current, and a rerun would close its open popovers. */}
      {untrack(() => props.renderToolbar?.(actions))}
      <div
        class={cn(
          'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          props.contentClass
        )}
      >
        <Show when={columnLayout.schemaError()}>
          {(message) => <SchemaErrorNotice message={message()} />}
        </Show>
        <Show when={controller.failure()}>
          {(failure) => (
            <SaveFailureNotice
              title={
                outcomeUnknown()
                  ? 'This row may already be saved.'
                  : `Could not save ${failure().label}.`
              }
              message={
                outcomeUnknown()
                  ? 'Check the latest rows against your draft, then discard the draft. Refreshing will not submit it again.'
                  : databaseWriteMessage(failure().failure)
              }
              actionLabel={outcomeUnknown() ? 'Refresh' : 'Retry'}
              pending={controller.pending()}
              onAction={() => void records.retry()}
              onDiscard={
                uncertainDraft() ? records.dismissSaveFailure : undefined
              }
              onDismiss={controller.dismissFailure}
            />
          )}
        </Show>
        <Show
          when={
            controller.refreshWarning() ||
            (props.source.error() && controller.snapshot())
          }
        >
          <RefreshNotice onRefresh={() => void controller.refresh()} />
        </Show>
        <Show when={records.hiddenRecord()}>
          {(row) => (
            <HiddenRecordNotice
              title={
                records.hiddenSavedRecord()?.created
                  ? records.hiddenSavedRecord()?.noEditableColumns
                    ? 'Record created'
                    : 'Record created outside this view'
                  : 'Record saved outside this view'
              }
              message={
                records.hiddenSavedRecord()?.noEditableColumns
                  ? 'This view has no editable columns. Open the record to see its details.'
                  : `“${rowTitle(row(), columns())}” doesn’t match your filters.`
              }
              onOpen={() => records.open(row().rowId)}
              onDismiss={records.dismissHiddenRecord}
            />
          )}
        </Show>
        <Show when={!controller.failure() ? draftRows.error() : undefined}>
          {(failure) => (
            <DraftFailureNotice
              message={
                draftRows.isUncertain(failure().id)
                  ? 'This row may already be saved. Check the latest rows, then discard this draft.'
                  : (failure().error ?? '')
              }
              actionLabel={
                draftRows.isUncertain(failure().id) ? 'Refresh' : 'Retry'
              }
              pending={controller.pending()}
              onAction={() =>
                void (draftRows.isUncertain(failure().id)
                  ? controller.refresh()
                  : records.retry())
              }
              onDiscard={
                draftRows.isUncertain(failure().id)
                  ? () => draftRows.discardUncertain(failure().id)
                  : undefined
              }
            />
          )}
        </Show>
        <Switch>
          <Match when={props.source.loading() || props.preparingView}>
            <TableSkeleton />
          </Match>
          <Match when={!controller.snapshot()}>
            <DatabaseLoadFailure
              title="This table could not be loaded"
              message={loadFailureMessage()}
              onRetry={() => void controller.refresh()}
            />
          </Match>
          <Match when={layoutKind() === 'board'}>
            <DatabaseBoardView
              view={props.view}
              source={props.source}
              rows={rows()}
              columns={columns()}
              positions={
                props.boardPositions ?? {
                  state: () => ({ kind: 'ready', positions: [] }),
                }
              }
              canEdit={props.canEdit}
              onViewChange={
                !props.stored || props.canEdit ? props.onViewChange : undefined
              }
              renderCell={renderCell}
              renderTextValue={props.renderTextValue}
              renderMentionValue={props.renderMentionValue}
              rowPending={controller.rowPending}
              createPending={controller.createPending}
              createComplete={controller.createComplete}
              onOpen={records.open}
              onCreate={records.createRow}
              controlsRef={(controls) => {
                boardControls = controls;
              }}
              onAddGroup={props.canEdit ? controller.addGroup : undefined}
            />
          </Match>
          <Match when={layoutKind() === 'table'}>
            <DatabaseTableView
              onClearCells={
                props.canEdit
                  ? async (rowIds, columnIds) => {
                      if (!props.canEdit) return false;
                      const savedRows = rowIds
                        .map(draftRows.savedRowId)
                        .filter((id): id is string => id !== undefined);
                      const writable = columnIds.filter((id) =>
                        columns().some(
                          (column) => column.id === id && canEditCell(column)
                        )
                      );
                      if (!savedRows.length || !writable.length) return true;
                      const result = await controller.save(
                        {
                          kind: 'clear',
                          rowIds: savedRows,
                          columnIds: writable,
                        },
                        { label: 'selected cells' }
                      );
                      return result.isOk();
                    }
                  : undefined
              }
              name={props.name}
              rows={gridRows.rows()}
              isUnsavedRow={draftRows.isUnsaved}
              onRowFocus={draftRows.setActive}
              onCellFocus={(cell) => {
                gridRows.setEditingRowId(
                  cell?.editing ? cell.rowId : undefined
                );
                // Others see a draft row's cell once it is saved.
                const rowId = cell && draftRows.savedRowId(cell.rowId);
                const endRowId = cell?.endRowId
                  ? draftRows.savedRowId(cell.endRowId)
                  : undefined;
                props.onCellFocus?.(
                  cell && rowId && (!cell.endRowId || endRowId)
                    ? { ...cell, rowId, endRowId }
                    : undefined
                );
              }}
              remoteUsers={props.remoteUsers}
              highlightRowId={records.highlightedRowId()}
              columns={columns()}
              columnOrder={columnLayout.columnOrder()}
              sort={props.view.query.sort ?? []}
              widths={columnLayout.widths()}
              onResizeColumn={
                props.onViewChange ? columnLayout.resizeColumn : undefined
              }
              canEdit={props.canEdit}
              pending={controller.pending()}
              addColumn={props.addColumn?.(
                columns().length ? undefined : 'Add first column',
                focusColumn
              )}
              renderCell={renderCell}
              controlsRef={tableReady}
              titleColumnId={titleColumn(columns())?.id}
              getRowTitle={(row) => rowTitle(row, columns())}
              onOpen={records.open}
              onDuplicate={records.duplicateRow}
              onRequestDelete={records.requestDelete}
              relationTables={props.relationTables}
              columnCasts={props.columnCasts}
              onChangeColumnType={props.onChangeColumnType}
              onConvertColumn={props.onConvertColumn}
              onDeleteColumn={deleteColumn()}
              onReorderColumn={columnLayout.reorderColumn}
              onRenameColumn={props.onRenameColumn}
              onSort={columnLayout.sort}
              onMove={props.onViewChange ? columnLayout.moveColumn : undefined}
              onInsertColumn={
                props.canEdit && props.createColumn
                  ? (columnId, side) =>
                      void columnLayout.insertColumn(columnId, side)
                  : undefined
              }
              emptyState={
                <Show
                  when={
                    rows().length === 0 &&
                    (filtered() || columns().length === 0)
                  }
                >
                  <div class="py-5 pr-4 pl-14">
                    <p class="max-w-80 text-sm text-ink-muted">
                      {filtered()
                        ? 'No records match this view.'
                        : 'Add a column to get started.'}
                    </p>
                    <Show when={filtered()}>
                      <Button
                        variant="ghost"
                        size="xs"
                        class="mt-2 text-accent"
                        onClick={() => props.onClearConstraints?.()}
                      >
                        Clear filters
                      </Button>
                    </Show>
                  </div>
                </Show>
              }
            />
          </Match>
        </Switch>
        <Show when={records.selected()}>
          {(row) => (
            <RecordPanel
              row={row()}
              tableName={props.name}
              columns={columns()}
              canEdit={props.canEdit}
              pending={controller.pending()}
              outsideViewReason={
                records.selectedPosition() < 0 && filtered()
                  ? `This record doesn’t match your filters. You can ${props.canEdit ? 'keep editing' : 'view'} it here.`
                  : undefined
              }
              saveError={recordSaveError(row().rowId)}
              onRetry={() => void records.retry()}
              position={records.selectedPosition()}
              total={rows().length}
              renderCell={renderCell}
              onClose={records.closeRecord}
              onNavigate={records.navigate}
              returnFocus={records.returnFocus()}
              onRequestDelete={() => records.requestDelete(row().rowId)}
            />
          )}
        </Show>
        <DeleteDialog
          open={!!records.deleteTarget()}
          onOpenChange={(open) => {
            if (!open) records.cancelDelete();
          }}
          title="Delete record?"
          pending={controller.pending()}
          onDelete={() => {
            const target = records.deleteTarget();
            if (target) void records.deleteRow(target.rowId);
          }}
          onCloseAutoFocus={(event) => {
            const target = records.deleteDialogReturnFocus();
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          body={
            <>
              <p class="break-words">
                “{records.deleteTarget()?.name}” will be deleted.
              </p>
              <Show when={records.deletionError()}>
                <p role="alert" class="mt-2 text-failure-ink">
                  {records.deletionError()}
                </p>
              </Show>
            </>
          }
        />
      </div>
    </>
  );
}
