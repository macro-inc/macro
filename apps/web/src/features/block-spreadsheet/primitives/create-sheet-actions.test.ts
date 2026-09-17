import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CellCopy, SpreadsheetCalculation } from '../core/calculation';
import { cellAddress } from '../core/grid-selection';
import {
  SPREADSHEET_DEFAULT_STYLE,
  type SpreadsheetCellEdits,
  type SpreadsheetCells,
} from '../core/spreadsheet-document';
import { createGridController } from './create-grid-controller';
import { createSheetActions } from './create-sheet-actions';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function setup(
  initial: SpreadsheetCells = {},
  calculated: SpreadsheetCalculation = {}
) {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const [cells, updateCells] = createSignal(initial);
    const [canEdit, setCanEdit] = createSignal(true);
    const [busy, setBusy] = createSignal(false);
    const [rowCount, setRowCount] = createSignal(200);
    const setCells = vi.fn((edits: SpreadsheetCellEdits) => {
      const next = { ...cells() };
      for (const [address, edit] of Object.entries(edits)) {
        if (edit === null) delete next[address];
        else next[address] = { ...(next[address] ?? { value: '' }), ...edit };
      }
      updateCells(next);
    });
    const copyCells = vi.fn(
      async (copies: CellCopy[]): Promise<SpreadsheetCellEdits> =>
        Object.fromEntries(
          copies.map((copy) => [
            cellAddress(copy.to),
            { ...SPREADSHEET_DEFAULT_STYLE, ...copy.cell },
          ])
        )
    );
    const appendRows = vi.fn((count: number) => {
      setRowCount((value) => Math.min(1000, value + count));
    });
    const readClipboard = vi.fn(async () => 'pasted');
    const writeClipboard = vi.fn(async (_text: string) => {});
    const grid = createGridController({
      cells,
      canEdit,
      rowCount,
      setCells,
      copyCells,
      undo: vi.fn(),
      redo: vi.fn(),
    });
    const actions = createSheetActions(
      {
        cells,
        canEdit,
        rowCount,
        setCells,
        copyCells,
        appendRows,
        values: () => calculated,
        busy,
        readClipboard,
        writeClipboard,
      },
      grid
    );
    return {
      actions,
      grid,
      cells,
      setCells,
      updateCells,
      setCanEdit,
      setBusy,
      setRowCount,
      appendRows,
      copyCells,
      readClipboard,
      writeClipboard,
      dispose,
    };
  });
}

describe('spreadsheet menu actions', () => {
  it('uses formula-aware copying to move full rows and applies the result as one batch', async () => {
    const state = setup(
      {
        A1: { value: '10' },
        B1: { value: '=A1*2', italic: true },
        A2: { value: '2' },
        B2: { value: '=A2*2', fillColor: '#123456' },
      },
      { A1: { display: '10', number: 10 }, A2: { display: '2', number: 2 } }
    );
    state.grid.selectRange({ row: 0, column: 0 }, { row: 1, column: 1 });
    const translated = {
      A1: { ...SPREADSHEET_DEFAULT_STYLE, value: '2' },
      B1: {
        ...SPREADSHEET_DEFAULT_STYLE,
        value: '=A1*2',
        fillColor: '#123456',
      },
      A2: { ...SPREADSHEET_DEFAULT_STYLE, value: '10' },
      B2: { ...SPREADSHEET_DEFAULT_STYLE, value: '=A2*2', italic: true },
    };
    state.copyCells.mockResolvedValueOnce(translated);
    await state.actions.sort(false);
    expect(state.copyCells.mock.calls[0][0][1]).toEqual({
      from: { row: 1, column: 1 },
      to: { row: 0, column: 1 },
      cell: { value: '=A2*2', fillColor: '#123456' },
    });
    expect(state.setCells).toHaveBeenCalledExactlyOnceWith(translated);
    expect(state.cells().B1).toEqual(translated.B1);
    expect(state.actions.pending()).toBe(false);
  });

  it.each(['selection', 'remote', 'permission', 'draft', 'dispose'] as const)(
    'cancels a delayed sort after a %s change',
    async (change) => {
      const state = setup({ A1: { value: 'b' }, A2: { value: 'a' } });
      state.grid.selectRange({ row: 0, column: 0 }, { row: 1, column: 0 });
      const pending = deferred<SpreadsheetCellEdits>();
      state.copyCells.mockReturnValueOnce(pending.promise);
      const sort = state.actions.sort(false);
      await state.actions.sort(true);
      expect(state.copyCells).toHaveBeenCalledOnce();
      if (change === 'selection') state.grid.select({ row: 3, column: 0 });
      if (change === 'remote')
        state.updateCells({ ...state.cells(), A1: { value: 'collaborator' } });
      if (change === 'permission') state.setCanEdit(false);
      if (change === 'draft') state.grid.beginEdit('cell', 'new draft');
      if (change === 'dispose') state.dispose();
      pending.resolve({ A1: { value: 'a' }, A2: { value: 'b' } });
      await sort;
      expect(state.setCells).not.toHaveBeenCalled();
      if (change !== 'dispose') expect(state.actions.pending()).toBe(false);
      if (change === 'draft') expect(state.grid.draft()).toBe('new draft');
    }
  );

  it.each(['commit', 'undo', 'redo', 'cancelled-draft'] as const)(
    'cancels a delayed sort after a %s without changes to cells or selection',
    async (action) => {
      const state = setup({ A1: { value: 'b' }, A2: { value: 'a' } });
      state.grid.selectRange({ row: 0, column: 0 }, { row: 1, column: 0 });
      const pending = deferred<SpreadsheetCellEdits>();
      state.copyCells.mockReturnValueOnce(pending.promise);
      const sort = state.actions.sort(false);
      if (action === 'cancelled-draft') {
        state.grid.beginEdit('formula', 'unsaved');
        state.grid.cancel();
      } else state.grid[action]();
      pending.resolve({ A1: { value: 'a' }, A2: { value: 'b' } });
      await sort;
      expect(state.setCells).not.toHaveBeenCalled();
      expect(state.actions.pending()).toBe(false);
    }
  );

  it('does not erase a cut selection when clipboard permission fails', async () => {
    const state = setup({ A1: { value: 'keep me', bold: true } });
    state.writeClipboard.mockRejectedValueOnce(new Error('permission denied'));
    await state.actions.copy(true);
    expect(state.cells().A1.value).toBe('keep me');
    expect(state.setCells).not.toHaveBeenCalled();
    expect(state.actions.notice()).toContain('Clipboard access');
  });

  it.each([
    'draft',
    'selection',
    'permission',
    'remote',
    'undo',
    'redo',
    'cancelled-draft',
  ] as const)(
    'does not erase a delayed cut after a %s change',
    async (change) => {
      const state = setup({ A1: { value: 'keep me' } });
      const pending = deferred<void>();
      state.writeClipboard.mockReturnValueOnce(pending.promise);
      const cut = state.actions.copy(true);
      if (change === 'draft') state.grid.beginEdit('cell', 'new draft');
      if (change === 'selection') state.grid.select({ row: 1, column: 0 });
      if (change === 'permission') state.setCanEdit(false);
      if (change === 'remote')
        state.updateCells({ A1: { value: 'collaborator' } });
      if (change === 'undo' || change === 'redo') state.grid[change]();
      if (change === 'cancelled-draft') {
        state.grid.beginEdit('formula', 'unsaved');
        state.grid.cancel();
      }
      pending.resolve();
      await cut;
      expect(state.setCells).not.toHaveBeenCalled();
    }
  );

  it('does not paste clipboard data over a newly opened draft', async () => {
    const state = setup();
    const pending = deferred<string>();
    state.readClipboard.mockReturnValueOnce(pending.promise);
    const paste = state.actions.paste();
    state.grid.beginEdit('cell', 'draft');
    pending.resolve('old clipboard');
    await paste;
    expect(state.setCells).not.toHaveBeenCalled();
    expect(state.grid.draft()).toBe('draft');
  });

  it.each([
    'commit',
    'undo',
    'redo',
    'committed-draft',
    'cancelled-draft',
    'clear',
    'remote',
    'rows',
  ] as const)(
    'does not apply a delayed clipboard read after %s at the same selection',
    async (change) => {
      const state = setup({ A1: { value: 'keep me' } });
      const pending = deferred<string>();
      state.readClipboard.mockReturnValueOnce(pending.promise);
      const paste = state.actions.paste();
      if (
        change === 'commit' ||
        change === 'undo' ||
        change === 'redo' ||
        change === 'clear'
      )
        state.grid[change]();
      if (change === 'committed-draft' || change === 'cancelled-draft') {
        state.grid.beginEdit('formula', 'new text');
        if (change === 'committed-draft') state.grid.commit();
        else state.grid.cancel();
      }
      if (change === 'remote')
        state.updateCells({ A1: { value: 'collaborator' } });
      if (change === 'rows') state.setRowCount(300);
      const before = state.cells();
      const writes = state.setCells.mock.calls.length;
      pending.resolve('stale clipboard');
      await paste;
      expect(state.setCells).toHaveBeenCalledTimes(writes);
      expect(state.cells()).toBe(before);
    }
  );

  it('imports valid CSV in a single write and grows the sheet only after validation', () => {
    const state = setup({ A200: { value: 'old', italic: true } });
    state.grid.select({ row: 199, column: 0 });
    state.actions.importCsv('\uFEFF"one,two","multi\nline"\nnext');
    expect(state.appendRows).toHaveBeenCalledExactlyOnceWith(1);
    expect(state.setCells).toHaveBeenCalledOnce();
    expect(state.cells()).toEqual({
      A200: { value: 'one,two', italic: true },
      B200: { value: 'multi\nline' },
      A201: { value: 'next' },
      B201: { value: '' },
    });
    expect(state.grid.selection().focus).toEqual({ row: 200, column: 1 });
  });

  it('rejects invalid CSV before changing layout or any cell', () => {
    const state = setup({ A200: { value: 'keep' } });
    state.grid.select({ row: 199, column: 0 });
    for (const input of [
      '',
      '\uFEFF',
      'first\n"unclosed',
      `first\n${'x'.repeat(10_001)}`,
      Array.from({ length: 802 }, () => 'row').join('\n'),
    ])
      state.actions.importCsv(input);
    state.setRowCount(1000);
    state.grid.select({ row: 999, column: 25 });
    state.actions.importCsv('one,two');
    expect(state.setCells).not.toHaveBeenCalled();
    expect(state.appendRows).not.toHaveBeenCalled();
    expect(state.cells().A200.value).toBe('keep');
  });

  it('preserves formulas when replacing displayed matches but replaces text-formatted literals', () => {
    const state = setup(
      {
        A1: { value: '=SUM(B1:B2)' },
        A2: { value: 'sum.* sum.*', bold: true },
        A3: { value: '=sum.*', format: 'text' },
      },
      { A1: { display: 'sum.*' } }
    );
    state.actions.setQuery('sum.*');
    state.actions.setReplacement('$&');
    state.actions.replace(true);
    expect(state.cells()).toEqual({
      A1: { value: '=SUM(B1:B2)' },
      A2: { value: '$& $&', bold: true },
      A3: { value: '=$&', format: 'text' },
    });
    state.actions.setQuery('SUM(');
    state.actions.setReplacement('AVERAGE(');
    state.actions.changeFindOptions({ formulas: true });
    state.actions.replace(true);
    expect(state.cells().A1.value).toBe('=AVERAGE(B1:B2)');
  });

  it('continues single replacement from the original next match after removing the current match', () => {
    const state = setup({
      A1: { value: 'foo' },
      B1: { value: 'foo' },
      C1: { value: 'foo' },
    });
    state.grid.select({ row: 0, column: 1 });
    state.actions.setQuery('foo');
    state.actions.setReplacement('bar');
    state.actions.replace(false);
    expect(state.cells().B1.value).toBe('bar');
    expect(state.grid.activeAddress()).toBe('C1');
    state.actions.replace(false);
    expect(state.cells().C1.value).toBe('bar');
    expect(state.grid.activeAddress()).toBe('A1');
  });

  it.each(['keyboard-to-menu', 'menu-to-keyboard'] as const)(
    'preserves formula metadata for %s copy and paste',
    async (route) => {
      const state = setup(
        {
          A1: { value: '=C1*2', italic: true, fillColor: '#123456' },
          B2: { value: 'old', bold: true, format: 'percent' },
        },
        { A1: { display: '42', number: 42 } }
      );
      const translated = {
        B2: {
          ...SPREADSHEET_DEFAULT_STYLE,
          value: '=D2*2',
          italic: true,
          fillColor: '#123456',
        },
      };
      state.copyCells.mockResolvedValueOnce(translated);
      let text: string;
      if (route === 'keyboard-to-menu') text = state.actions.copyText();
      else {
        await state.actions.copy();
        text = state.writeClipboard.mock.calls[0][0];
      }
      expect(text).toBe('42');
      state.grid.select({ row: 1, column: 1 });
      if (route === 'keyboard-to-menu') {
        state.readClipboard.mockResolvedValueOnce(text);
        await state.actions.paste();
      } else state.actions.pasteText(text);
      await Promise.resolve();
      expect(state.copyCells).toHaveBeenCalledExactlyOnceWith([
        {
          from: { row: 0, column: 0 },
          to: { row: 1, column: 1 },
          cell: { value: '=C1*2', italic: true, fillColor: '#123456' },
        },
      ]);
      expect(state.cells().B2).toEqual(translated.B2);
    }
  );

  it.each(['keyboard-to-menu', 'menu-to-keyboard'] as const)(
    'preserves formula references and styles for %s cut and paste',
    async (route) => {
      const state = setup(
        {
          A1: { value: '=C1+$D$2', bold: true, fontSize: 20 },
          B2: { value: 'old', italic: true, fillColor: '#123456' },
        },
        { A1: { display: '42', number: 42 } }
      );
      let text: string;
      if (route === 'keyboard-to-menu') {
        text = state.actions.copyText(true);
        state.grid.clear();
      } else {
        await state.actions.copy(true);
        text = state.writeClipboard.mock.calls[0][0];
      }
      expect(text).toBe('=C1+$D$2');
      expect(state.cells().A1.value).toBe('');
      state.grid.select({ row: 1, column: 1 });
      if (route === 'keyboard-to-menu') {
        state.readClipboard.mockResolvedValueOnce(text);
        await state.actions.paste();
      } else state.actions.pasteText(text);
      await Promise.resolve();
      expect(state.copyCells).not.toHaveBeenCalled();
      expect(state.cells().B2).toEqual({
        ...SPREADSHEET_DEFAULT_STYLE,
        value: '=C1+$D$2',
        bold: true,
        fontSize: 20,
      });
    }
  );

  it('uses explicit keyboard clipboard metadata before a matching local cache', async () => {
    const state = setup(
      { A1: { value: '=B1', italic: true } },
      { A1: { display: '42', number: 42 } }
    );
    state.actions.copyText();
    state.grid.select({ row: 1, column: 1 });
    const external = JSON.stringify({
      version: 1,
      top: 2,
      left: 2,
      cells: [[{ value: '=D3', bold: true }]],
    });
    state.actions.pasteText('42', external);
    await Promise.resolve();
    expect(state.copyCells.mock.calls[0][0]).toEqual([
      {
        from: { row: 2, column: 2 },
        to: { row: 1, column: 1 },
        cell: { value: '=D3', bold: true },
      },
    ]);
  });

  it('keeps the previous clipboard snapshot if a later menu copy fails', async () => {
    const state = setup(
      { A1: { value: '=B1', italic: true }, C1: { value: '=D1', bold: true } },
      { A1: { display: '42', number: 42 }, C1: { display: '42', number: 42 } }
    );
    state.actions.copyText();
    state.grid.select({ row: 0, column: 2 });
    state.writeClipboard.mockRejectedValueOnce(new Error('permission denied'));
    await state.actions.copy();
    state.grid.select({ row: 1, column: 1 });
    state.actions.pasteText('42');
    await Promise.resolve();
    expect(state.copyCells.mock.calls[0][0][0].cell).toEqual({
      value: '=B1',
      italic: true,
    });
  });

  it('pastes displayed values only without source formula metadata or styles', async () => {
    const state = setup(
      { A1: { value: '=B1', italic: true }, C1: { value: 'old', bold: true } },
      { A1: { display: '42', number: 42 } }
    );
    const text = state.actions.copyText();
    state.grid.select({ row: 0, column: 2 });
    state.readClipboard.mockResolvedValueOnce(text);
    await state.actions.paste(true);
    expect(state.copyCells).not.toHaveBeenCalled();
    expect(state.cells().C1).toEqual({ value: '42', bold: true });
  });

  it('rejects an oversized replacement before writing earlier valid matches', () => {
    const state = setup({ A1: { value: 'x' }, A2: { value: 'xx' } });
    state.actions.setQuery('x');
    state.actions.setReplacement('y'.repeat(6000));
    state.actions.replace(true);
    expect(state.setCells).not.toHaveBeenCalled();
    expect(state.actions.notice()).toContain('10,000');
  });

  it('enforces read-only permissions across all mutations while keeping search and copy', async () => {
    const state = setup({ A1: { value: 'find' } });
    state.setCanEdit(false);
    state.actions.setQuery('find');
    state.actions.setReplacement('replace');
    state.actions.replace(true);
    state.actions.borders('all');
    state.actions.clearFormatting();
    state.actions.trimWhitespace();
    state.actions.insertFunction('SUM');
    state.actions.importCsv('replace');
    await state.actions.sort(false);
    await state.actions.paste();
    await state.actions.copy(true);
    expect(state.actions.matches()).toEqual(['A1']);
    expect(state.writeClipboard).toHaveBeenCalledWith('find');
    expect(state.readClipboard).not.toHaveBeenCalled();
    expect(state.copyCells).not.toHaveBeenCalled();
    expect(state.appendRows).not.toHaveBeenCalled();
    expect(state.setCells).not.toHaveBeenCalled();
  });
});
