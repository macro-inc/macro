import { until } from '@solid-primitives/promise';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type {
  DatabaseRowsSource,
  DatabaseWriteResult,
} from '../context/table-source';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../core/database-view';
import {
  canEditCell,
  type DatabaseRowMutation,
  isWritableText,
  rowTitle,
  rowValue,
  titleColumn,
} from '../core/table';
import type { createDraftRows } from './draft-rows';
import type { createTableController } from './table-controller';

/** How long a revealed row stays tinted. */
const HIGHLIGHT_MS = 1_600;

/** A saved record the view's filters leave out. */
type HiddenSavedRecord = {
  rowId: string;
  created: boolean;
  /** The record was created, but the view has no column to type its first value in. */
  noEditableColumns?: boolean;
};

/** A new record: its first values, and whether to start editing it once saved. */
export type RecordCreation = {
  values?: Record<string, DatabaseCellValue>;
  title?: string;
  /** The column `title` goes in; the table's title column when unset. */
  titleColumn?: string;
  open: boolean;
  intentId?: string;
};

/**
 * What can be done to a view's records — open, reveal, create, duplicate,
 * delete — and the notices those leave: a failed deletion, a saved record
 * the view no longer shows.
 */
export function createRecordActions(options: {
  controller: ReturnType<typeof createTableController>;
  draftRows: ReturnType<typeof createDraftRows>;
  source: DatabaseRowsSource;
  columns: Accessor<DatabaseViewColumn[]>;
  visibleColumns: Accessor<DatabaseViewColumn[]>;
  layout: Accessor<'table' | 'board'>;
  canEdit: Accessor<boolean>;
  /** The view filters, so a saved record can fall outside it. */
  constrained: Accessor<boolean>;
  /** Opens a table cell for typing. */
  editCell: (rowId: string, columnId: string) => void;
}) {
  const { controller, draftRows } = options;
  const rows = controller.rows;
  const [selectedId, setSelectedId] = createSignal<string>();
  const [deleteTarget, setDeleteTarget] = createSignal<{
    rowId: string;
    name: string;
  }>();
  const [hiddenSavedRecord, setHiddenSavedRecord] =
    createSignal<HiddenSavedRecord>();
  const [highlightedRowId, setHighlightedRowId] = createSignal<string>();
  const deletionMutations = new Map<
    string,
    Extract<DatabaseRowMutation, { kind: 'delete' }>
  >();
  const duplicateIntents = new Map<string, string>();
  let duplicateSequence = 0;
  let returnFocus: HTMLElement | undefined;
  let deleteReturnFocus: HTMLElement | undefined;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let firstCellRequest: Promise<void> | undefined;
  let cancelFirstCellWait: (() => void) | undefined;
  onCleanup(() => {
    disposed = true;
    cancelFirstCellWait?.();
    clearTimeout(highlightTimer);
  });

  const selected = () =>
    controller.knownRows().find((row) => row.rowId === selectedId());
  const selectedPosition = () =>
    rows().findIndex((row) => row.rowId === selectedId());
  const deletionError = () => {
    const failed = controller.failure();
    return failed?.mutation.kind === 'delete' &&
      failed.mutation.rowId === deleteTarget()?.rowId
      ? 'Could not delete this record. Try again.'
      : undefined;
  };
  const hiddenRecord = () => {
    const saved = hiddenSavedRecord();
    return saved &&
      (saved.noEditableColumns ||
        !rows().some((row) => row.rowId === saved.rowId))
      ? controller.knownRows().find((row) => row.rowId === saved.rowId)
      : undefined;
  };
  /** Ids of the records the view must keep reading while they are looked at. */
  const heldRowIds = () =>
    [selectedId(), hiddenSavedRecord()?.rowId].filter(
      (rowId): rowId is string => rowId !== undefined
    );

  /** The table controller's callback once a write is acknowledged. */
  function recordSaved(
    mutation: DatabaseRowMutation,
    result: DatabaseWriteResult
  ) {
    if (mutation.kind === 'clear') return;
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
      options.constrained() &&
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
    if (failure?.failure.kind === 'outcome-unknown') {
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
    if (failure?.failure.kind === 'outcome-unknown' && failure.createIntentId)
      draftRows.discardUncertain(failure.createIntentId);
    controller.dismissFailure();
  }
  function focusBlankRow() {
    const field = options.visibleColumns().find(canEditCell);
    if (!options.canEdit() || !field) return false;
    options.editCell(draftRows.blankId(), field.id);
    return true;
  }
  function open(rowId: string) {
    const actualId = actualRowId(rowId);
    if (!actualId) return;
    if (document.activeElement instanceof HTMLElement)
      returnFocus = document.activeElement;
    setSelectedId(actualId);
  }
  /**
   * Show a record arrived at from elsewhere where it sits in the table. A
   * record this view does not show (filtered out, or a board) opens instead.
   */
  function reveal(rowId: string) {
    if (
      options.layout() !== 'table' ||
      !rows().some((row) => row.rowId === rowId)
    ) {
      open(rowId);
      return;
    }
    clearTimeout(highlightTimer);
    setHighlightedRowId(rowId);
    highlightTimer = setTimeout(
      () => setHighlightedRowId(undefined),
      HIGHLIGHT_MS
    );
  }
  function editCreatedRow(rowId: string) {
    if (options.layout() !== 'table') {
      open(rowId);
      return;
    }
    const title = titleColumn(options.columns());
    const editable = options.visibleColumns().filter(canEditCell);
    const field =
      editable.find((column) => column.id === title?.id) ?? editable[0];
    if (field && rows().some((row) => row.rowId === rowId))
      options.editCell(rowId, field.id);
    else if (!field)
      setHiddenSavedRecord({ rowId, created: true, noEditableColumns: true });
  }
  async function duplicateRow(rowId: string) {
    const actualId = actualRowId(rowId);
    if (!options.canEdit() || !actualId) return false;
    const row = controller.knownRows().find((row) => row.rowId === actualId);
    if (!row) return false;
    const intent =
      duplicateIntents.get(actualId) ??
      `duplicate:${actualId}:${++duplicateSequence}`;
    duplicateIntents.set(actualId, intent);
    const values = Object.fromEntries(
      options
        .columns()
        .filter((column) => column.writable)
        .map((column) => [column.id, rowValue(row, column.id)])
    );
    const result = await controller.save(
      { kind: 'create', values },
      { label: 'duplicate record', createIntentId: intent }
    );
    if (result.isErr()) return false;
    const createdId = result.value.insertedRowIds[0];
    if (createdId) editCreatedRow(createdId);
    return true;
  }
  function requestDelete(rowId: string) {
    const actualId = actualRowId(rowId);
    if (!options.canEdit() || controller.pending() || !actualId) return;
    const row = controller.knownRows().find((row) => row.rowId === actualId);
    if (!row) return;
    if (document.activeElement instanceof HTMLElement)
      deleteReturnFocus = document.activeElement;
    setDeleteTarget({
      rowId: actualId,
      name: rowTitle(row, options.columns()),
    });
  }
  async function deleteRow(rowId: string) {
    if (!options.canEdit() || controller.pending()) return false;
    const mutation =
      deletionMutations.get(rowId) ?? ({ kind: 'delete', rowId } as const);
    deletionMutations.set(rowId, mutation);
    return (await controller.save(mutation, { label: 'delete record' })).isOk();
  }
  function navigate(delta: number) {
    const row = rows()[selectedPosition() + delta];
    if (row) setSelectedId(row.rowId);
  }
  async function createRow(creation: RecordCreation) {
    if (!options.canEdit()) return false;
    const titleField =
      creation.titleColumn === undefined
        ? titleColumn(options.columns())
        : options
            .columns()
            .find((column) => column.id === creation.titleColumn);
    const values = { ...creation.values };
    if (creation.title && isWritableText(titleField))
      values[titleField.id] = creation.title;
    const saved = await controller.save(
      { kind: 'create', values },
      { label: 'new record', createIntentId: creation.intentId }
    );
    if (saved.isErr()) return false;
    const rowId = saved.value.insertedRowIds[0];
    if (rowId && creation.open) editCreatedRow(rowId);
    return true;
  }
  /** Start typing in the first record, or the blank row; a board opens its first card. */
  function focusFirstCell(): Promise<void> {
    if (firstCellRequest) return firstCellRequest;
    firstCellRequest = (async () => {
      if (options.source.loading()) {
        const ready = until(() => !options.source.loading());
        cancelFirstCellWait = ready.dispose;
        await ready.catch(() => undefined);
        cancelFirstCellWait = undefined;
      }
      if (
        disposed ||
        !options.canEdit() ||
        options.source.error() ||
        !options.source.snapshot()
      )
        return;
      const field = options.visibleColumns().find(canEditCell);
      if (!field) return;
      const table = options.layout() === 'table';
      const row = table ? draftRows.project(rows())[0] : rows()[0];
      if (row) {
        if (table) options.editCell(row.rowId, field.id);
        else open(row.rowId);
      } else if (table) {
        focusBlankRow();
      }
    })().finally(() => {
      firstCellRequest = undefined;
    });
    return firstCellRequest;
  }
  /** Where focus goes back when the delete dialog closes. */
  const deleteDialogReturnFocus = () =>
    [deleteReturnFocus, returnFocus].find((element) => element?.isConnected);

  return {
    selected,
    selectedPosition,
    highlightedRowId,
    hiddenRecord,
    hiddenSavedRecord,
    heldRowIds,
    deleteTarget,
    deletionError,
    returnFocus: () => returnFocus,
    deleteDialogReturnFocus,
    recordSaved,
    retry,
    dismissSaveFailure,
    focusBlankRow,
    focusFirstCell,
    open,
    reveal,
    closeRecord: () => setSelectedId(undefined),
    navigate,
    duplicateRow,
    requestDelete,
    cancelDelete: () => setDeleteTarget(undefined),
    deleteRow,
    createRow,
    dismissHiddenRecord: () => setHiddenSavedRecord(undefined),
  };
}
