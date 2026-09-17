import { LoroDoc, UndoManager } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  appendSpreadsheetRows,
  isSpreadsheetCellStyle,
  parseCellAddress,
  readSpreadsheetCells,
  readSpreadsheetLayout,
  resizeSpreadsheetColumn,
  SPREADSHEET_DEFAULT_STYLE,
  type SpreadsheetCellStyle,
  writeSpreadsheetCells,
} from './spreadsheet-document';

function synchronize(left: LoroDoc, right: LoroDoc) {
  const leftUpdate = left.export({ mode: 'update' });
  const rightUpdate = right.export({ mode: 'update' });
  left.import(rightUpdate);
  right.import(leftUpdate);
}

describe('spreadsheet document', () => {
  it('merges appended rows and column widths and preserves occupied rows across undo', () => {
    const alice = new LoroDoc();
    const bob = new LoroDoc();
    const history = new UndoManager(alice, { mergeInterval: 0 });
    appendSpreadsheetRows(alice, 100);
    appendSpreadsheetRows(bob, 100);
    resizeSpreadsheetColumn(bob, 2, 240);
    synchronize(alice, bob);
    expect(readSpreadsheetLayout(alice)).toEqual({
      rowCount: 400,
      columnWidths: { 2: 240 },
    });
    writeSpreadsheetCells(bob, { A400: { value: 'collaborator' } });
    synchronize(alice, bob);
    history.undo();
    expect(readSpreadsheetLayout(alice).rowCount).toBe(400);
    const reopened = new LoroDoc();
    reopened.import(alice.export({ mode: 'snapshot' }));
    expect(readSpreadsheetLayout(reopened)).toEqual(
      readSpreadsheetLayout(alice)
    );
    appendSpreadsheetRows(reopened, 10_000);
    expect(readSpreadsheetLayout(reopened).rowCount).toBe(1000);
    history.free();
    alice.free();
    bob.free();
    reopened.free();
  });
  it('merges edits to distinct cells from initially empty peers', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    writeSpreadsheetCells(left, { A1: { value: 'Revenue' } });
    writeSpreadsheetCells(right, { B1: { value: '=SUM(B2:B10)' } });
    synchronize(left, right);
    expect(readSpreadsheetCells(left)).toEqual({
      A1: { value: 'Revenue' },
      B1: { value: '=SUM(B2:B10)' },
    });
    expect(readSpreadsheetCells(right)).toEqual(readSpreadsheetCells(left));
    left.free();
    right.free();
  });

  it('preserves simultaneous value and formatting edits to the same cell', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    writeSpreadsheetCells(left, { A1: { value: '42' } });
    writeSpreadsheetCells(right, { A1: { bold: true, format: 'currency' } });
    synchronize(left, right);
    expect(readSpreadsheetCells(left).A1).toEqual({
      value: '42',
      bold: true,
      format: 'currency',
    });
    expect(readSpreadsheetCells(right)).toEqual(readSpreadsheetCells(left));
    left.free();
    right.free();
  });

  it('resolves concurrent edits to one value identically on both peers', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    writeSpreadsheetCells(left, { A1: { value: 'first' } });
    writeSpreadsheetCells(right, { A1: { value: 'second' } });
    synchronize(left, right);
    expect(readSpreadsheetCells(left)).toEqual(readSpreadsheetCells(right));
    expect(['first', 'second']).toContain(readSpreadsheetCells(left).A1.value);
    left.free();
    right.free();
  });

  it('undoes one local batch while preserving a collaborators edits', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    const undo = new UndoManager(left, { mergeInterval: 0 });
    writeSpreadsheetCells(left, { A1: { value: '1' }, A2: { value: '2' } });
    writeSpreadsheetCells(right, { B1: { value: 'from collaborator' } });
    synchronize(left, right);
    expect(undo.canUndo()).toBe(true);
    undo.undo();
    expect(readSpreadsheetCells(left)).toEqual({
      B1: { value: 'from collaborator' },
    });
    undo.redo();
    expect(readSpreadsheetCells(left)).toEqual({
      A1: { value: '1' },
      A2: { value: '2' },
      B1: { value: 'from collaborator' },
    });
    undo.free();
    left.free();
    right.free();
  });

  it('round trips formulas and formatting through a snapshot', () => {
    const original = new LoroDoc();
    writeSpreadsheetCells(original, {
      C4: { value: '=A1*2', format: 'percent', bold: true },
    });
    const reopened = new LoroDoc();
    reopened.import(original.export({ mode: 'snapshot' }));
    expect(readSpreadsheetCells(reopened)).toEqual(
      readSpreadsheetCells(original)
    );
    original.free();
    reopened.free();
  });

  it('reopens all formatting fields and clears style without changing values', () => {
    const original = new LoroDoc();
    const style: Required<SpreadsheetCellStyle> = {
      bold: true,
      italic: true,
      underline: true,
      strikethrough: true,
      fontFamily: 'mono',
      fontSize: 24,
      textColor: '#123aBc',
      fillColor: '#FEDCBA',
      horizontalAlign: 'center',
      verticalAlign: 'bottom',
      wrap: true,
      borderTop: true,
      borderRight: true,
      borderBottom: true,
      borderLeft: true,
      decimals: 4,
      format: 'scientific',
    };
    writeSpreadsheetCells(original, {
      A1: { value: '=1/3', ...style },
      A300: { italic: true },
    });
    const reopened = new LoroDoc();
    reopened.import(original.export({ mode: 'snapshot' }));
    expect(readSpreadsheetCells(reopened).A1).toEqual({
      value: '=1/3',
      ...style,
    });
    expect(readSpreadsheetLayout(reopened).rowCount).toBe(300);
    const history = new UndoManager(reopened, { mergeInterval: 0 });
    writeSpreadsheetCells(reopened, { A1: SPREADSHEET_DEFAULT_STYLE });
    expect(readSpreadsheetCells(reopened).A1).toEqual({ value: '=1/3' });
    history.undo();
    expect(readSpreadsheetCells(reopened).A1).toEqual({
      value: '=1/3',
      ...style,
    });
    history.redo();
    expect(readSpreadsheetCells(reopened).A1).toEqual({ value: '=1/3' });
    writeSpreadsheetCells(reopened, { A300: null });
    expect(readSpreadsheetCells(reopened).A300).toBeUndefined();
    history.free();
    original.free();
    reopened.free();
  });

  it('merges independent style changes and undoes only local formatting', () => {
    const alice = new LoroDoc();
    const bob = new LoroDoc();
    writeSpreadsheetCells(alice, { A1: { value: '42' } });
    synchronize(alice, bob);
    const history = new UndoManager(alice, { mergeInterval: 0 });
    writeSpreadsheetCells(alice, {
      A1: { italic: true, fillColor: '#ff8800' },
    });
    writeSpreadsheetCells(bob, {
      A1: { value: '43', fontFamily: 'serif', decimals: 3, borderLeft: true },
    });
    synchronize(alice, bob);
    expect(readSpreadsheetCells(alice).A1).toEqual({
      value: '43',
      italic: true,
      fillColor: '#ff8800',
      fontFamily: 'serif',
      decimals: 3,
      borderLeft: true,
    });
    expect(readSpreadsheetCells(alice)).toEqual(readSpreadsheetCells(bob));
    history.undo();
    expect(readSpreadsheetCells(alice).A1).toEqual({
      value: '43',
      fontFamily: 'serif',
      decimals: 3,
      borderLeft: true,
    });
    history.free();
    alice.free();
    bob.free();
  });

  it('validates local and remote styles including defaults and color injection', () => {
    const doc = new LoroDoc();
    expect(isSpreadsheetCellStyle(SPREADSHEET_DEFAULT_STYLE)).toBe(true);
    for (const style of [
      { italic: 1 },
      { fontSize: 37 },
      { fontSize: 9.5 },
      { decimals: 11 },
      { fontFamily: 'url(evil)' },
      { horizontalAlign: 'justify' },
      { textColor: 'red' },
      { fillColor: '#fff; background: url(evil)' },
      { borderTop: 'true' },
      { wrap: null },
    ])
      expect(isSpreadsheetCellStyle(style)).toBe(false);
    doc.getMap('spreadsheetValues').set('A1', 'safe');
    doc.getMap('spreadsheetFontSize').set('A1', 1000);
    doc.getMap('spreadsheetFillColor').set('A1', 'url(evil)');
    doc.getMap('spreadsheetItalic').set('A1', true);
    doc.commit();
    expect(readSpreadsheetCells(doc).A1).toEqual({
      value: 'safe',
      italic: true,
    });
    expect(() =>
      writeSpreadsheetCells(doc, {
        B1: { value: 'not applied' },
        C1: { fontSize: 100 },
      })
    ).toThrow('invalid formatting');
    expect(readSpreadsheetCells(doc).B1).toBeUndefined();
    doc.free();
  });

  it('rejects oversized batches before applying any edits', () => {
    const doc = new LoroDoc();
    expect(() =>
      writeSpreadsheetCells(doc, {
        A1: { value: 'must not be written' },
        A2: { value: 'x'.repeat(10_001) },
      })
    ).toThrow('10,000 characters');
    expect(readSpreadsheetCells(doc)).toEqual({});
    doc.free();
  });

  it('validates the bounded A1 addressing contract', () => {
    expect(parseCellAddress('A1')).toEqual({ row: 0, column: 0 });
    expect(parseCellAddress('Z200')).toEqual({ row: 199, column: 25 });
    for (const address of ['A0', 'A1001', 'AA1', '__proto__', 'a1']) {
      expect(parseCellAddress(address)).toBeUndefined();
    }
  });
});
