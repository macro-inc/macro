// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CellCopy } from '../core/calculation';
import {
  GRID_COLUMNS,
  GRID_ROWS,
  parseClipboard,
} from '../core/grid-selection';
import type {
  SpreadsheetCellEdits,
  SpreadsheetCells,
} from '../core/spreadsheet-document';
import { createGridController } from './create-grid-controller';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
});

function setup(
  initial: SpreadsheetCells = {},
  copyCells?: (copies: CellCopy[]) => Promise<SpreadsheetCellEdits>,
  initialSheetId?: string
) {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const [cells, updateCells] = createSignal(initial);
    const [canEdit, setCanEdit] = createSignal(true);
    const [rowCount, setRowCount] = createSignal(200);
    const [hiddenRows, setHiddenRows] = createSignal<number[]>([]);
    const [hiddenColumns, setHiddenColumns] = createSignal<number[]>([]);
    const [sheetId, setSheetId] = createSignal(initialSheetId ?? 'sheet1');
    const setCells = vi.fn((edits: SpreadsheetCellEdits) => {
      const next = { ...cells() };
      for (const [address, edit] of Object.entries(edits)) {
        if (edit === null) delete next[address];
        else next[address] = { ...(next[address] ?? { value: '' }), ...edit };
      }
      updateCells(next);
    });
    const publishSelection = vi.fn();
    const undo = vi.fn();
    const redo = vi.fn();
    const grid = createGridController({
      cells,
      hiddenRows,
      hiddenColumns,
      setSelection: publishSelection,
      canEdit,
      setCells,
      undo,
      redo,
      copyCells,
      rowCount,
      sheetId: initialSheetId ? sheetId : undefined,
    });
    function key(value: string, options: KeyboardEventInit = {}) {
      const event = new KeyboardEvent('keydown', {
        key: value,
        cancelable: true,
        ...options,
      });
      grid.keyDown(event);
      return event;
    }
    return {
      grid,
      publishSelection,
      cells,
      setCells,
      setCanEdit,
      setRowCount,
      setHiddenRows,
      setHiddenColumns,
      setSheetId,
      undo,
      redo,
      key,
    };
  });
}

describe('spreadsheet grid editing', () => {
  it('keeps Home and typing into a whole-row/column selection out of hidden cells', () => {
    const { grid, key, setHiddenRows, setHiddenColumns, cells } = setup();
    setHiddenRows([0]);
    setHiddenColumns([0]);
    grid.select({ row: 2, column: 4 });
    key('Home');
    expect(grid.activeAddress()).toBe('B3');
    key('Home', { ctrlKey: true });
    expect(grid.activeAddress()).toBe('B2');
    grid.selectRange({ row: 0, column: 0 }, { row: 0, column: 25 });
    key('x');
    grid.commit();
    expect(cells().B2.value).toBe('x');
    expect(cells().A1).toBeUndefined();
    key('ArrowLeft');
    expect(grid.activeAddress()).toBe('B2');
  });
  it('publishes the current range for direct selection, keyboard movement, and tab restoration', async () => {
    const { grid, publishSelection, setSheetId, key } = setup(
      {},
      undefined,
      'sheet1'
    );
    await Promise.resolve();
    grid.selectRange({ row: 3, column: 1 }, { row: 8, column: 4 });
    expect(publishSelection).toHaveBeenLastCalledWith({
      anchor: 'B4',
      focus: 'E9',
    });
    setSheetId('other');
    expect(publishSelection).toHaveBeenLastCalledWith({
      anchor: 'A1',
      focus: 'A1',
    });
    key('ArrowDown');
    expect(publishSelection).toHaveBeenLastCalledWith({
      anchor: 'A2',
      focus: 'A2',
    });
    setSheetId('sheet1');
    expect(publishSelection).toHaveBeenLastCalledWith({
      anchor: 'B4',
      focus: 'E9',
    });
  });

  it.each(['cell', 'formula'] as const)(
    'picks a live range in the %s editor without writing or moving the active cell',
    (location) => {
      const { grid, cells, setCells } = setup();
      grid.select({ row: 9, column: 5 });
      grid.beginEdit(location, '=SUM(');
      expect(grid.beginReference({ row: 3, column: 1 })).toBe(true);
      expect(grid.draft()).toBe('=SUM(B4');
      grid.updateReference({ row: 6, column: 2 });
      expect(grid.draft()).toBe('=SUM(B4:C7');
      expect(grid.activeAddress()).toBe('F10');
      expect(grid.editing()).toBe(location);
      expect(grid.editorSelection()).toEqual({ start: 10, end: 10 });
      expect(setCells).not.toHaveBeenCalled();
      grid.endReference();
      expect(grid.pickingReference()).toBe(false);
      grid.setDraft(grid.draft() + ')');
      grid.commit();
      expect(cells().F10.value).toBe('=SUM(B4:C7)');
      expect(setCells).toHaveBeenCalledOnce();
      expect(grid.referenceSelection()).toBeUndefined();
    }
  );

  it('replaces a picked range, inserts subsequent arguments, and cancels without saving', () => {
    const { grid, setCells } = setup();
    grid.beginEdit('cell', '=SUM(');
    grid.beginReference({ row: 7, column: 3 });
    grid.updateReference({ row: 3, column: 1 });
    grid.endReference();
    expect(grid.draft()).toBe('=SUM(B4:D8');
    grid.beginReference({ row: 0, column: 0 });
    grid.endReference();
    expect(grid.draft()).toBe('=SUM(A1');
    grid.setDraft(grid.draft() + ',');
    grid.beginReference({ row: 2, column: 2 });
    grid.endReference();
    expect(grid.draft()).toBe('=SUM(A1,C3');
    grid.cancel();
    expect(setCells).not.toHaveBeenCalled();
    expect(grid.referenceSelection()).toBeUndefined();
  });

  it('inserts at the caret and honors permissions', () => {
    const { grid, setCanEdit } = setup();
    grid.beginEdit('formula', '=SUM(,C1)');
    grid.setTextSelection(5, 5);
    grid.beginReference({ row: 1, column: 1 });
    expect(grid.draft()).toBe('=SUM(B2,C1)');
    setCanEdit(false);
    grid.updateReference({ row: 2, column: 2 });
    expect(grid.draft()).toBe('=SUM(B2,C1)');
    grid.endReference();
    expect(grid.beginReference({ row: 4, column: 4 })).toBe(false);
  });

  it('starts typing into a draft and commits to the original cell before moving', () => {
    const { grid, cells, setCells, key } = setup({ A1: { value: 'before' } });
    expect(key('n').defaultPrevented).toBe(true);
    expect(grid.editing()).toBe('cell');
    expect(grid.draft()).toBe('n');
    expect(setCells).not.toHaveBeenCalled();
    grid.setDraft('new value');
    grid.select({ row: 1, column: 1 });
    expect(cells().A1.value).toBe('new value');
    expect(cells().B2).toBeUndefined();
    expect(grid.editing()).toBeUndefined();
    expect(grid.activeAddress()).toBe('B2');
  });

  it('cancels an edit with Escape and avoids committing unchanged input', () => {
    const { grid, setCells, key } = setup({ A1: { value: '=SUM(B1:B3)' } });
    key('F2');
    expect(grid.draft()).toBe('=SUM(B1:B3)');
    grid.commit();
    expect(setCells).not.toHaveBeenCalled();
    grid.beginEdit('formula');
    grid.setDraft('discard this');
    key('Escape');
    expect(grid.editing()).toBeUndefined();
    expect(grid.draft()).toBe('');
    expect(setCells).not.toHaveBeenCalled();
  });

  it('ignores IME composition keystrokes', () => {
    const { grid, key } = setup();
    const event = key('a', { isComposing: true });
    expect(event.defaultPrevented).toBe(false);
    expect(grid.editing()).toBeUndefined();
  });

  it('clears selected contents while preserving formatting', () => {
    const { grid, cells, setCells, key } = setup({
      A1: { value: '5', bold: true, format: 'currency' },
      B1: { value: '10' },
    });
    grid.selectRange({ row: 0, column: 0 }, { row: 0, column: 1 });
    key('Delete');
    expect(setCells).toHaveBeenCalledTimes(1);
    expect(cells().A1).toEqual({ value: '', bold: true, format: 'currency' });
    expect(cells().B1.value).toBe('');
  });
});

describe('sheet boundaries', () => {
  it('cancels a formula draft and reference picking when the active sheet changes', () => {
    const { grid, setSheetId, setCells } = setup({}, undefined, 'sheet1');
    grid.select({ row: 4, column: 3 });
    grid.beginEdit('formula', '=SUM(');
    grid.beginReference({ row: 2, column: 1 });
    expect(grid.pickingReference()).toBe(true);

    // This is also the path used when a collaborator deletes the active sheet.
    setSheetId('replacement');
    expect(grid.editing()).toBeUndefined();
    expect(grid.draft()).toBe('');
    expect(grid.pickingReference()).toBe(false);
    expect(grid.referenceSelection()).toBeUndefined();
    expect(grid.editorSelection()).toBeUndefined();
    expect(grid.activeAddress()).toBe('A1');
    grid.commit();
    expect(setCells).not.toHaveBeenCalled();
  });

  it('remembers independent selections by stable sheet ID and bounds restored rows', () => {
    const { grid, setSheetId, setRowCount } = setup({}, undefined, 'sheet1');
    grid.selectRange({ row: 4, column: 2 }, { row: 8, column: 5 });
    setSheetId('second');
    expect(grid.activeAddress()).toBe('A1');
    setRowCount(300);
    grid.selectRange({ row: 290, column: 1 }, { row: 299, column: 3 });
    setSheetId('sheet1');
    setRowCount(200);
    expect(grid.selection()).toEqual({
      anchor: { row: 4, column: 2 },
      focus: { row: 8, column: 5 },
    });
    setSheetId('second');
    expect(grid.selection()).toEqual({
      anchor: { row: 199, column: 1 },
      focus: { row: 199, column: 3 },
    });
  });

  it.each([false, true])(
    'invalidates a pending fill across a sheet switch (return=%s)',
    async (returnToOriginal) => {
      let finish!: (edits: SpreadsheetCellEdits) => void;
      const pending = new Promise<SpreadsheetCellEdits>((resolve) => {
        finish = resolve;
      });
      const { grid, setSheetId, setCells } = setup(
        { A1: { value: '=B1' } },
        () => pending,
        'sheet1'
      );
      grid.selectRange({ row: 0, column: 0 }, { row: 1, column: 0 });
      grid.fillDirection('down');
      setSheetId('second');
      if (returnToOriginal) setSheetId('sheet1');
      finish({ A2: { value: '=B2' } });
      await Promise.resolve();
      expect(setCells).not.toHaveBeenCalled();
      expect(grid.notice()).toBe('');
    }
  );
});

describe('spreadsheet keyboard selection', () => {
  it('moves and extends selection within the grid boundaries', () => {
    const { grid, key } = setup();
    key('ArrowUp');
    key('ArrowLeft');
    expect(grid.activeAddress()).toBe('A1');
    key('Tab');
    key('ArrowDown');
    expect(grid.activeAddress()).toBe('B2');
    key('ArrowDown', { shiftKey: true });
    key('ArrowRight', { shiftKey: true });
    expect(grid.selection()).toEqual({
      anchor: { row: 1, column: 1 },
      focus: { row: 2, column: 2 },
    });
    key('Home', { ctrlKey: true });
    expect(grid.activeAddress()).toBe('A1');
    grid.select({ row: GRID_ROWS + 4, column: GRID_COLUMNS + 4 });
    key('ArrowRight');
    key('ArrowDown');
    expect(grid.activeAddress()).toBe('Z200');
  });

  it('selects the whole sheet and bounds programmatic range selections', () => {
    const { grid, key } = setup();
    key('a', { metaKey: true });
    expect(grid.selection()).toEqual({
      anchor: { row: 0, column: 0 },
      focus: { row: GRID_ROWS - 1, column: GRID_COLUMNS - 1 },
    });
    grid.selectRange(
      { row: -20, column: -1 },
      { row: GRID_ROWS, column: GRID_COLUMNS }
    );
    expect(grid.selection()).toEqual({
      anchor: { row: 0, column: 0 },
      focus: { row: GRID_ROWS - 1, column: GRID_COLUMNS - 1 },
    });
  });

  it('routes undo and redo through the supplied document history', () => {
    const { undo, redo, key } = setup();
    key('z', { ctrlKey: true });
    key('Z', { metaKey: true, shiftKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });
});

describe('spreadsheet clipboard and formatting', () => {
  it('pastes a rectangular operation atomically and preserves destination styles', () => {
    const { grid, cells, setCells } = setup({
      B2: { value: 'old', bold: true },
      C3: { value: 'clear me', format: 'currency' },
    });
    grid.select({ row: 1, column: 1 });
    grid.paste('one\t"two\nlines"\nthree');
    expect(setCells).toHaveBeenCalledTimes(1);
    expect(cells()).toEqual({
      B2: { value: 'one', bold: true },
      C2: { value: 'two\nlines' },
      B3: { value: 'three' },
      C3: { value: '', format: 'currency' },
    });
    expect(grid.selection().focus).toEqual({ row: 2, column: 2 });
    expect(grid.notice()).toBe('Pasted 4 cells');
  });

  it('rejects overflow and invalid paste before any write', () => {
    const { grid, setCells } = setup();
    grid.select({ row: GRID_ROWS - 1, column: GRID_COLUMNS - 1 });
    grid.paste('first\tsecond');
    expect(grid.notice()).toContain('200 rows and 26 columns');
    grid.select({ row: 0, column: 0 });
    grid.paste(`valid\t${'x'.repeat(10_001)}`);
    expect(grid.notice()).toContain('10,000 characters');
    grid.paste('"unclosed');
    expect(grid.notice()).toContain('unclosed');
    grid.paste('x'.repeat(1_000_001));
    expect(grid.notice()).toContain('1 MB');
    expect(setCells).not.toHaveBeenCalled();
  });

  it('copies raw formulas and quoted multiline cells in visual row order', () => {
    const { grid } = setup({
      A1: { value: '=B2*2' },
      B1: { value: 'line\nbreak' },
      A2: { value: 'a\tb' },
      B2: { value: 'he said "yes"' },
    });
    grid.selectRange({ row: 1, column: 1 }, { row: 0, column: 0 });
    expect(parseClipboard(grid.copy())).toEqual([
      ['=B2*2', 'line\nbreak'],
      ['a\tb', 'he said "yes"'],
    ]);
  });

  it('applies formatting to a selection without overwriting values', () => {
    const { grid, cells, setCells, key } = setup({
      A1: { value: '0.5' },
      B1: { value: '=A1*2' },
    });
    grid.selectRange({ row: 0, column: 0 }, { row: 0, column: 1 });
    grid.format({ format: 'percent' });
    expect(setCells).toHaveBeenCalledTimes(1);
    key('b', { ctrlKey: true });
    expect(cells()).toEqual({
      A1: { value: '0.5', format: 'percent', bold: true },
      B1: { value: '=A1*2', format: 'percent', bold: true },
    });
  });
});

describe('spreadsheet read-only permissions', () => {
  it('blocks every write and history action but permits navigation and copy', () => {
    const { grid, setCells, setCanEdit, undo, redo, key } = setup({
      A1: { value: 'read me' },
    });
    setCanEdit(false);
    grid.beginEdit('cell');
    grid.beginEdit('formula');
    grid.paste('replaced');
    grid.format({ bold: true });
    grid.clear();
    key('x');
    key('Delete');
    key('z', { metaKey: true });
    key('Z', { metaKey: true, shiftKey: true });
    expect(grid.editing()).toBeUndefined();
    expect(grid.copy()).toBe('read me');
    key('ArrowRight');
    expect(grid.activeAddress()).toBe('B1');
    expect(setCells).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it('rechecks permission when an already-open editor commits', () => {
    const { grid, setCanEdit, setCells } = setup();
    grid.beginEdit('cell', 'draft');
    setCanEdit(false);
    grid.commit();
    expect(setCells).not.toHaveBeenCalled();
    expect(grid.editing()).toBeUndefined();
  });
});

describe('formula-aware copy coordination', () => {
  it.each([
    ['undo', 'keyboard'],
    ['redo', 'keyboard'],
    ['undo', 'command'],
    ['redo', 'command'],
  ] as const)(
    'cancels a delayed fill before %s through a %s action',
    async (action, entryPoint) => {
      let finish!: (edits: SpreadsheetCellEdits) => void;
      const pending = new Promise<SpreadsheetCellEdits>((resolve) => {
        finish = resolve;
      });
      const view = setup({ A1: { value: '=B1' } }, () => pending);
      view[action].mockImplementation(() => {
        view.setCells({ A1: { value: 'history result' } });
      });
      view.grid.selectRange({ row: 0, column: 0 }, { row: 1, column: 0 });
      view.grid.fillDirection('down');
      if (entryPoint === 'keyboard')
        view.key('z', { ctrlKey: true, shiftKey: action === 'redo' });
      else view.grid[action]();
      const writes = view.setCells.mock.calls.length;
      finish({ A2: { value: '=B2' } });
      await Promise.resolve();
      expect(view[action]).toHaveBeenCalledOnce();
      expect(view.setCells).toHaveBeenCalledTimes(writes);
      expect(view.cells().A1.value).toBe('history result');
      expect(view.cells().A2).toBeUndefined();
      expect(view.grid.notice()).toBe('');
    }
  );

  it.each(['clear', 'format', 'commit'] as const)(
    'cancels a delayed fill after %s even when destination content is unchanged',
    async (action) => {
      let finish!: (edits: SpreadsheetCellEdits) => void;
      const pending = new Promise<SpreadsheetCellEdits>((resolve) => {
        finish = resolve;
      });
      const view = setup(
        {
          A1: { value: '=B1', bold: false },
          A2: { value: '', bold: false },
        },
        () => pending
      );
      view.grid.selectRange({ row: 0, column: 0 }, { row: 1, column: 0 });
      view.grid.fillDirection('down');
      if (action === 'clear') view.grid.clear();
      else if (action === 'format') view.grid.format({ bold: false });
      else view.grid.commit();
      expect(view.cells().A2).toEqual({ value: '', bold: false });
      const writes = view.setCells.mock.calls.length;
      finish({ A2: { value: '=B2' } });
      await Promise.resolve();
      expect(view.setCells).toHaveBeenCalledTimes(writes);
      expect(view.cells().A2.value).toBe('');
      expect(view.grid.notice()).toBe('');
    }
  );

  it.each([false, true])(
    'cancels a fill beyond removed rows with an in-bounds selection (regrow=%s)',
    async (regrow) => {
      let finish!: (edits: SpreadsheetCellEdits) => void;
      const pending = new Promise<SpreadsheetCellEdits>((resolve) => {
        finish = resolve;
      });
      const view = setup({ A1: { value: '=B1' } }, () => pending);
      view.setRowCount(300);
      view.grid.fill(
        { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } },
        { anchor: { row: 0, column: 0 }, focus: { row: 299, column: 0 } }
      );
      view.setRowCount(200);
      if (regrow) view.setRowCount(300);
      finish({ A300: { value: '=B300' } });
      await Promise.resolve();
      expect(view.setCells).not.toHaveBeenCalled();
      expect(view.cells().A300).toBeUndefined();
      expect(view.grid.selection()).toEqual({
        anchor: { row: 0, column: 0 },
        focus: { row: 0, column: 0 },
      });
      expect(view.grid.notice()).toBe('');
    }
  );

  it('pastes internal metadata with source coordinates in one atomic write', async () => {
    const copy = vi.fn(async (_copies: CellCopy[]) => ({
      B2: { value: '=C3', bold: true },
    }));
    const { grid, cells, setCells } = setup(
      { A1: { value: '=B2', bold: true } },
      copy
    );
    const metadata = grid.copyMetadata();
    grid.select({ row: 1, column: 1 });
    grid.paste('=B2', metadata);
    await Promise.resolve();
    expect(copy.mock.calls[0][0]).toEqual([
      {
        from: { row: 0, column: 0 },
        to: { row: 1, column: 1 },
        cell: { value: '=B2', bold: true },
      },
    ]);
    expect(setCells).toHaveBeenCalledTimes(1);
    expect(cells().B2.value).toBe('=C3');
  });

  it('fills from the top row or left column using keyboard commands', async () => {
    const copy = vi.fn(async (_copies: CellCopy[]) => ({}));
    const { grid, key } = setup({ A1: { value: '=B1' } }, copy);
    grid.selectRange({ row: 0, column: 0 }, { row: 2, column: 0 });
    expect(key('d', { metaKey: true }).defaultPrevented).toBe(true);
    expect(copy.mock.calls[0][0].map((item) => item.to)).toEqual([
      { row: 1, column: 0 },
      { row: 2, column: 0 },
    ]);
    await Promise.resolve();
    grid.selectRange({ row: 0, column: 0 }, { row: 0, column: 2 });
    expect(key('r', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(copy.mock.calls[1][0].map((item) => item.to)).toEqual([
      { row: 0, column: 1 },
      { row: 0, column: 2 },
    ]);
    await Promise.resolve();
  });

  it.each(['selection', 'edit', 'permission', 'remote'] as const)(
    'does not apply a delayed fill after a %s change',
    async (change) => {
      let finish!: (edits: SpreadsheetCellEdits) => void;
      const pending = new Promise<SpreadsheetCellEdits>((resolve) => {
        finish = resolve;
      });
      const { grid, cells, setCanEdit, setCells } = setup(
        { A1: { value: '=B1' } },
        () => pending
      );
      grid.selectRange({ row: 0, column: 0 }, { row: 1, column: 0 });
      grid.fillDirection('down');
      if (change === 'selection') grid.select({ row: 2, column: 0 });
      if (change === 'edit') grid.beginEdit('cell', 'new draft');
      if (change === 'permission') setCanEdit(false);
      if (change === 'remote') setCells({ A2: { value: 'collaborator' } });
      finish({ A2: { value: '=B2' } });
      await Promise.resolve();
      expect(cells().A2?.value).toBe(
        change === 'remote' ? 'collaborator' : undefined
      );
    }
  );
});

it('bounds navigation to added rows and cancels a draft when empty rows are removed', async () => {
  const { grid, setRowCount, setCells, key } = setup();
  setRowCount(300);
  grid.select({ row: 299, column: 25 });
  key('ArrowDown');
  expect(grid.activeAddress()).toBe('Z300');
  grid.beginEdit('cell', 'uncommitted draft');
  setRowCount(200);
  await Promise.resolve();
  expect(grid.activeAddress()).toBe('Z200');
  expect(grid.editing()).toBeUndefined();
  grid.commit();
  expect(setCells).not.toHaveBeenCalled();
});

function crossSheetSetup() {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const [sheetId, setSheetId] = createSignal('summary');
    const [sheets, setSheets] = createSignal([
      { id: 'summary', name: 'Summary' },
      { id: 'inputs', name: "Owner's budget" },
    ]);
    const [books, setBooks] = createSignal<Record<string, SpreadsheetCells>>({
      summary: { B4: { value: 'before' } },
      inputs: {
        A1: { value: '10' },
        A2: { value: '20' },
        B4: { value: 'leave me' },
      },
    });
    const [canEdit, setCanEdit] = createSignal(true);
    const setSheetCells = vi.fn((id: string, edits: SpreadsheetCellEdits) => {
      if (!sheets().some((sheet) => sheet.id === id)) return;
      const cells = { ...books()[id] };
      for (const [address, value] of Object.entries(edits)) {
        if (value) cells[address] = { ...cells[address], ...value };
      }
      setBooks({ ...books(), [id]: cells });
    });
    const grid = createGridController({
      cells: () => books()[sheetId()],
      sheetId,
      sheets,
      setActiveSheet: setSheetId,
      setSheetCells,
      setCells: (edits) => setSheetCells(sheetId(), edits),
      canEdit,
      undo: () => {},
      redo: () => {},
    });
    return {
      grid,
      books,
      sheetId,
      setSheetId,
      setSheets,
      setCanEdit,
      setSheetCells,
    };
  });
}

describe('cross-sheet formula editing', () => {
  it('keeps the draft while changing tabs and commits the escaped range to its original sheet', () => {
    const view = crossSheetSetup();
    view.grid.select({ row: 3, column: 1 });
    view.grid.beginEdit('cell', '=SUM(');
    view.grid.switchSheet('inputs');
    expect(view.sheetId()).toBe('inputs');
    expect(view.grid.editing()).toBe('formula');
    expect(view.grid.editingAddress()).toBe('B4');
    expect(view.grid.isEditingActiveSheet()).toBe(false);
    expect(view.grid.beginReference({ row: 0, column: 0 })).toBe(true);
    view.grid.updateReference({ row: 1, column: 0 });
    view.grid.endReference();
    expect(view.grid.draft()).toBe("=SUM('Owner''s budget'!A1:A2");
    view.grid.beginEdit('formula');
    expect(view.grid.draft()).toBe("=SUM('Owner''s budget'!A1:A2");
    view.grid.setDraft(view.grid.draft() + ')');
    view.grid.commit();
    expect(view.books().summary.B4.value).toBe("=SUM('Owner''s budget'!A1:A2)");
    expect(view.books().inputs.B4.value).toBe('leave me');
    expect(view.sheetId()).toBe('summary');
    expect(view.grid.activeAddress()).toBe('B4');
  });

  it('replaces a prior reference when choosing another sheet and omits the qualifier on the origin', () => {
    const view = crossSheetSetup();
    view.grid.beginEdit('formula', '=');
    view.grid.switchSheet('inputs');
    view.grid.beginReference({ row: 0, column: 0 });
    view.grid.endReference();
    view.grid.switchSheet('summary');
    expect(view.grid.referenceSelection()).toBeUndefined();
    view.grid.beginReference({ row: 0, column: 1 });
    view.grid.endReference();
    expect(view.grid.draft()).toBe('=B1');
    view.grid.cancel();
    expect(view.setSheetCells).not.toHaveBeenCalled();
  });

  it('cancels if the origin is removed, restores the origin on Escape, and rejects revoked permission', () => {
    const view = crossSheetSetup();
    view.grid.beginEdit('cell', '=SUM(');
    view.grid.switchSheet('inputs');
    view.grid.cancel();
    expect(view.sheetId()).toBe('summary');
    view.grid.beginEdit('cell', '=');
    view.grid.switchSheet('inputs');
    view.grid.beginReference({ row: 0, column: 0 });
    view.grid.endReference();
    view.setCanEdit(false);
    view.grid.commit();
    expect(view.setSheetCells).not.toHaveBeenCalled();
    view.setCanEdit(true);
    view.grid.beginEdit('cell', '=');
    view.grid.switchSheet('inputs');
    view.setSheets([{ id: 'inputs', name: 'Inputs' }]);
    expect(view.grid.editing()).toBeUndefined();
    view.grid.commit();
    expect(view.setSheetCells).not.toHaveBeenCalled();
  });

  it('commits non-formulas during normal tab navigation and cancels on unrequested sheet changes', () => {
    const view = crossSheetSetup();
    view.grid.beginEdit('cell', 'New value');
    view.grid.switchSheet('inputs');
    expect(view.books().summary.A1.value).toBe('New value');
    view.grid.beginEdit('cell', '=SUM(');
    view.setSheetId('summary');
    expect(view.grid.editing()).toBeUndefined();
    expect(view.books().inputs.A1.value).toBe('10');
  });
});

it('fills literal series immediately and keeps keyboard fill-down as a copy', async () => {
  const view = setup({ A1: { value: '1' }, A2: { value: '2' } });
  const source = {
    anchor: { row: 0, column: 0 },
    focus: { row: 1, column: 0 },
  };
  const target = {
    anchor: { row: 0, column: 0 },
    focus: { row: 3, column: 0 },
  };
  const done = view.grid.fill(source, target);
  expect(view.cells().A3.value).toBe('3');
  expect(view.cells().A4.value).toBe('4');
  await done;
  view.grid.selectRange({ row: 0, column: 0 }, { row: 3, column: 0 });
  view.key('d', { ctrlKey: true });
  expect(view.cells().A4.value).toBe('1');
});

it('interprets newly typed percentage points without rescaling unchanged stored percentages', () => {
  const view = setup({ A1: { value: '0.05', format: 'percent' } });
  view.grid.beginEdit('cell');
  expect(view.grid.draft()).toBe('5%');
  view.grid.commit();
  expect(view.setCells).not.toHaveBeenCalled();
  view.key('7');
  view.grid.commit();
  expect(view.cells().A1.value).toBe('7%');
  view.grid.beginEdit('formula', '=5/100');
  view.grid.commit();
  expect(view.cells().A1.value).toBe('=5/100');
});

it('moves from the active cell after whole-row or whole-column selections, not the far edge', () => {
  const { grid, key } = setup();
  grid.selectRange({ row: 0, column: 2 }, { row: 199, column: 2 });
  key('ArrowDown');
  expect(grid.activeAddress()).toBe('C2');
  grid.selectRange({ row: 4, column: 0 }, { row: 4, column: 25 });
  key('ArrowRight');
  expect(grid.activeAddress()).toBe('B5');
});
