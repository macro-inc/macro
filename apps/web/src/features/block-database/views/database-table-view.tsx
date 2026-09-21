import ArrowClockwiseIcon from '@phosphor/arrow-clockwise.svg';
import EyeSlashIcon from '@phosphor/eye-slash.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import XIcon from '@phosphor/x.svg';
import { until } from '@solid-primitives/promise';
import { Mutex } from 'async-mutex';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import {
  GridCell,
  type GridCellEditorOptions,
  type GridCellProps,
} from '../component/GridCell';
import {
  DatabaseBoard,
  type DatabaseCardPlacement,
} from '../components/database-board';
import { DatabaseTable } from '../components/database-table';
import type { PropertyCreatorVariant } from '../components/property-creator';
import { DeleteRecordDialog, RecordPanel } from '../components/record-panel';
import type {
  DatabaseRowsSource,
  DatabaseWriteResult,
} from '../context/table-source';
import type { DatabaseColumnType } from '../core/column-inference';
import {
  mergeDatabaseColumnOrder,
  reorderDatabaseColumns,
} from '../core/column-order';
import type { DatabaseColumnTypeChange } from '../core/column-schema';
import {
  applyDatabaseView,
  type DatabaseCellValue,
  type DatabaseViewColumn,
  type DatabaseViewConfig,
  groupDatabaseRows,
  isBoardGroupColumn,
  orderDatabaseCards,
  orderDatabaseColumns,
  placeDatabaseCard,
} from '../core/database-view';
import type { DatabasePropertyType } from '../core/property-creation';
import {
  canEditCell,
  type DatabaseRow,
  type DatabaseRowMutation,
  rowTitle,
  rowValue,
  titleColumn,
} from '../core/table';
import { createDraftRows } from '../primitives/draft-rows';
import { createTableController } from '../primitives/table-controller';

export type DatabaseTableActions = {
  createRecord: () => Promise<boolean>;
  focusFirstCell: () => Promise<void>;
  focusColumn: (columnId: string) => boolean;
  openRecord: (rowId: string) => void;
  pending: Accessor<boolean>;
};

type CardOrderState = Pick<DatabaseViewConfig, 'sorts' | 'cardOrder'>;

type CardPlacementBurst = {
  groupBy: string;
  pending: number;
  sequence: number;
  confirmedSequence: number;
  confirmed: CardOrderState;
  latest: CardOrderState;
};

export function DatabaseTableView(props: {
  name: string;
  source: DatabaseRowsSource;
  canEdit: boolean;
  view: DatabaseViewConfig;
  onViewChange?: (view: DatabaseViewConfig) => void;
  renderTextEditor?: GridCellProps['renderTextEditor'];
  renderTextValue?: GridCellProps['renderTextValue'];
  renderMentionPicker?: GridCellProps['renderMentionPicker'];
  renderMentionValue?: GridCellProps['renderMentionValue'];
  renderRelationCell?: (props: GridCellProps) => JSX.Element;
  relationTables?: { id: string; name: string }[];
  onChangeColumnType?: (
    columnId: string,
    change: DatabaseColumnTypeChange
  ) => Promise<void>;
  onDeleteColumn?: (columnId: string) => Promise<void>;
  onReorderColumns?: (columnIds: string[]) => Promise<void>;
  onRenameColumn?: (
    columnId: string,
    name: string,
    previousName: string
  ) => Promise<void>;
  renderToolbar?: (actions: DatabaseTableActions) => JSX.Element;
  addColumn: (
    label?: string,
    initialType?: DatabasePropertyType,
    variant?: PropertyCreatorVariant,
    onCreated?: (columnId: string) => boolean
  ) => JSX.Element;
}) {
  const controller = createTableController(props.source, recordSaved);
  const draftRows = createDraftRows(controller);
  const [editColumn, setEditColumn] = createSignal<string>();
  const [schemaError, setSchemaError] = createSignal('');
  const columnOrderMutex = new Mutex();
  let columnOrderSequence = 0;
  let pendingColumnOrders = 0;
  let confirmedColumnOrder: string[] = [];
  let cardPlacementBurst: CardPlacementBurst | undefined;
  const [selectedId, setSelectedId] = createSignal<string>();
  const [editCell, setEditCell] = createSignal<{
    rowId: string;
    columnId: string;
  }>();
  const [deleteTarget, setDeleteTarget] = createSignal<{
    rowId: string;
    name: string;
  }>();
  const deletionMutations = new Map<
    string,
    Extract<DatabaseRowMutation, { kind: 'delete' }>
  >();
  const duplicateIntents = new Map<string, string>();
  let duplicateSequence = 0;
  const deletionError = () => {
    const failed = controller.failure();
    return failed?.mutation.kind === 'delete' &&
      failed.mutation.rowId === deleteTarget()?.rowId
      ? 'Could not delete this record. Try again.'
      : undefined;
  };
  const [hiddenSavedRecord, setHiddenSavedRecord] = createSignal<{
    rowId: string;
    created: boolean;
    noEditableColumns?: boolean;
  }>();
  let returnFocus: HTMLElement | undefined;
  let disposed = false;
  let firstCellRequest: Promise<void> | undefined;
  let cancelFirstCellWait: (() => void) | undefined;
  onCleanup(() => {
    disposed = true;
    cancelFirstCellWait?.();
  });
  const columns = () => props.source.columns();
  const visibleColumns = () =>
    orderDatabaseColumns(columns(), props.view.columnOrder).filter(
      (column) => !props.view.hiddenColumns.includes(column.id)
    );
  const rows = createMemo(() =>
    applyDatabaseView(controller.rows(), columns(), props.view, rowValue)
  );
  const groupColumn = () =>
    columns().find(
      (column) => column.id === props.view.groupBy && isBoardGroupColumn(column)
    ) ?? columns().find(isBoardGroupColumn);
  const selected = () =>
    controller.rows().find((row) => row.rowId === selectedId());
  const selectedPosition = () =>
    rows().findIndex((row) => row.rowId === selectedId());
  const constrained = () =>
    props.view.search.trim() !== '' || props.view.filters.length > 0;
  const constraints = () =>
    props.view.search.trim()
      ? props.view.filters.length
        ? 'search and filters'
        : 'search'
      : 'filters';
  const hiddenRecord = () => {
    const saved = hiddenSavedRecord();
    return saved &&
      (saved.noEditableColumns ||
        !rows().some((row) => row.rowId === saved.rowId))
      ? controller.rows().find((row) => row.rowId === saved.rowId)
      : undefined;
  };
  function recordSaved(
    mutation: DatabaseRowMutation,
    result: DatabaseWriteResult
  ) {
    const rowId =
      mutation.kind === 'create' ? result.insertedRowIds[0] : mutation.rowId;
    if (!rowId) return;
    if (mutation.kind === 'delete') {
      deletionMutations.delete(rowId);
      if (deleteTarget()?.rowId === rowId) setDeleteTarget(undefined);
      if (selectedId() === rowId) setSelectedId(undefined);
    }
    if (mutation.kind === 'create') {
      for (const [rowId, intent] of duplicateIntents) {
        if (controller.createComplete(intent)) duplicateIntents.delete(rowId);
      }
    }
    if (
      mutation.kind !== 'delete' &&
      constrained() &&
      !rows().some((row) => row.rowId === rowId)
    ) {
      setHiddenSavedRecord({ rowId, created: mutation.kind === 'create' });
    } else if (hiddenSavedRecord()?.rowId === rowId) {
      setHiddenSavedRecord(undefined);
    }
  }

  const actualRowId = (rowId: string) =>
    draftRows.has(rowId) ? draftRows.serverId(rowId) : rowId;
  async function retry() {
    const failure = controller.failure();
    if (failure?.outcomeUnknown) {
      await controller.refresh();
      return;
    }
    const local = failure
      ? draftRows.retryTarget(failure)
      : draftRows.error()?.id;
    if (local) await draftRows.retry(local);
    else await controller.retry();
  }
  function dismissSaveFailure() {
    const failure = controller.failure();
    if (failure?.outcomeUnknown && failure.createIntentId)
      draftRows.discardUncertain(failure.createIntentId);
    controller.dismissFailure();
  }
  function focusBlankRow() {
    const field = visibleColumns().find(canEditCell);
    if (!props.canEdit || !field) return false;
    setEditCell({ rowId: draftRows.blankId(), columnId: field.id });
    return true;
  }
  function focusColumn(columnId: string) {
    if (!props.canEdit || props.view.layout !== 'table') return false;
    // A create response can arrive before the reactive schema mounts its header.
    // DatabaseTable keeps the request until that header registers itself.
    setEditColumn(undefined);
    setEditColumn(columnId);
    return true;
  }
  function open(rowId: string) {
    const actualId = actualRowId(rowId);
    if (!actualId) return;
    rowId = actualId;
    if (document.activeElement instanceof HTMLElement)
      returnFocus = document.activeElement;
    setSelectedId(rowId);
  }
  function editCreatedRow(rowId: string) {
    if (props.view.layout !== 'table') {
      open(rowId);
      return;
    }
    const title = titleColumn(columns());
    const editable = visibleColumns().filter(canEditCell);
    const field =
      editable.find((column) => column.id === title?.id) ?? editable[0];
    if (field && rows().some((row) => row.rowId === rowId))
      setEditCell({ rowId, columnId: field.id });
    else if (!field)
      setHiddenSavedRecord({ rowId, created: true, noEditableColumns: true });
  }
  async function duplicateRow(rowId: string) {
    const actualId = actualRowId(rowId);
    if (!props.canEdit || !actualId) return false;
    rowId = actualId;
    const row = controller.rows().find((row) => row.rowId === rowId);
    if (!row) return false;
    const intent =
      duplicateIntents.get(rowId) ??
      `duplicate:${rowId}:${++duplicateSequence}`;
    duplicateIntents.set(rowId, intent);
    const values = Object.fromEntries(
      columns()
        .filter((column) => column.writable)
        .map((column) => [column.id, rowValue(row, column.id)])
    );
    const result = await controller.save(
      { kind: 'create', values },
      'duplicate record',
      undefined,
      intent
    );
    const createdId = result?.insertedRowIds[0];
    if (createdId) editCreatedRow(createdId);
    return Boolean(result);
  }
  function requestDelete(rowId: string) {
    const actualId = actualRowId(rowId);
    if (!props.canEdit || controller.pending() || !actualId) return;
    rowId = actualId;
    const row = controller.rows().find((row) => row.rowId === rowId);
    if (!row) return;
    if (document.activeElement instanceof HTMLElement)
      returnFocus = document.activeElement;
    setDeleteTarget({ rowId, name: rowTitle(row, columns()) });
  }
  async function deleteRow(rowId: string) {
    if (!props.canEdit || controller.pending()) return false;
    const mutation =
      deletionMutations.get(rowId) ?? ({ kind: 'delete', rowId } as const);
    deletionMutations.set(rowId, mutation);
    return Boolean(await controller.save(mutation, 'delete record'));
  }
  function navigate(delta: number) {
    const row = rows()[selectedPosition() + delta];
    if (row) setSelectedId(row.rowId);
  }
  async function writeCell(
    row: DatabaseRow,
    column: DatabaseViewColumn,
    value: DatabaseCellValue,
    option?: string,
    columnType?: DatabaseColumnType
  ) {
    if (!props.canEdit || !column.writable) return false;
    if (option === undefined && rowValue(row, column.id) === value) return true;
    return Boolean(
      await controller.save(
        {
          kind: 'cell',
          rowId: row.rowId,
          columnId: column.id,
          value,
          ...(columnType ? { columnTypes: { [column.id]: columnType } } : {}),
        },
        column.name,
        option
      )
    );
  }
  function renderCell(
    row: Accessor<DatabaseRow>,
    column: Accessor<DatabaseViewColumn>,
    options?: GridCellEditorOptions
  ) {
    const write = (value: DatabaseCellValue) =>
      draftRows.has(row().rowId)
        ? draftRows.write(row().rowId, column().id, value)
        : writeCell(row(), column(), value);
    return (
      <Show
        when={column().relation && props.renderRelationCell}
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
            onMention={(mention) => {
              const type = {
                dataType: 'ENTITY',
                entityType: mention.entityType,
              } as const;
              return draftRows.has(row().rowId)
                ? draftRows.write(
                    row().rowId,
                    column().id,
                    mention.id,
                    undefined,
                    type
                  )
                : writeCell(row(), column(), mention.id, undefined, type);
            }}
            onWrite={write}
            onAddOption={(label, value) =>
              draftRows.has(row().rowId)
                ? draftRows.write(
                    row().rowId,
                    column().id,
                    value ?? label,
                    label
                  )
                : writeCell(row(), column(), value ?? label, label)
            }
          />
        }
      >
        {(render) =>
          render()({
            ...options,
            get column() {
              return column();
            },
            get value() {
              return rowValue(row(), column().id);
            },
            get canEdit() {
              return props.canEdit;
            },
            onWrite: write,
            onAddOption: async () => false,
          })
        }
      </Show>
    );
  }
  async function createRow(
    value?: DatabaseCellValue,
    title = '',
    openAfterCreate = true,
    createIntentId?: string
  ) {
    if (!props.canEdit) return false;
    const group = groupColumn();
    const titleField = titleColumn(columns());
    const values: Record<string, DatabaseCellValue> = {};
    if (value !== undefined && group?.writable)
      values[group.id] = group.isMultiSelect
        ? JSON.stringify(value === null ? [] : [value])
        : value;
    if (title && titleField?.writable) values[titleField.id] = title;
    const saved = await controller.save(
      { kind: 'create', values },
      'new record',
      undefined,
      createIntentId
    );
    const rowId = saved?.insertedRowIds[0];
    if (rowId && openAfterCreate) editCreatedRow(rowId);
    return Boolean(saved);
  }
  function focusFirstCell(): Promise<void> {
    if (firstCellRequest) return firstCellRequest;
    firstCellRequest = (async () => {
      if (props.source.loading()) {
        const ready = until(() => !props.source.loading());
        cancelFirstCellWait = ready.dispose;
        await ready.catch(() => undefined);
        cancelFirstCellWait = undefined;
      }
      if (
        disposed ||
        !props.canEdit ||
        props.source.error() ||
        !props.source.snapshot()
      )
        return;
      const field = visibleColumns().find(canEditCell);
      if (!field) return;
      const row =
        props.view.layout === 'table'
          ? draftRows.project(rows())[0]
          : rows()[0];
      if (row) {
        if (props.view.layout === 'table')
          setEditCell({ rowId: row.rowId, columnId: field.id });
        else open(row.rowId);
      } else if (props.view.layout === 'table') {
        focusBlankRow();
      }
    })().finally(() => {
      firstCellRequest = undefined;
    });
    return firstCellRequest;
  }
  function sort(columnId: string, direction: 'asc' | 'desc' | null) {
    props.onViewChange?.({
      ...props.view,
      sorts: direction
        ? [
            { columnId, direction },
            ...props.view.sorts.filter((sort) => sort.columnId !== columnId),
          ]
        : props.view.sorts.filter((sort) => sort.columnId !== columnId),
    });
  }
  function hideColumn(columnId: string) {
    if (props.view.hiddenColumns.includes(columnId)) return;
    props.onViewChange?.({
      ...props.view,
      hiddenColumns: [...props.view.hiddenColumns, columnId],
    });
  }
  async function placeCard(placement: DatabaseCardPlacement) {
    const column = groupColumn();
    const row = controller.rows().find((row) => row.rowId === placement.rowId);
    if (
      !column ||
      !row ||
      !props.canEdit ||
      !column.writable ||
      !props.onViewChange
    )
      return false;
    const previous = props.view;
    const groups = groupDatabaseRows(rows(), column, rowValue);
    const target = groups.find((group) => group.key === placement.toLane);
    if (!target) return false;
    const cardOrder = { ...previous.cardOrder };
    // Keep every other card where it was shown, including when switching from a sort.
    // Stored positions for filtered-out rows stay intact.
    for (const group of groups) {
      const visible = orderDatabaseCards(
        group.rows,
        previous.sorts.length ? undefined : previous.cardOrder?.[group.key],
        (row) => row.rowId
      ).map((row) => row.rowId);
      const existing = cardOrder[group.key] ?? [];
      cardOrder[group.key] = mergeDatabaseColumnOrder(
        [...new Set([...existing, ...visible])],
        visible
      );
    }
    const visibleTarget = orderDatabaseCards(
      target.rows,
      cardOrder[placement.toLane],
      (row) => row.rowId
    ).map((row) => row.rowId);
    if (placement.beforeId && !visibleTarget.includes(placement.beforeId))
      return false;
    cardOrder[placement.toLane] = placeDatabaseCard(
      cardOrder[placement.toLane] ?? [],
      visibleTarget,
      placement.rowId,
      placement.beforeId
    );
    const order: CardOrderState = { sorts: [], cardOrder };
    // One burst shares its last confirmed order. A later user sort/group change
    // starts a fresh baseline rather than inheriting an earlier pending move.
    const burst: CardPlacementBurst =
      cardPlacementBurst?.pending &&
      cardPlacementBurst.groupBy === column.id &&
      previous.groupBy === column.id &&
      previous.sorts.length === 0 &&
      previous.cardOrder === cardPlacementBurst.latest.cardOrder
        ? cardPlacementBurst
        : {
            groupBy: column.id,
            pending: 0,
            sequence: 0,
            confirmedSequence: 0,
            confirmed: {
              sorts: previous.sorts,
              cardOrder: previous.cardOrder,
            },
            latest: order,
          };
    const sequence = ++burst.sequence;
    burst.latest = order;
    cardPlacementBurst = burst;
    // Retain the source lane's stored position: membership hides it after a move,
    // and a rejected write can put the card back exactly where it started.
    props.onViewChange({ ...previous, groupBy: column.id, ...order });
    if (placement.fromLane === placement.toLane) {
      burst.confirmed = order;
      burst.confirmedSequence = sequence;
      return true;
    }
    burst.pending++;
    try {
      const saved = await controller.save(
        {
          kind: 'cell',
          rowId: placement.rowId,
          columnId: column.id,
          value: placement.value,
        },
        column.name
      );
      // An older response cannot replace a newer accepted same-lane placement.
      if (saved && sequence > burst.confirmedSequence) {
        burst.confirmed = order;
        burst.confirmedSequence = sequence;
      }
      if (
        !saved &&
        !disposed &&
        sequence === burst.sequence &&
        props.view.groupBy === column.id &&
        props.view.sorts.length === 0 &&
        props.view.cardOrder === cardOrder
      ) {
        props.onViewChange({ ...props.view, ...burst.confirmed });
      }
      return Boolean(saved);
    } finally {
      burst.pending--;
    }
  }

  async function reorderColumn(
    columnId: string,
    targetId: string,
    edge: 'before' | 'after'
  ) {
    const order = orderDatabaseColumns(columns(), props.view.columnOrder).map(
      (column) => column.id
    );
    const nextOrder = reorderDatabaseColumns(
      order,
      props.view.hiddenColumns,
      columnId,
      targetId,
      edge
    );
    if (!nextOrder) return;
    setSchemaError('');
    // Move immediately; a network round trip must not snap the header back.
    props.onViewChange?.({ ...props.view, columnOrder: nextOrder });
    const persist = props.canEdit ? props.onReorderColumns : undefined;
    if (!persist) return;
    const sequence = ++columnOrderSequence;
    if (pendingColumnOrders++ === 0) confirmedColumnOrder = order;
    try {
      // Each request reads the schema version refreshed by the previous write.
      // Queue complete orders so a later drop includes all optimistic moves.
      await columnOrderMutex.runExclusive(async () => {
        await persist(nextOrder);
        confirmedColumnOrder = nextOrder;
      });
      if (!disposed && sequence === columnOrderSequence) setSchemaError('');
    } catch (error) {
      if (disposed || sequence !== columnOrderSequence) return;
      const currentOrder = orderDatabaseColumns(
        columns(),
        props.view.columnOrder
      ).map((column) => column.id);
      // A view selection made during the write owns its own column layout.
      if (
        currentOrder.length === nextOrder.length &&
        currentOrder.every((id, index) => id === nextOrder[index])
      )
        props.onViewChange?.({
          ...props.view,
          columnOrder: confirmedColumnOrder,
        });
      setSchemaError(
        error instanceof Error ? error.message : 'Could not reorder columns.'
      );
    } finally {
      pendingColumnOrders--;
    }
  }
  function moveColumn(columnId: string, direction: 'left' | 'right') {
    const columns = visibleColumns();
    const target =
      columns[
        columns.findIndex((column) => column.id === columnId) +
          (direction === 'left' ? -1 : 1)
      ];
    if (target)
      void reorderColumn(
        columnId,
        target.id,
        direction === 'left' ? 'before' : 'after'
      );
  }
  function clearFilters() {
    props.onViewChange?.({ ...props.view, search: '', filters: [] });
  }

  return (
    <>
      {props.renderToolbar?.({
        createRecord: async () =>
          props.view.layout === 'table' ? focusBlankRow() : createRow(),
        focusFirstCell,
        focusColumn,
        openRecord: open,
        pending: controller.pending,
      })}
      <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <Show when={schemaError()}>
          <p
            role="alert"
            class="border-b border-edge-muted px-5 py-2 text-xs text-failure-ink"
          >
            {schemaError()}
          </p>
        </Show>
        <Show when={controller.failure()}>
          {(failure) => (
            <div
              role="alert"
              class="flex shrink-0 items-start gap-2 border-b border-warning/20 bg-warning/5 px-5 py-3 text-xs"
            >
              <WarningIcon class="mt-0.5 size-4 shrink-0 text-warning-ink" />
              <div class="min-w-0 flex-1">
                <p class="font-medium text-ink">
                  {failure().outcomeUnknown
                    ? 'This row may already be saved.'
                    : failure().conflict
                      ? 'This table changed before your edit was saved.'
                      : `Could not save ${failure().label}.`}
                </p>
                <p class="mt-1 text-ink-muted">
                  {failure().outcomeUnknown
                    ? 'Check the latest rows against your draft, then discard the draft. Refreshing will not submit it again.'
                    : failure().conflict
                      ? 'The latest values are loaded. Retry to apply your change.'
                      : failure().message}
                </p>
              </div>
              <button
                type="button"
                disabled={controller.pending()}
                class="shrink-0 rounded px-2 py-1 font-medium text-ink hover:bg-hover disabled:opacity-40"
                onClick={() => void retry()}
              >
                {failure().outcomeUnknown ? 'Refresh' : 'Retry'}
              </button>
              <Show
                when={
                  failure().outcomeUnknown &&
                  failure().createIntentId &&
                  draftRows.has(failure().createIntentId!)
                }
              >
                <button
                  type="button"
                  disabled={controller.pending()}
                  class="shrink-0 rounded px-2 py-1 text-ink hover:bg-hover disabled:opacity-40"
                  onClick={dismissSaveFailure}
                >
                  Discard draft
                </button>
              </Show>
              <button
                type="button"
                aria-label="Dismiss save error"
                class="rounded p-1 text-ink-muted hover:bg-hover"
                onClick={controller.dismissFailure}
              >
                <XIcon class="size-3.5" />
              </button>
            </div>
          )}
        </Show>
        <Show
          when={
            controller.refreshWarning() ||
            (props.source.error() && props.source.snapshot())
          }
        >
          <div
            role="status"
            class="flex shrink-0 items-center gap-2 border-b border-edge-muted px-5 py-2 text-xs text-ink-muted"
          >
            The latest data could not be refreshed.
            <button
              type="button"
              class="font-medium text-accent"
              onClick={() => void controller.refresh()}
            >
              Refresh
            </button>
          </div>
        </Show>
        <Show when={hiddenRecord()}>
          {(row) => (
            <div
              role="status"
              class="flex shrink-0 items-start gap-2 border-b border-edge-muted bg-accent/5 px-5 py-3 text-xs"
            >
              <EyeSlashIcon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
              <div class="min-w-0 flex-1">
                <p class="font-medium text-ink">
                  {hiddenSavedRecord()?.created
                    ? hiddenSavedRecord()?.noEditableColumns
                      ? 'Record created'
                      : 'Record created outside this view'
                    : 'Record saved outside this view'}
                </p>
                <p class="mt-1 text-ink-muted">
                  {hiddenSavedRecord()?.noEditableColumns
                    ? 'This view has no editable columns. Open the record to see its details.'
                    : `“${rowTitle(row(), columns())}” doesn’t match your ${constraints()}.`}
                </p>
              </div>
              <button
                type="button"
                class="shrink-0 rounded px-2 py-1 font-medium text-accent hover:bg-hover"
                onClick={() => open(row().rowId)}
              >
                Open record
              </button>
              <button
                type="button"
                aria-label="Dismiss record notice"
                class="rounded p-1 text-ink-muted hover:bg-hover"
                onClick={() => setHiddenSavedRecord(undefined)}
              >
                <XIcon class="size-3.5" />
              </button>
            </div>
          )}
        </Show>
        <Show when={!controller.failure() ? draftRows.error() : undefined}>
          {(failure) => (
            <div
              role="alert"
              class="flex items-center gap-3 border-b border-edge-muted px-4 py-2 text-xs text-ink-muted"
            >
              <span class="flex-1">
                {draftRows.isUncertain(failure().id)
                  ? 'This row may already be saved. Check the latest rows, then discard this draft.'
                  : failure().error}
              </span>
              <button
                type="button"
                disabled={controller.pending()}
                onClick={() =>
                  void (draftRows.isUncertain(failure().id)
                    ? controller.refresh()
                    : retry())
                }
                class="rounded px-2 py-1 text-ink hover:bg-hover"
              >
                {draftRows.isUncertain(failure().id) ? 'Refresh' : 'Retry'}
              </button>
              <Show when={draftRows.isUncertain(failure().id)}>
                <button
                  type="button"
                  disabled={controller.pending()}
                  class="rounded px-2 py-1 text-ink hover:bg-hover"
                  onClick={() => draftRows.discardUncertain(failure().id)}
                >
                  Discard draft
                </button>
              </Show>
            </div>
          )}
        </Show>
        <Show when={!props.source.loading()} fallback={<TableSkeleton />}>
          <Show
            when={props.source.snapshot()}
            fallback={
              <div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <WarningIcon class="size-7 text-ink-muted" />
                <p class="text-sm font-medium">
                  This table could not be loaded
                </p>
                <p class="max-w-96 text-xs text-ink-muted">
                  {props.source.error()?.message ?? 'Try refreshing the table.'}
                </p>
                <button
                  type="button"
                  class="flex items-center gap-2 rounded-md border border-edge-muted px-3 py-2 text-xs hover:bg-hover"
                  onClick={() => void controller.refresh()}
                >
                  <ArrowClockwiseIcon class="size-3.5" />
                  Try again
                </button>
              </div>
            }
          >
            <Show
              when={props.view.layout === 'board'}
              fallback={
                <DatabaseTable
                  name={props.name}
                  rows={
                    props.canEdit && visibleColumns().some(canEditCell)
                      ? draftRows.project(rows())
                      : rows()
                  }
                  isUnsavedRow={draftRows.isUnsaved}
                  onRowFocus={draftRows.setActive}
                  columns={visibleColumns()}
                  view={props.view}
                  canEdit={props.canEdit}
                  canCreateRecord={columns().length > 0}
                  pending={controller.pending()}
                  addColumn={props.addColumn(
                    columns().length ? undefined : 'Add first column',
                    undefined,
                    undefined,
                    focusColumn
                  )}
                  renderCell={renderCell}
                  editCell={editCell()}
                  titleColumnId={titleColumn(columns())?.id}
                  getRowTitle={(row) => rowTitle(row, columns())}
                  onOpen={open}
                  onCreate={() => void createRow()}
                  onDuplicate={duplicateRow}
                  onRequestDelete={requestDelete}
                  editColumn={editColumn()}
                  relationTables={props.relationTables}
                  onChangeColumnType={props.onChangeColumnType}
                  onDeleteColumn={
                    props.onDeleteColumn
                      ? async (columnId) => {
                          await props.onDeleteColumn?.(columnId);
                          props.onViewChange?.({
                            ...props.view,
                            columnOrder: props.view.columnOrder?.filter(
                              (id) => id !== columnId
                            ),
                            hiddenColumns: props.view.hiddenColumns.filter(
                              (id) => id !== columnId
                            ),
                            filters: props.view.filters.filter(
                              (filter) => filter.columnId !== columnId
                            ),
                            sorts: props.view.sorts.filter(
                              (sort) => sort.columnId !== columnId
                            ),
                            ...(props.view.groupBy === columnId
                              ? { groupBy: null, layout: 'table' }
                              : {}),
                          });
                        }
                      : undefined
                  }
                  onReorderColumn={reorderColumn}
                  onRenameColumn={props.onRenameColumn}
                  onSort={sort}
                  onHide={props.onViewChange ? hideColumn : undefined}
                  onMove={props.onViewChange ? moveColumn : undefined}
                  emptyState={
                    <Show
                      when={
                        rows().length === 0 &&
                        (constrained() || columns().length === 0)
                      }
                    >
                      <div class="py-5 pr-4 pl-14">
                        <p class="max-w-80 text-sm text-ink-muted">
                          {constrained()
                            ? 'No records match this view.'
                            : 'Add a column to get started.'}
                        </p>
                        <Show when={constrained()}>
                          <button
                            type="button"
                            class="mt-2 rounded text-xs text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
                            onClick={clearFilters}
                          >
                            Clear filters
                          </button>
                        </Show>
                      </div>
                    </Show>
                  }
                />
              }
            >
              <Show
                when={groupColumn()}
                fallback={
                  <div class="flex flex-1 flex-col items-start px-5 py-8">
                    <p class="text-sm text-ink-muted">
                      Choose a Select or Checkbox column to group cards.
                    </p>
                    <button
                      type="button"
                      class="mt-3 rounded-md border border-edge-muted px-3 py-2 text-xs hover:bg-hover"
                      onClick={() =>
                        props.onViewChange?.({ ...props.view, layout: 'table' })
                      }
                    >
                      Open table
                    </button>
                  </div>
                }
              >
                {(group) => (
                  <DatabaseBoard
                    renderTextValue={props.renderTextValue}
                    rows={rows()}
                    columns={columns()}
                    visibleColumnIds={visibleColumns().map(
                      (column) => column.id
                    )}
                    groupColumn={group()}
                    groupOrder={props.view.groupOrder}
                    cardOrder={
                      props.view.sorts.length ? undefined : props.view.cardOrder
                    }
                    onPlace={props.onViewChange ? placeCard : undefined}
                    onGroupOrderChange={(groupOrder) =>
                      props.onViewChange?.({ ...props.view, groupOrder })
                    }
                    canEdit={props.canEdit && group().writable}
                    rowPending={controller.rowPending}
                    createPending={controller.createPending}
                    createComplete={controller.createComplete}
                    onOpen={open}
                    projectMove={(rowId, value) =>
                      applyDatabaseView(
                        controller.rows().map((row) =>
                          row.rowId === rowId
                            ? {
                                ...row,
                                cells: { ...row.cells, [group().id]: value },
                              }
                            : row
                        ),
                        columns(),
                        props.view,
                        rowValue
                      )
                    }
                    onMove={async (rowId, value) => {
                      const row = controller
                        .rows()
                        .find((row) => row.rowId === rowId);
                      return row
                        ? Boolean(
                            await controller.save(
                              {
                                kind: 'cell',
                                rowId,
                                columnId: group().id,
                                value,
                              },
                              group().name
                            )
                          )
                        : false;
                    }}
                    onCreate={(value, title, intentId) =>
                      createRow(value, title, false, intentId)
                    }
                    onAddGroup={async (label) => {
                      const column = group();
                      if (!props.canEdit || !column.writable) return;
                      await controller.addGroup(column.id, label);
                    }}
                  />
                )}
              </Show>
            </Show>
          </Show>
        </Show>
        <Show when={selected()}>
          {(row) => (
            <RecordPanel
              row={row()}
              tableName={props.name}
              columns={columns()}
              canEdit={props.canEdit}
              pending={controller.pending()}
              outsideViewReason={
                selectedPosition() < 0 && constrained()
                  ? `This record doesn’t match your ${constraints()}. You can ${props.canEdit ? 'keep editing' : 'view'} it here.`
                  : undefined
              }
              saveError={
                controller.failure()
                  ? `Your change to ${controller.failure()!.label} was not saved.`
                  : undefined
              }
              onRetry={() => void retry()}
              position={selectedPosition()}
              total={rows().length}
              renderCell={renderCell}
              onClose={() => setSelectedId(undefined)}
              onNavigate={navigate}
              returnFocus={returnFocus}
              onDelete={deleteRow}
            />
          )}
        </Show>
        <Show when={deleteTarget()} keyed>
          {(target) => (
            <DeleteRecordDialog
              name={target.name}
              pending={controller.pending()}
              error={deletionError()}
              returnFocus={returnFocus}
              onClose={() => setDeleteTarget(undefined)}
              onDelete={() => void deleteRow(target.rowId)}
            />
          )}
        </Show>
      </div>
    </>
  );
}

function TableSkeleton() {
  return (
    <div
      class="flex-1 p-5"
      role="status"
      aria-label="Loading records"
      aria-busy="true"
    >
      <div class="mb-4 h-8 animate-pulse rounded bg-hover" />
      <For each={[0, 1, 2, 3, 4, 5]}>
        {() => <div class="mb-2 h-9 animate-pulse rounded bg-hover/60" />}
      </For>
    </div>
  );
}
