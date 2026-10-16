import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { moveWorkbookRange } from '@macro-inc/spreadsheet/workbook-structure';
import { LoroDoc } from 'loro-crdt';
import { createRoot } from 'solid-js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  readSpreadsheetCells,
  writeSpreadsheetCells,
} from '../core/spreadsheet-document';
import { createRangeMove } from './create-range-move';
import { createSpreadsheetStore } from './create-spreadsheet-store';

beforeAll(() =>
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  })
);
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
});

function setup(
  cells: Parameters<typeof writeSpreadsheetCells>[1] = {
    A1: { value: '10', bold: true },
    A2: { value: '20' },
    B1: { value: '=SUM(A1:A2)' },
    C1: { value: 'Taken' },
  }
) {
  const doc = new LoroDoc();
  cleanups.push(() => doc.free());
  writeSpreadsheetCells(doc, cells);
  return createRoot((dispose) => {
    cleanups.unshift(dispose);
    const store = createSpreadsheetStore({
      canEdit: () => true,
      source: {
        doc: () => doc,
        ready: () => true,
        error: () => undefined,
        status: () => 'connected',
        peers: () => [],
        setSelection: () => {},
      },
    });
    const select = vi.fn();
    const setNotice = vi.fn();
    const setBusy = vi.fn();
    const rangeMove = createRangeMove({
      store,
      canMove: () => true,
      moveRange: async (sheets, move) => moveWorkbookRange(sheets, move),
      setBusy,
      setNotice,
      select,
    });
    return { doc, store, rangeMove, select, setNotice, setBusy };
  });
}
const firstColumn = {
  anchor: { row: 0, column: 0 },
  focus: { row: 1, column: 0 },
};

describe('moving selected cells', () => {
  it('moves into empty cells as one undo step and selects them', async () => {
    const { store, rangeMove, select, setBusy } = setup();
    await rangeMove.move(firstColumn, 0, 3);
    expect(store.cells().A1).toBeUndefined();
    expect(store.cells().D1).toEqual({ value: '10', bold: true });
    expect(store.cells().D2).toEqual({ value: '20' });
    expect(store.cells().B1.value).toBe('=SUM(D1:D2)');
    expect(select).toHaveBeenCalledWith(
      { row: 0, column: 3 },
      { row: 1, column: 3 }
    );
    expect(setBusy.mock.calls).toEqual([[true], [false]]);
    store.undo();
    expect(store.cells().A1).toEqual({ value: '10', bold: true });
    expect(store.cells().B1.value).toBe('=SUM(A1:A2)');
    expect(store.cells().D1).toBeUndefined();
    expect(store.canUndo()).toBe(false);
  });

  it('asks before replacing values, and cancelling keeps every cell', async () => {
    const { store, rangeMove } = setup();
    expect(rangeMove.move(firstColumn, 0, 2)).toBeUndefined();
    expect(rangeMove.confirming()?.move).toEqual({
      sheetId: 'sheet1',
      source: { top: 0, left: 0, bottom: 1, right: 0 },
      rows: 0,
      columns: 2,
    });
    rangeMove.cancel();
    expect(rangeMove.confirming()).toBeUndefined();
    expect(store.cells().A1.value).toBe('10');
    expect(store.cells().C1.value).toBe('Taken');
    rangeMove.move(firstColumn, 0, 2);
    await rangeMove.confirm();
    expect(store.cells().A1).toBeUndefined();
    expect(store.cells().C1).toEqual({ value: '10', bold: true });
    expect(store.cells().B1.value).toBe('=SUM(C1:C2)');
  });

  it('moves whole-row references with rows selected by their headers', async () => {
    const { store, rangeMove } = setup({
      A1: { value: '10' },
      B2: { value: '20' },
      A10: { value: '=SUM(1:2)+SUM($1:$2)+SUM(A1:B2)' },
    });
    // A row-header selection ends at the sheet's last column.
    const rows = {
      anchor: { row: 0, column: 0 },
      focus: { row: 1, column: store.columnCount() - 1 },
    };
    await rangeMove.move(rows, 3, 0);
    expect(store.cells().A4).toEqual({ value: '10' });
    expect(store.cells().B5).toEqual({ value: '20' });
    expect(store.cells().A10.value).toBe('=SUM(4:5)+SUM($4:$5)+SUM(A4:B5)');
  });

  it("cancels a confirmed move after a collaborator's edit and keeps both", async () => {
    const { doc, store, rangeMove, setNotice } = setup();
    rangeMove.move(firstColumn, 0, 2);
    const peer = new LoroDoc();
    cleanups.push(() => peer.free());
    peer.import(doc.export({ mode: 'snapshot' }));
    writeSpreadsheetCells(peer, { E5: { value: 'From a collaborator' } });
    doc.import(peer.export({ mode: 'update' }));
    await rangeMove.confirm();
    expect(setNotice).toHaveBeenCalledWith(
      'The workbook changed while moving cells. No changes were applied; try again.'
    );
    expect(readSpreadsheetCells(doc).A1.value).toBe('10');
    expect(readSpreadsheetCells(doc).C1.value).toBe('Taken');
    expect(store.cells().E5.value).toBe('From a collaborator');
  });
});
