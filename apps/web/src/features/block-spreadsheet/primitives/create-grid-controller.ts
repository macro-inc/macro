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
  canEdit: Accessor<boolean>;
  rowCount?: Accessor<number>;
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
  const origin = { row: 0, column: 0 };
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
    | { prefix: string; suffix: string; anchor: CellPosition }
    | undefined;
  const [notice, setNotice] = createSignal('');
  const activeAddress = () => cellAddress(selection().anchor);
  let originalValue = '';

  // Remote deletion and local tab changes invalidate drafts and async fills.
  // Keep a separate selection per sheet; a draft never crosses this boundary.
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
          cancel();
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
    setEditing(undefined);
    resetReference();
    if (source.canEdit() && value !== originalValue) {
      source.setCells({ [activeAddress()]: { value } });
    }
  }

  function select(position: CellPosition, extend = false) {
    commit();
    operation++;
    const bounded = boundPosition(position);
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
    originalValue = source.cells()[activeAddress()]?.value ?? '';
    setDraft(initial ?? originalValue);
    setEditing(location);
    setNotice('');
  }

  function cancel() {
    setEditing(undefined);
    setDraft('');
  }

  function resetReference() {
    referenceDraft = undefined;
    setPickingReference(false);
    setReferenceSelection(undefined);
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
    };
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
    const reference = formulaRangeReference(range);
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
    select({ row: from.row + row, column: from.column + column }, extend);
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
    if (!source.canEdit() || !source.copyCells || !copies.length) return;
    const current = ++operation;
    const before = source.cells();
    setNotice('Copying cells…');
    try {
      const edits = await source.copyCells(copies);
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

  function fill(sourceRange: CellSelection, target: CellSelection) {
    commit();
    const bounded = {
      anchor: boundPosition(target.anchor),
      focus: boundPosition(target.focus),
    };
    void applyCopies(fillCopies(source.cells(), sourceRange, bounded), bounded);
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
      selection()
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
      format({ bold: !source.cells()[activeAddress()]?.bold });
    } else if (command && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      format({ italic: !source.cells()[activeAddress()]?.italic });
    } else if (command && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      format({ underline: !source.cells()[activeAddress()]?.underline });
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
    editing,
    draft,
    setDraft,
    setTextSelection,
    editorSelection,
    referenceSelection,
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
