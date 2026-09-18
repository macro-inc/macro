import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type { CellCopy } from '../core/calculation';
import {
  copyRange,
  fillCopies,
  rangeCopies,
  readCopiedRange,
} from '../core/cell-copy';
import { cellEditValue, normalizeCellInput } from '../core/cell-input';
import {
  type FormulaTextSelection,
  formulaRangeReference,
  formulaReferenceSlot,
} from '../core/formula-reference';
import {
  type CellPosition,
  type CellSelection,
  cellAddress,
  GRID_COLUMNS,
  GRID_ROWS,
  parseClipboard,
  selectionAddresses,
  selectionBounds,
  serializeTable,
} from '../core/grid-selection';
import { selectionToggleStyles } from '../core/selection-formatting';
import {
  SPREADSHEET_DEFAULT_STYLE,
  SPREADSHEET_MAX_CELL_LENGTH,
  type SpreadsheetCell,
  type SpreadsheetCellEdits,
  type SpreadsheetCells,
  type SpreadsheetSelection,
} from '../core/spreadsheet-document';

type GridSource = {
  cells: Accessor<SpreadsheetCells>;
  sheetId?: Accessor<string>;
  sheets?: Accessor<{ id: string; name: string }[]>;
  setActiveSheet?: (id: string) => void;
  setSheetCells?: (id: string, edits: SpreadsheetCellEdits) => void;
  canEdit: Accessor<boolean>;
  rowCount?: Accessor<number>;
  hiddenRows?: Accessor<number[]>;
  hiddenColumns?: Accessor<number[]>;
  copyCells?: (copies: CellCopy[]) => Promise<SpreadsheetCellEdits>;
  setCells: (edits: Record<string, Partial<SpreadsheetCell> | null>) => void;
  setSelection?: (selection: SpreadsheetSelection) => void;
  undo: () => void;
  redo: () => void;
};

export function createGridController(source: GridSource) {
  const rowCount = () => source.rowCount?.() ?? GRID_ROWS;
  const boundPosition = (position: CellPosition): CellPosition => ({
    row: Math.max(0, Math.min(rowCount() - 1, position.row)),
    column: Math.max(0, Math.min(GRID_COLUMNS - 1, position.column)),
  });
  let operation = 0;
  onCleanup(() => {
    operation++;
  });
  const visiblePosition = (position: CellPosition): CellPosition => {
    const bounded = boundPosition(position);
    const visible = (index: number, limit: number, hidden: number[]) => {
      if (!hidden.includes(index)) return index;
      for (let next = index + 1; next < limit; next++)
        if (!hidden.includes(next)) return next;
      for (let next = index - 1; next >= 0; next--)
        if (!hidden.includes(next)) return next;
      return 0;
    };
    return {
      row: visible(bounded.row, rowCount(), source.hiddenRows?.() ?? []),
      column: visible(
        bounded.column,
        GRID_COLUMNS,
        source.hiddenColumns?.() ?? []
      ),
    };
  };
  const origin = visiblePosition({ row: 0, column: 0 });
  const [selection, setSelectionValue] = createSignal<CellSelection>({
    anchor: origin,
    focus: origin,
  });
  function setSelection(
    next: CellSelection | ((current: CellSelection) => CellSelection)
  ) {
    const selected = setSelectionValue(next);
    source.setSelection?.({
      anchor: cellAddress(selected.anchor),
      focus: cellAddress(selected.focus),
    });
    return selected;
  }
  const [editing, setEditing] = createSignal<'cell' | 'formula' | undefined>();
  const [draft, setDraftValue] = createSignal('');
  const [editorSelection, setEditorSelection] =
    createSignal<FormulaTextSelection>();
  const [referenceSelection, setReferenceSelection] =
    createSignal<CellSelection>();
  const [pickingReference, setPickingReference] = createSignal(false);
  let textSelection: FormulaTextSelection = { start: 0, end: 0 };
  let referenceDraft:
    | { prefix: string; suffix: string; anchor: CellPosition; sheetId?: string }
    | undefined;
  const [notice, setNotice] = createSignal('');
  const activeAddress = () => cellAddress(selection().anchor);
  let originalValue = '';
  let originalCell: SpreadsheetCell | undefined;
  let editTarget: { sheetId: string; address: string } | undefined;
  let switchingReferenceSheet: string | undefined;
  const [referenceSheetId, setReferenceSheetId] = createSignal<string>();
  const isEditingActiveSheet = () =>
    !editTarget || editTarget.sheetId === source.sheetId?.();
  const editingAddress = () => editTarget?.address ?? activeAddress();
  const canPickReference = () =>
    !!editing() && !!formulaReferenceSlot(draft(), textSelection);

  // Remote deletion and local tab changes invalidate drafts and async fills.
  // An explicit reference-picking tab switch keeps the origin draft. Remote
  // changes and other navigation still invalidate it.
  const sheetSelections = new Map<string, CellSelection>();
  if (source.sheetId) {
    let previousSheetId = source.sheetId();
    createEffect(
      on(
        source.sheetId,
        (id) => {
          sheetSelections.set(previousSheetId, selection());
          previousSheetId = id;
          operation++;
          if (switchingReferenceSheet !== id) cancel(false);
          switchingReferenceSheet = undefined;
          setPickingReference(false);
          referenceDraft = undefined;
          const saved = sheetSelections.get(id);
          setSelection(
            saved
              ? {
                  anchor: boundPosition(saved.anchor),
                  focus: boundPosition(saved.focus),
                }
              : { anchor: origin, focus: origin }
          );
          setNotice('');
        },
        { defer: true }
      )
    );
  }

  if (source.sheets) {
    createEffect(
      on(source.sheets, (sheets) => {
        if (
          editTarget &&
          !sheets.some((sheet) => sheet.id === editTarget?.sheetId)
        )
          cancel(false);
      })
    );
  }

  function switchSheet(id: string) {
    if (!source.setActiveSheet || id === source.sheetId?.()) return;
    if (source.sheets && !source.sheets().some((sheet) => sheet.id === id))
      return;
    if (canPickReference() && source.setSheetCells && editTarget) {
      switchingReferenceSheet = id;
      // The formula bar remains available when the original cell is off-sheet.
      setEditing('formula');
    } else commit();
    source.setActiveSheet(id);
  }

  // A local undo or remote layout operation can remove the selected empty row.
  // End its draft before moving focus so it cannot commit into a different cell.
  createEffect(
    on(rowCount, (count, previous) => {
      // A fill preview can extend past the current selection. Shrinking the
      // sheet invalidates that pending copy even when selection stays in bounds.
      if (previous !== undefined && count < previous) cancelPendingCopy();
      const current = selection();
      if (current.anchor.row < count && current.focus.row < count) return;
      cancel();
      selectRange(current.anchor, current.focus);
    })
  );

  function cancelPendingCopy() {
    operation++;
    setNotice('');
  }

  function undo() {
    if (!source.canEdit()) return;
    cancelPendingCopy();
    source.undo();
  }

  function redo() {
    if (!source.canEdit()) return;
    cancelPendingCopy();
    source.redo();
  }

  function commit() {
    // Commands call commit even without an open editor. Treat that explicit
    // action as superseding an unfinished fill or internal clipboard paste.
    cancelPendingCopy();
    if (!editing()) return;
    const value = draft();
    const target = editTarget;
    const address = editingAddress();
    setEditing(undefined);
    editTarget = undefined;
    resetReference();
    if (source.canEdit() && value !== originalValue) {
      const edits = {
        [address]: { value: normalizeCellInput(value, originalCell) },
      };
      if (target && source.setSheetCells)
        source.setSheetCells(target.sheetId, edits);
      else source.setCells(edits);
    }
    if (target && target.sheetId !== source.sheetId?.())
      source.setActiveSheet?.(target.sheetId);
  }

  function select(position: CellPosition, extend = false) {
    commit();
    operation++;
    const bounded = visiblePosition(position);
    setSelection((current) => ({
      anchor: extend ? current.anchor : bounded,
      focus: bounded,
    }));
    setNotice('');
  }

  function selectRange(anchor: CellPosition, focus: CellPosition) {
    commit();
    operation++;
    setSelection({
      anchor: boundPosition(anchor),
      focus: boundPosition(focus),
    });
    setNotice('');
  }

  function beginEdit(location: 'cell' | 'formula', initial?: string) {
    if (!source.canEdit()) return;
    operation++;
    const visible = visiblePosition(selection().anchor);
    if (cellAddress(visible) !== activeAddress())
      setSelection({ anchor: visible, focus: visible });
    // Moving between in-cell and formula-bar editors must keep the same draft.
    if (editing()) {
      setEditing(location);
      return;
    }
    originalCell = source.cells()[activeAddress()];
    originalValue = cellEditValue(originalCell);
    editTarget = source.sheetId
      ? { sheetId: source.sheetId(), address: activeAddress() }
      : undefined;
    setDraft(initial ?? originalValue);
    setEditing(location);
    setNotice('');
  }

  function cancel(returnToOrigin = true) {
    const target = editTarget;
    editTarget = undefined;
    setEditing(undefined);
    setDraft('');
    if (returnToOrigin && target && target.sheetId !== source.sheetId?.())
      source.setActiveSheet?.(target.sheetId);
  }

  function resetReference() {
    referenceDraft = undefined;
    setPickingReference(false);
    setReferenceSelection(undefined);
    setReferenceSheetId(undefined);
    setEditorSelection(undefined);
  }

  function setDraft(value: string) {
    resetReference();
    textSelection = { start: value.length, end: value.length };
    setDraftValue(value);
  }

  function setTextSelection(start: number, end: number) {
    textSelection = { start, end };
  }

  function beginReference(position: CellPosition) {
    if (!editing() || !source.canEdit()) return false;
    const slot = formulaReferenceSlot(draft(), textSelection);
    if (!slot) return false;
    referenceDraft = {
      prefix: draft().slice(0, slot.start),
      suffix: draft().slice(slot.end),
      anchor: boundPosition(position),
      sheetId: source.sheetId?.(),
    };
    setReferenceSheetId(source.sheetId?.());
    setPickingReference(true);
    updateReference(position);
    return true;
  }

  function updateReference(position: CellPosition) {
    if (!referenceDraft || !editing() || !source.canEdit()) return;
    const range = {
      anchor: referenceDraft.anchor,
      focus: boundPosition(position),
    };
    const sheetName =
      editTarget && editTarget.sheetId !== referenceDraft.sheetId
        ? source
            .sheets?.()
            .find((sheet) => sheet.id === referenceDraft?.sheetId)?.name
        : undefined;
    const reference = formulaRangeReference(range, sheetName);
    const value = referenceDraft.prefix + reference + referenceDraft.suffix;
    if (value.length > SPREADSHEET_MAX_CELL_LENGTH) {
      setNotice('A cell can contain up to 10,000 characters.');
      return;
    }
    const cursor = referenceDraft.prefix.length + reference.length;
    textSelection = { start: cursor, end: cursor };
    batch(() => {
      setDraftValue(value);
      setReferenceSelection(range);
      setEditorSelection(textSelection);
    });
  }

  function endReference() {
    referenceDraft = undefined;
    setPickingReference(false);
  }

  function move(row: number, column: number, extend = false) {
    const from = extend ? selection().focus : selection().anchor;
    const next = boundPosition({
      row: from.row + row,
      column: from.column + column,
    });
    while (row && source.hiddenRows?.().includes(next.row)) {
      const candidate = next.row + Math.sign(row);
      if (candidate < 0 || candidate >= rowCount()) {
        next.row = from.row;
        break;
      }
      next.row = candidate;
    }
    while (column && source.hiddenColumns?.().includes(next.column)) {
      const candidate = next.column + Math.sign(column);
      if (candidate < 0 || candidate >= GRID_COLUMNS) {
        next.column = from.column;
        break;
      }
      next.column = candidate;
    }
    select(next, extend);
  }

  function clear() {
    if (!source.canEdit()) return;
    cancelPendingCopy();
    source.setCells(
      Object.fromEntries(
        selectionAddresses(selection()).map((address) => [
          address,
          { value: '' },
        ])
      )
    );
  }

  function format(patch: Partial<SpreadsheetCell>) {
    commit();
    if (!source.canEdit()) return;
    cancelPendingCopy();
    source.setCells(
      Object.fromEntries(
        selectionAddresses(selection()).map((address) => [address, patch])
      )
    );
  }

  function copy(): string {
    const { top, bottom, left, right } = selectionBounds(selection());
    const rows: string[][] = [];
    for (let row = top; row <= bottom; row++) {
      const values: string[] = [];
      for (let column = left; column <= right; column++) {
        values.push(source.cells()[cellAddress({ row, column })]?.value ?? '');
      }
      rows.push(values);
    }
    return serializeTable(rows);
  }

  function copyMetadata(cut = false): string {
    return JSON.stringify({
      ...copyRange(source.cells(), selection()),
      ...(cut && { cut: true }),
    });
  }

  async function applyCopies(copies: CellCopy[], target: CellSelection) {
    if (!source.canEdit() || !copies.length) return;
    const hasFormulas = copies.some(
      ({ cell }) => cell.value.startsWith('=') && cell.format !== 'text'
    );
    if (hasFormulas && !source.copyCells) return;
    const current = ++operation;
    const before = source.cells();
    setNotice('Copying cells…');
    try {
      // Literal/series fills are synchronous, avoiding an old-value flash while
      // a worker starts up. Formula translation still uses IronCalc's parser.
      const edits =
        hasFormulas && source.copyCells
          ? await source.copyCells(copies)
          : Object.fromEntries(
              copies.map(({ to, cell }) => [
                cellAddress(to),
                { ...SPREADSHEET_DEFAULT_STYLE, ...cell },
              ])
            );
      if (current !== operation) return;
      if (!source.canEdit()) {
        setNotice('Copy cancelled because this spreadsheet is view only.');
        return;
      }
      // Do not overwrite edits that arrived while reference translation ran.
      if (
        Object.keys(edits).some(
          (address) =>
            JSON.stringify(before[address]) !==
            JSON.stringify(source.cells()[address])
        )
      ) {
        setNotice('These cells changed while copying. Try again.');
        return;
      }
      source.setCells(edits);
      setSelection(target);
      setNotice(`Filled ${copies.length} cells`);
    } catch (error) {
      if (current === operation)
        setNotice(
          error instanceof Error ? error.message : 'Unable to copy cells.'
        );
    }
  }

  function fill(
    sourceRange: CellSelection,
    target: CellSelection,
    mode: 'series' | 'copy' = 'series'
  ) {
    commit();
    const bounded = {
      anchor: boundPosition(target.anchor),
      focus: boundPosition(target.focus),
    };
    return applyCopies(
      fillCopies(source.cells(), sourceRange, bounded, mode),
      bounded
    );
  }

  function fillDirection(direction: 'down' | 'right') {
    const { top, bottom, left, right } = selectionBounds(selection());
    fill(
      {
        anchor: { row: top, column: left },
        focus: {
          row: direction === 'down' ? top : bottom,
          column: direction === 'down' ? right : left,
        },
      },
      selection(),
      'copy'
    );
  }

  function paste(text: string, metadata?: string) {
    if (!source.canEdit()) return;
    operation++;
    try {
      commit();
      const range = metadata ? readCopiedRange(metadata) : undefined;
      if (range && (source.copyCells || range.cut)) {
        const start = selection().anchor;
        const focus = {
          row: start.row + range.cells.length - 1,
          column: start.column + range.cells[0].length - 1,
        };
        if (focus.row >= rowCount() || focus.column >= GRID_COLUMNS)
          throw new Error('Add rows or choose a smaller range before pasting.');
        if (range.cut) {
          const edits = Object.fromEntries(
            rangeCopies(range, start).map(({ to, cell }) => [
              cellAddress(to),
              { ...SPREADSHEET_DEFAULT_STYLE, ...cell },
            ])
          );
          source.setCells(edits);
          setSelection({ anchor: start, focus });
          setNotice(
            `Pasted ${range.cells.length * range.cells[0].length} cells`
          );
        } else
          void applyCopies(rangeCopies(range, start), { anchor: start, focus });
        return;
      }
      if (text.length > 1_000_000)
        throw new Error('Paste a smaller table (up to 1 MB).');
      const rows = parseClipboard(text);
      const width = rows.reduce(
        (maximum, row) => Math.max(maximum, row.length),
        0
      );
      const start = selection().anchor;
      if (
        start.row + rows.length > rowCount() ||
        start.column + width > GRID_COLUMNS
      ) {
        throw new Error(
          `This sheet has ${rowCount()} rows and ${GRID_COLUMNS} columns. Paste a smaller range or start closer to A1.`
        );
      }
      const edits: Record<string, Partial<SpreadsheetCell>> = {};
      rows.forEach((row, rowIndex) => {
        for (let columnIndex = 0; columnIndex < width; columnIndex++) {
          const value = row[columnIndex] ?? '';
          if (value.length > SPREADSHEET_MAX_CELL_LENGTH)
            throw new Error('A cell can contain up to 10,000 characters.');
          edits[
            cellAddress({
              row: start.row + rowIndex,
              column: start.column + columnIndex,
            })
          ] = { value };
        }
      });
      source.setCells(edits);
      setSelection({
        anchor: start,
        focus: {
          row: start.row + rows.length - 1,
          column: start.column + width - 1,
        },
      });
      setNotice(`Pasted ${rows.length * width} cells`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Unable to paste this table.'
      );
    }
  }

  function keyDown(event: KeyboardEvent) {
    if (event.isComposing) return;
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectRange(origin, { row: rowCount() - 1, column: GRID_COLUMNS - 1 });
    } else if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      (event.shiftKey ? redo : undo)();
    } else if (command && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      format({
        bold: !selectionToggleStyles(source.cells(), selection()).bold,
      });
    } else if (command && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      format({
        italic: !selectionToggleStyles(source.cells(), selection()).italic,
      });
    } else if (command && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      format({
        underline: !selectionToggleStyles(source.cells(), selection())
          .underline,
      });
    } else if (command && ['d', 'r'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      fillDirection(event.key.toLowerCase() === 'd' ? 'down' : 'right');
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1, 0, event.shiftKey);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(0, event.key === 'ArrowRight' ? 1 : -1, event.shiftKey);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      move(0, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      beginEdit('cell');
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      clear();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (editing()) cancel();
      else select(selection().anchor);
    } else if (event.key === 'Home') {
      event.preventDefault();
      select(
        { row: command ? 0 : selection().anchor.row, column: 0 },
        event.shiftKey
      );
    } else if (!command && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      beginEdit('cell', event.key);
    }
  }

  return {
    operationRevision: () => operation,
    undo,
    redo,
    selection,
    copyMetadata,
    fill,
    fillDirection,
    activeAddress,
    editingAddress,
    isEditingActiveSheet,
    canPickReference,
    switchSheet,
    editing,
    draft,
    setDraft,
    setTextSelection,
    editorSelection,
    referenceSelection: () =>
      referenceSheetId() === source.sheetId?.()
        ? referenceSelection()
        : undefined,
    pickingReference,
    beginReference,
    updateReference,
    endReference,
    notice,
    select,
    selectRange,
    beginEdit,
    commit,
    cancel,
    move,
    clear,
    format,
    copy,
    paste,
    keyDown,
  };
}

export type GridController = ReturnType<typeof createGridController>;
