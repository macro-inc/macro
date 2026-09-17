import { LoroDoc, UndoManager } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  appendSpreadsheetRows,
  DEFAULT_SHEET_ID,
  readSpreadsheetCells,
  readSpreadsheetLayout,
  resizeSpreadsheetColumn,
  writeSpreadsheetCells,
} from './spreadsheet-document';
import {
  addSpreadsheetSheet,
  deleteSpreadsheetSheet,
  duplicateSpreadsheetSheet,
  formulaReferencesSheet,
  importSpreadsheetSheets,
  readSpreadsheetSheets,
  readSpreadsheetWorkbook,
  renameSpreadsheetSheet,
  type SpreadsheetSheetInput,
} from './workbook-document';

function synchronize(left: LoroDoc, right: LoroDoc) {
  const a = left.export({ mode: 'update' });
  const b = right.export({ mode: 'update' });
  left.import(b);
  right.import(a);
}

const blank = (name: string): SpreadsheetSheetInput => ({
  name,
  cells: {},
  rowCount: 200,
  columnWidths: {},
});

function concurrentLastSheetDeletion() {
  const left = new LoroDoc();
  const right = new LoroDoc();
  writeSpreadsheetCells(left, { A1: { value: 'retained work' } });
  const otherId = addSpreadsheetSheet(left, 'Other');
  synchronize(left, right);
  deleteSpreadsheetSheet(left, DEFAULT_SHEET_ID);
  deleteSpreadsheetSheet(right, otherId);
  synchronize(left, right);
  return { left, right, otherId };
}

describe('collaborative workbook', () => {
  it('opens legacy cells and layout as Sheet1 without adding operations', () => {
    const doc = new LoroDoc();
    writeSpreadsheetCells(doc, { A1: { value: 'legacy', italic: true } });
    resizeSpreadsheetColumn(doc, 0, 180);
    appendSpreadsheetRows(doc, 100);
    const version = doc.version().toJSON();
    expect(readSpreadsheetWorkbook(doc)).toEqual([
      {
        id: DEFAULT_SHEET_ID,
        name: 'Sheet1',
        cells: { A1: { value: 'legacy', italic: true } },
        layout: { rowCount: 300, columnWidths: { 0: 180 } },
      },
    ]);
    expect(doc.version().toJSON()).toEqual(version);
    doc.free();
  });

  it('isolates equal cell addresses and dimensions across stable sheet IDs', () => {
    const doc = new LoroDoc();
    const id = addSpreadsheetSheet(doc, 'Budget');
    writeSpreadsheetCells(doc, { A1: { value: 'original' } });
    writeSpreadsheetCells(doc, { A1: { value: 'second', bold: true } }, id);
    resizeSpreadsheetColumn(doc, 0, 320, id);
    appendSpreadsheetRows(doc, 50, id);
    expect(readSpreadsheetCells(doc).A1).toEqual({ value: 'original' });
    expect(readSpreadsheetCells(doc, id).A1).toEqual({
      value: 'second',
      bold: true,
    });
    expect(readSpreadsheetLayout(doc).rowCount).toBe(200);
    expect(readSpreadsheetLayout(doc, id)).toEqual({
      rowCount: 250,
      columnWidths: { 0: 320 },
    });
    renameSpreadsheetSheet(doc, id, 'Forecast');
    expect(readSpreadsheetSheets(doc)[1]).toEqual({ id, name: 'Forecast' });
    expect(readSpreadsheetCells(doc, id).A1.value).toBe('second');
    doc.free();
  });

  it('merges independent styles, cells and appended rows on a new shared sheet', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    const id = addSpreadsheetSheet(left, 'Shared');
    synchronize(left, right);
    writeSpreadsheetCells(left, { A1: { value: '42' } }, id);
    writeSpreadsheetCells(
      right,
      { A1: { italic: true }, B1: { value: '=A1' } },
      id
    );
    appendSpreadsheetRows(left, 10, id);
    appendSpreadsheetRows(right, 20, id);
    synchronize(left, right);
    expect(readSpreadsheetWorkbook(left)).toEqual(
      readSpreadsheetWorkbook(right)
    );
    expect(readSpreadsheetCells(left, id).A1).toEqual({
      value: '42',
      italic: true,
    });
    expect(readSpreadsheetLayout(left, id).rowCount).toBe(230);
    left.free();
    right.free();
  });

  it('preserves both concurrent same-name sheets with deterministic unique display names', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    const a = addSpreadsheetSheet(left, 'Budget');
    const b = addSpreadsheetSheet(right, 'Budget');
    writeSpreadsheetCells(left, { A1: { value: 'alice' } }, a);
    writeSpreadsheetCells(right, { A1: { value: 'bob' } }, b);
    synchronize(left, right);
    expect(readSpreadsheetWorkbook(left)).toEqual(
      readSpreadsheetWorkbook(right)
    );
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.name)).toEqual([
      'Sheet1',
      'Budget',
      'Budget (2)',
    ]);
    expect(readSpreadsheetCells(left, a).A1.value).toBe('alice');
    expect(readSpreadsheetCells(left, b).A1.value).toBe('bob');
    expect(() => addSpreadsheetSheet(left, 'budget')).toThrow('already exists');
    left.free();
    right.free();
  });

  it('does not take another sheet’s requested name when resolving concurrent collisions', () => {
    const doc = new LoroDoc();
    doc.getMap('spreadsheetSheetNames').set('a', 'Budget');
    doc.getMap('spreadsheetSheetNames').set('b', 'Budget');
    doc.getMap('spreadsheetSheetNames').set('c', 'Budget (2)');
    doc.commit();
    expect(readSpreadsheetSheets(doc).map((sheet) => sheet.name)).toEqual([
      'Sheet1',
      'Budget',
      'Budget (3)',
      'Budget (2)',
    ]);
    doc.free();
  });

  it('duplicates full cell styling and layout in a single undoable change', () => {
    const doc = new LoroDoc();
    writeSpreadsheetCells(doc, {
      A1: {
        value: '=B1+2',
        fillColor: '#abcdef',
        borderBottom: true,
        fontSize: 12,
      },
    });
    resizeSpreadsheetColumn(doc, 0, 220);
    appendSpreadsheetRows(doc, 30);
    const history = new UndoManager(doc, { mergeInterval: 0 });
    const id = duplicateSpreadsheetSheet(doc, DEFAULT_SHEET_ID);
    expect(readSpreadsheetCells(doc, id)).toEqual(readSpreadsheetCells(doc));
    expect(readSpreadsheetLayout(doc, id)).toEqual(readSpreadsheetLayout(doc));
    history.undo();
    expect(readSpreadsheetSheets(doc)).toHaveLength(1);
    history.redo();
    expect(readSpreadsheetCells(doc, id)).toEqual(readSpreadsheetCells(doc));
    history.free();
    doc.free();
  });

  it('retains collaborator edits when a deleted sheet is restored through local undo', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    const id = addSpreadsheetSheet(left, 'Shared');
    synchronize(left, right);
    const history = new UndoManager(left, { mergeInterval: 0 });
    deleteSpreadsheetSheet(left, id);
    writeSpreadsheetCells(right, { A1: { value: 'concurrent edit' } }, id);
    synchronize(left, right);
    expect(readSpreadsheetSheets(left)).toHaveLength(1);
    history.undo();
    expect(readSpreadsheetCells(left, id).A1.value).toBe('concurrent edit');
    expect(readSpreadsheetSheets(left)).toHaveLength(2);
    history.free();
    left.free();
    right.free();
  });

  it.each(['value', 'format', 'resize', 'rows'] as const)(
    'keeps peer %s changes visible when the creator undoes adding their sheet',
    (action) => {
      const left = new LoroDoc();
      const right = new LoroDoc();
      const history = new UndoManager(left, { mergeInterval: 0 });
      const id = addSpreadsheetSheet(left, 'Collaborative');
      synchronize(left, right);
      if (action === 'value')
        writeSpreadsheetCells(right, { A1: { value: 'peer work' } }, id);
      if (action === 'format')
        writeSpreadsheetCells(right, { A1: { bold: true } }, id);
      if (action === 'resize') resizeSpreadsheetColumn(right, 0, 320, id);
      if (action === 'rows') appendSpreadsheetRows(right, 100, id);
      const peerSheet = readSpreadsheetWorkbook(right).find(
        (sheet) => sheet.id === id
      );
      synchronize(left, right);
      history.undo();
      synchronize(left, right);
      expect(
        readSpreadsheetWorkbook(left).find((sheet) => sheet.id === id)
      ).toEqual(peerSheet);
      expect(readSpreadsheetWorkbook(right)).toEqual(
        readSpreadsheetWorkbook(left)
      );
      history.redo();
      expect(
        readSpreadsheetSheets(left).filter((sheet) => sheet.id === id)
      ).toHaveLength(1);
      history.free();
      left.free();
      right.free();
    }
  );

  it('preserves a newly added sheet used only by another peer’s formula when creation is undone', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    const history = new UndoManager(left, { mergeInterval: 0 });
    const id = addSpreadsheetSheet(left, "O'Brien");
    synchronize(left, right);
    writeSpreadsheetCells(right, { A1: { value: "='O''Brien'!A1" } });
    synchronize(left, right);
    history.undo();
    synchronize(left, right);
    expect(readSpreadsheetSheets(left)).toContainEqual({ id, name: "O'Brien" });
    expect(readSpreadsheetCells(left).A1.value).toBe("='O''Brien'!A1");
    expect(() => deleteSpreadsheetSheet(left, id)).toThrow(
      'referenced by a formula'
    );
    expect(readSpreadsheetWorkbook(right)).toEqual(
      readSpreadsheetWorkbook(left)
    );
    history.free();
    left.free();
    right.free();
  });

  it('keeps peer work and referenced sheet identities when undoing a replaced multi-sheet workbook', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    writeSpreadsheetCells(left, { A1: { value: 'original workbook' } });
    const history = new UndoManager(left, { mergeInterval: 0 });
    const [data, summary, unused] = importSpreadsheetSheets(
      left,
      [
        { ...blank('Data'), cells: { A1: { value: '10' } } },
        blank('Summary'),
        blank('Unused'),
      ],
      true
    );
    synchronize(left, right);
    writeSpreadsheetCells(
      right,
      { A1: { value: '=Data!A1' }, B1: { value: 'peer note' } },
      summary
    );
    synchronize(left, right);
    history.undo();
    synchronize(left, right);
    expect(readSpreadsheetSheets(left)).toContainEqual({
      id: data,
      name: 'Data',
    });
    expect(readSpreadsheetSheets(left)).toContainEqual({
      id: summary,
      name: 'Summary',
    });
    expect(
      readSpreadsheetSheets(left).some((sheet) => sheet.id === unused)
    ).toBe(false);
    expect(readSpreadsheetCells(left).A1.value).toBe('original workbook');
    expect(readSpreadsheetCells(left, summary).B1.value).toBe('peer note');
    expect(readSpreadsheetWorkbook(right)).toEqual(
      readSpreadsheetWorkbook(left)
    );
    history.free();
    left.free();
    right.free();
  });

  it('bounds identity retention to one record per peer and sheet, and removes unused creation on undo', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    const history = new UndoManager(left, { mergeInterval: 0 });
    const id = importSpreadsheetSheets(left, [
      {
        ...blank('Created'),
        cells: { A1: { value: 'seed' } },
        columnWidths: { 0: 200 },
      },
    ])[0];
    history.undo();
    expect(readSpreadsheetSheets(left).some((sheet) => sheet.id === id)).toBe(
      false
    );
    history.redo();
    synchronize(left, right);
    for (let index = 0; index < 10; index++)
      writeSpreadsheetCells(right, { B1: { value: String(index) } }, id);
    expect(
      Object.keys(right.getMap('spreadsheetSheetRetentions').toJSON())
    ).toHaveLength(2);
    synchronize(left, right);
    deleteSpreadsheetSheet(left, id);
    synchronize(left, right);
    expect(readSpreadsheetSheets(right).some((sheet) => sheet.id === id)).toBe(
      false
    );
    expect(
      Object.keys(left.getMap('spreadsheetSheetRetentions').toJSON())
    ).toHaveLength(0);
    writeSpreadsheetCells(right, { C1: { value: 'late hidden edit' } }, id);
    synchronize(left, right);
    expect(readSpreadsheetSheets(left).some((sheet) => sheet.id === id)).toBe(
      false
    );
    history.free();
    left.free();
    right.free();
  });

  it('keeps a deterministic final sheet after concurrent deletions', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    const id = addSpreadsheetSheet(left, 'Other');
    synchronize(left, right);
    deleteSpreadsheetSheet(left, DEFAULT_SHEET_ID);
    deleteSpreadsheetSheet(right, id);
    synchronize(left, right);
    expect(readSpreadsheetSheets(left)).toEqual([
      { id: DEFAULT_SHEET_ID, name: 'Sheet1' },
    ]);
    expect(readSpreadsheetSheets(right)).toEqual(readSpreadsheetSheets(left));
    expect(() => deleteSpreadsheetSheet(left, DEFAULT_SHEET_ID)).toThrow(
      'at least one'
    );
    left.free();
    right.free();
  });

  it('keeps new work in the retained fallback visible when another peer adds a sheet', () => {
    const { left, right } = concurrentLastSheetDeletion();
    const beforeRead = left.version().toJSON();
    expect(readSpreadsheetWorkbook(left)[0].cells.A1.value).toBe(
      'retained work'
    );
    expect(left.version().toJSON()).toEqual(beforeRead);
    expect(left.getMap('spreadsheetDeletedSheets').get(DEFAULT_SHEET_ID)).toBe(
      true
    );

    writeSpreadsheetCells(left, { A1: { value: 'new work' } });
    // The addition is concurrent with the edit: neither peer has received the
    // other's revival operation yet.
    const third = addSpreadsheetSheet(right, 'Third');
    synchronize(left, right);
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual([
      DEFAULT_SHEET_ID,
      third,
    ]);
    expect(readSpreadsheetWorkbook(left)).toEqual(
      readSpreadsheetWorkbook(right)
    );
    expect(readSpreadsheetCells(right).A1.value).toBe('new work');
    expect(left.getMap('spreadsheetDeletedSheets').get(DEFAULT_SHEET_ID)).toBe(
      false
    );
    left.free();
    right.free();
  });

  it.each(['add', 'append', 'duplicate'] as const)(
    'preserves the visible fallback on %s without an edit, in the same undo step',
    (action) => {
      const { left, right } = concurrentLastSheetDeletion();
      const history = new UndoManager(left, { mergeInterval: 0 });
      const added =
        action === 'add'
          ? addSpreadsheetSheet(left, 'Third')
          : action === 'append'
            ? importSpreadsheetSheets(left, [blank('Third')])[0]
            : duplicateSpreadsheetSheet(left, DEFAULT_SHEET_ID);
      synchronize(left, right);
      expect(readSpreadsheetSheets(right).map((sheet) => sheet.id)).toEqual([
        DEFAULT_SHEET_ID,
        added,
      ]);
      expect(readSpreadsheetCells(right).A1.value).toBe('retained work');
      expect(
        left.getMap('spreadsheetDeletedSheets').get(DEFAULT_SHEET_ID)
      ).toBe(false);
      history.undo();
      expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual([
        DEFAULT_SHEET_ID,
      ]);
      expect(
        left.getMap('spreadsheetDeletedSheets').get(DEFAULT_SHEET_ID)
      ).toBe(true);
      expect(history.canUndo()).toBe(false);
      history.redo();
      synchronize(left, right);
      expect(readSpreadsheetWorkbook(left)).toEqual(
        readSpreadsheetWorkbook(right)
      );
      expect(readSpreadsheetSheets(right).map((sheet) => sheet.id)).toEqual([
        DEFAULT_SHEET_ID,
        added,
      ]);
      history.free();
      left.free();
      right.free();
    }
  );

  it('keeps the peer’s fallback revival when undoing a concurrent local edit', () => {
    const { left, right } = concurrentLastSheetDeletion();
    const history = new UndoManager(left, { mergeInterval: 0 });
    writeSpreadsheetCells(left, { A1: { value: 'local work' } });
    const third = addSpreadsheetSheet(right, 'Third');
    synchronize(left, right);
    history.undo();
    synchronize(left, right);
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual([
      DEFAULT_SHEET_ID,
      third,
    ]);
    expect(readSpreadsheetWorkbook(right)).toEqual(
      readSpreadsheetWorkbook(left)
    );
    expect(readSpreadsheetCells(left).A1.value).toBe('retained work');
    history.free();
    left.free();
    right.free();
  });

  it('keeps later collaborator edits visible when undoing the original fallback revival', () => {
    const { left, right } = concurrentLastSheetDeletion();
    const history = new UndoManager(left, { mergeInterval: 0 });
    writeSpreadsheetCells(left, { A1: { value: 'local work' } });
    synchronize(left, right);
    writeSpreadsheetCells(right, { B1: { value: 'later peer work' } });
    const third = addSpreadsheetSheet(right, 'Third');
    synchronize(left, right);
    history.undo();
    synchronize(left, right);
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual([
      DEFAULT_SHEET_ID,
      third,
    ]);
    expect(readSpreadsheetCells(left).B1.value).toBe('later peer work');
    expect(readSpreadsheetCells(left).A1.value).toBe('retained work');
    history.free();
    left.free();
    right.free();
  });

  it('explicitly deletes a revived sheet by removing its observed revival markers', () => {
    const { left, right } = concurrentLastSheetDeletion();
    writeSpreadsheetCells(left, { A1: { value: 'new work' } });
    const third = addSpreadsheetSheet(left, 'Third');
    synchronize(left, right);
    const history = new UndoManager(left, { mergeInterval: 0 });
    deleteSpreadsheetSheet(left, DEFAULT_SHEET_ID);
    synchronize(left, right);
    expect(
      Object.values(left.getMap('spreadsheetSheetRevivals').toJSON())
    ).not.toContain(DEFAULT_SHEET_ID);
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual([
      third,
    ]);
    writeSpreadsheetCells(right, { B1: { value: 'late hidden edit' } });
    synchronize(left, right);
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual([
      third,
    ]);
    history.undo();
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual([
      DEFAULT_SHEET_ID,
      third,
    ]);
    expect(readSpreadsheetCells(left).B1.value).toBe('late hidden edit');
    history.free();
    left.free();
    right.free();
  });

  it('bounds revival markers per peer and keeps the original marker until its edit is undone', () => {
    const { left, right } = concurrentLastSheetDeletion();
    const history = new UndoManager(left, { mergeInterval: 0 });
    for (let index = 0; index < 10; index++)
      writeSpreadsheetCells(left, { A1: { value: String(index) } });
    const leftKey = `${DEFAULT_SHEET_ID}!${left.peerIdStr}`;
    expect(left.getMap('spreadsheetSheetRevivals').toJSON()).toEqual({
      [leftKey]: DEFAULT_SHEET_ID,
    });
    for (let index = 0; index < 9; index++) history.undo();
    expect(left.getMap('spreadsheetSheetRevivals').toJSON()).toEqual({
      [leftKey]: DEFAULT_SHEET_ID,
    });
    synchronize(left, right);
    for (let index = 0; index < 10; index++)
      writeSpreadsheetCells(right, { B1: { value: String(index) } });
    const third = addSpreadsheetSheet(right, 'Third');
    synchronize(left, right);
    expect(
      Object.keys(left.getMap('spreadsheetSheetRevivals').toJSON())
    ).toHaveLength(2);
    history.undo();
    synchronize(left, right);
    expect(left.getMap('spreadsheetSheetRevivals').toJSON()).toEqual({
      [`${DEFAULT_SHEET_ID}!${right.peerIdStr}`]: DEFAULT_SHEET_ID,
    });
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual([
      DEFAULT_SHEET_ID,
      third,
    ]);
    expect(readSpreadsheetCells(left).A1.value).toBe('retained work');
    expect(readSpreadsheetCells(left).B1.value).toBe('9');
    expect(history.canUndo()).toBe(false);
    history.free();
    left.free();
    right.free();
  });

  it('reads and explicitly removes legacy UUID revival markers', () => {
    const { left, right } = concurrentLastSheetDeletion();
    const legacyKey = crypto.randomUUID();
    left.getMap('spreadsheetSheetRevivals').set(legacyKey, DEFAULT_SHEET_ID);
    left.commit();
    const third = addSpreadsheetSheet(left, 'Third');
    synchronize(left, right);
    expect(readSpreadsheetSheets(right).map((sheet) => sheet.id)).toEqual([
      DEFAULT_SHEET_ID,
      third,
    ]);
    expect(left.getMap('spreadsheetSheetRevivals').get(legacyKey)).toBe(
      DEFAULT_SHEET_ID
    );
    deleteSpreadsheetSheet(right, DEFAULT_SHEET_ID);
    synchronize(left, right);
    expect(left.getMap('spreadsheetSheetRevivals').toJSON()).toEqual({});
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual([
      third,
    ]);
    left.free();
    right.free();
  });

  it.each(['value', 'format', 'resize', 'rows', 'rename'] as const)(
    'revives the retained fallback with its %s edit and undoes both atomically',
    (action) => {
      const { left, right } = concurrentLastSheetDeletion();
      const original = readSpreadsheetWorkbook(left);
      const history = new UndoManager(left, { mergeInterval: 0 });
      if (action === 'value')
        writeSpreadsheetCells(left, { A1: { value: 'new work' } });
      if (action === 'format')
        writeSpreadsheetCells(left, { A1: { bold: true } });
      if (action === 'resize') resizeSpreadsheetColumn(left, 0, 320);
      if (action === 'rows') appendSpreadsheetRows(left, 100);
      if (action === 'rename')
        renameSpreadsheetSheet(left, DEFAULT_SHEET_ID, 'Retained');
      expect(
        left.getMap('spreadsheetDeletedSheets').get(DEFAULT_SHEET_ID)
      ).toBe(false);
      const edited = readSpreadsheetWorkbook(left);
      expect(edited).not.toEqual(original);
      history.undo();
      expect(readSpreadsheetWorkbook(left)).toEqual(original);
      expect(
        left.getMap('spreadsheetDeletedSheets').get(DEFAULT_SHEET_ID)
      ).toBe(true);
      expect(history.canUndo()).toBe(false);
      history.redo();
      const third = addSpreadsheetSheet(right, 'Third');
      synchronize(left, right);
      expect(readSpreadsheetWorkbook(left)).toEqual(
        readSpreadsheetWorkbook(right)
      );
      expect(readSpreadsheetWorkbook(left)[0]).toEqual(edited[0]);
      expect(readSpreadsheetSheets(right).map((sheet) => sheet.id)).toEqual([
        DEFAULT_SHEET_ID,
        third,
      ]);
      history.free();
      left.free();
      right.free();
    }
  );

  it('never revives a hidden deleted sheet for a late value or layout operation', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    const deleted = addSpreadsheetSheet(left, 'Deleted');
    synchronize(left, right);
    deleteSpreadsheetSheet(left, deleted);
    synchronize(left, right);
    writeSpreadsheetCells(
      left,
      { A1: { value: 'late value', bold: true } },
      deleted
    );
    resizeSpreadsheetColumn(left, 0, 220, deleted);
    appendSpreadsheetRows(left, 10, deleted);
    expect(() => renameSpreadsheetSheet(left, deleted, 'Late rename')).toThrow(
      'no longer exists'
    );
    synchronize(left, right);
    expect(left.getMap('spreadsheetDeletedSheets').get(deleted)).toBe(true);
    expect(readSpreadsheetSheets(right).map((sheet) => sheet.id)).toEqual([
      DEFAULT_SHEET_ID,
    ]);
    left.free();
    right.free();
  });

  it('does not revive the fallback for invalid batches, empty edits, or workbook replacement', () => {
    const { left, right } = concurrentLastSheetDeletion();
    const version = left.version().toJSON();
    expect(() =>
      writeSpreadsheetCells(left, { A1: { value: 'x'.repeat(10_001) } })
    ).toThrow('10,000');
    expect(() =>
      importSpreadsheetSheets(left, [blank('Third'), blank('Third')])
    ).toThrow('already exists');
    writeSpreadsheetCells(left, {});
    writeSpreadsheetCells(left, { A1: {} });
    resizeSpreadsheetColumn(left, -1, 200);
    appendSpreadsheetRows(left, 0);
    left.commit();
    expect(left.version().toJSON()).toEqual(version);
    const replacement = importSpreadsheetSheets(
      left,
      [blank('Replacement')],
      true
    )[0];
    expect(left.getMap('spreadsheetDeletedSheets').get(DEFAULT_SHEET_ID)).toBe(
      true
    );
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual([
      replacement,
    ]);
    left.free();
    right.free();
  });

  it('blocks referenced-sheet mutations while ignoring formula string literals', () => {
    const doc = new LoroDoc();
    const id = addSpreadsheetSheet(doc, "O'Brien");
    writeSpreadsheetCells(doc, { A1: { value: "='O''BRIEN'!A1" } });
    expect(() => renameSpreadsheetSheet(doc, id, 'New name')).toThrow(
      'referenced by a formula'
    );
    expect(() => deleteSpreadsheetSheet(doc, id)).toThrow(
      'referenced by a formula'
    );
    writeSpreadsheetCells(doc, { A1: { value: "=\"'O''Brien'!A1\"" } });
    renameSpreadsheetSheet(doc, id, 'New name');
    expect(readSpreadsheetSheets(doc)[1].name).toBe('New name');
    writeSpreadsheetCells(doc, {
      A1: { value: "='New name'!A1", format: 'text' },
    });
    deleteSpreadsheetSheet(doc, id);
    expect(readSpreadsheetSheets(doc)).toHaveLength(1);
    doc.free();
  });

  it('replaces workbooks atomically with fresh identities and restores the old workbook on undo', () => {
    const doc = new LoroDoc();
    writeSpreadsheetCells(doc, { A1: { value: 'before' } });
    const history = new UndoManager(doc, { mergeInterval: 0 });
    const ids = importSpreadsheetSheets(
      doc,
      [
        { ...blank('Data'), cells: { A1: { value: '7' } } },
        {
          ...blank('Summary'),
          cells: { A1: { value: '=Data!A1' } },
          rowCount: 450,
          columnWidths: { 0: 300 },
        },
      ],
      true
    );
    expect(ids).toHaveLength(2);
    expect(readSpreadsheetSheets(doc).map((sheet) => sheet.name)).toEqual([
      'Data',
      'Summary',
    ]);
    expect(readSpreadsheetCells(doc, ids[1]).A1.value).toBe('=Data!A1');
    expect(readSpreadsheetLayout(doc, ids[1]).rowCount).toBe(450);
    history.undo();
    expect(readSpreadsheetSheets(doc)).toEqual([
      { id: DEFAULT_SHEET_ID, name: 'Sheet1' },
    ]);
    expect(readSpreadsheetCells(doc).A1.value).toBe('before');
    history.redo();
    expect(readSpreadsheetSheets(doc).map((sheet) => sheet.id)).toEqual(ids);
    history.free();
    doc.free();
  });

  it('validates all import inputs before mutating the original workbook', () => {
    const doc = new LoroDoc();
    writeSpreadsheetCells(doc, { A1: { value: 'keep' } });
    const before = doc.version().toJSON();
    for (const inputs of [
      [],
      [blank('dup'), blank('DUP')],
      [blank('bad/name')],
      [{ ...blank('bad cell'), cells: { AA1: { value: 'outside' } } }],
      [{ ...blank('bad width'), columnWidths: { 0: 999 } }],
      [{ ...blank('bad height'), rowCount: 1001 }],
      Array.from({ length: 11 }, (_, index) => blank(`Sheet${index}`)),
    ])
      expect(() => importSpreadsheetSheets(doc, inputs, true)).toThrow();
    expect(doc.version().toJSON()).toEqual(before);
    expect(readSpreadsheetCells(doc).A1.value).toBe('keep');
    doc.free();
  });

  it('enforces local sheet limits without hiding concurrent additions', () => {
    const left = new LoroDoc();
    const right = new LoroDoc();
    importSpreadsheetSheets(
      left,
      Array.from({ length: 8 }, (_, index) => blank(`Tab${index}`))
    );
    synchronize(left, right);
    addSpreadsheetSheet(left, 'Alice');
    addSpreadsheetSheet(right, 'Bob');
    synchronize(left, right);
    expect(readSpreadsheetSheets(left)).toHaveLength(11);
    expect(() => addSpreadsheetSheet(left)).toThrow('up to 10');
    left.free();
    right.free();
  });
});

describe('sheet formula references', () => {
  it.each([
    ['=Sheet1!A1', 'Sheet1', true],
    ['=sheet1!$A$1', 'Sheet1', true],
    ["='My sheet'!A1", 'My sheet', true],
    ["='O''Brien'!A1", "O'Brien", true],
    ['=SUM(Sheet1!A1:Sheet1!A10)', 'Sheet1', true],
    ['="Sheet1!A1"', 'Sheet1', false],
    ['="say ""Sheet1!A1"""', 'Sheet1', false],
    ['="text"&Sheet1!A1', 'Sheet1', true],
    ['=OtherSheet1!A1', 'Sheet1', false],
    ['Sheet1!A1', 'Sheet1', false],
    ['=SUM(Sheet1:Sheet3!A1)', 'Sheet2', true],
  ])('checks %s for %s', (formula, name, expected) => {
    expect(formulaReferencesSheet(formula, name)).toBe(expected);
  });
});
