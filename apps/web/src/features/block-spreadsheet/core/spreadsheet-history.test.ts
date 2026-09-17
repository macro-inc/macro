import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  readSpreadsheetCells,
  resizeSpreadsheetColumn,
  type SpreadsheetCellEdits,
  writeSpreadsheetCells,
} from './spreadsheet-document';
import { createSpreadsheetHistory } from './spreadsheet-history';
import {
  addSpreadsheetSheet,
  deleteSpreadsheetSheet,
  importSpreadsheetSheets,
  readSpreadsheetSheets,
  readSpreadsheetWorkbook,
  renameSpreadsheetSheet,
} from './workbook-document';

function pair() {
  const left = new LoroDoc();
  const right = new LoroDoc();
  const id = addSpreadsheetSheet(left, 'Before');
  const history = createSpreadsheetHistory(left, () => {});
  const sync = () => {
    const a = left.export({ mode: 'update' });
    const b = right.export({ mode: 'update' });
    left.import(b);
    right.import(a);
  };
  return {
    left,
    right,
    id,
    history,
    sync,
    dispose: () => {
      history.free();
      left.free();
      right.free();
    },
  };
}

describe('structural spreadsheet history', () => {
  it('blocks undo of a rename referenced by a peer without emitting any live operation or consuming history', () => {
    const { left, right, id, history, sync, dispose } = pair();
    renameSpreadsheetSheet(left, id, 'After');
    sync();
    writeSpreadsheetCells(right, { A1: { value: '=After!A1' } });
    sync();
    const before = left.version().toJSON();
    const updates: Uint8Array[] = [];
    const unsubscribe = left.subscribeLocalUpdates((update) =>
      updates.push(update)
    );
    expect(history.undo()).toContain('a formula references');
    expect(left.version().toJSON()).toEqual(before);
    expect(updates).toEqual([]);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(readSpreadsheetSheets(left)).toContainEqual({ id, name: 'After' });
    // Remote correction does not introduce a new local undo step.
    writeSpreadsheetCells(right, { A1: { value: '' } });
    sync();
    expect(history.undo()).toBeUndefined();
    expect(readSpreadsheetSheets(left)).toContainEqual({ id, name: 'Before' });
    unsubscribe();
    dispose();
  });

  it('preflights redo against references added after undo', () => {
    const { left, right, id, history, sync, dispose } = pair();
    renameSpreadsheetSheet(left, id, 'After');
    expect(history.undo()).toBeUndefined();
    sync();
    writeSpreadsheetCells(right, { A1: { value: '=Before!A1' } });
    sync();
    const before = left.version().toJSON();
    expect(history.redo()).toContain('Redo would');
    expect(left.version().toJSON()).toEqual(before);
    expect(history.canRedo()).toBe(true);
    writeSpreadsheetCells(right, { A1: { value: '' } });
    sync();
    expect(history.redo()).toBeUndefined();
    expect(readSpreadsheetSheets(left)).toContainEqual({ id, name: 'After' });
    dispose();
  });

  it('blocks redo of deletion if the restored sheet acquired a live formula reference', () => {
    const { left, right, id, history, sync, dispose } = pair();
    deleteSpreadsheetSheet(left, id);
    expect(history.undo()).toBeUndefined();
    sync();
    writeSpreadsheetCells(right, { A1: { value: '=Before!A1' } });
    sync();
    expect(history.redo()).toContain('a formula references');
    expect(readSpreadsheetSheets(left)).toContainEqual({ id, name: 'Before' });
    dispose();
  });

  it('allows a structural inverse that removes its own formula at the same time', () => {
    const { left, id, history, dispose } = pair();
    left.getMap('spreadsheetSheetNames').set(id, 'After');
    writeSpreadsheetCells(
      left,
      { A1: { value: '=After!A1' } },
      'sheet1',
      false
    );
    left.commit();
    expect(history.undo()).toBeUndefined();
    expect(readSpreadsheetCells(left).A1).toBeUndefined();
    expect(readSpreadsheetSheets(left)).toContainEqual({ id, name: 'Before' });
    expect(history.redo()).toBeUndefined();
    expect(readSpreadsheetCells(left).A1.value).toBe('=After!A1');
    dispose();
  });

  it('does not exempt a peer’s replacement formula merely because the original transaction wrote that address', () => {
    const { left, right, id, history, sync, dispose } = pair();
    left.getMap('spreadsheetSheetNames').set(id, 'After');
    writeSpreadsheetCells(
      left,
      { A1: { value: '=After!A1' } },
      'sheet1',
      false
    );
    left.commit();
    sync();
    writeSpreadsheetCells(right, { A1: { value: '=After!A1+2' } });
    sync();
    expect(history.undo()).toContain('newer collaborator edit');
    expect(readSpreadsheetCells(left).A1.value).toBe('=After!A1+2');
    dispose();
  });

  it('allows case-only history and ignores ordinary string literals and text-formatted cells', () => {
    const { left, right, id, history, sync, dispose } = pair();
    renameSpreadsheetSheet(left, id, 'BEFORE');
    sync();
    writeSpreadsheetCells(right, { A1: { value: '=before!A1' } });
    sync();
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBeUndefined();
    writeSpreadsheetCells(right, {
      A1: { value: '="After!A1"' },
      B1: { value: '=After!A1', format: 'text' },
    });
    sync();
    writeSpreadsheetCells(left, { A1: { value: '' } });
    renameSpreadsheetSheet(left, id, 'After');
    expect(history.undo()).toBeUndefined();
    expect(readSpreadsheetSheets(left)).toContainEqual({ id, name: 'BEFORE' });
    dispose();
  });

  it('keeps ordinary edits undoable and allows unused imported formulas to disappear with their sheets', () => {
    const { left, history, dispose } = pair();
    writeSpreadsheetCells(left, { A1: { value: 'before' } });
    writeSpreadsheetCells(left, { A1: { value: 'after' } });
    expect(history.undo()).toBeUndefined();
    expect(readSpreadsheetCells(left).A1.value).toBe('before');
    const ids = importSpreadsheetSheets(
      left,
      [
        {
          name: 'Data',
          rowCount: 200,
          columnWidths: {},
          cells: { A1: { value: '1' } },
        },
        {
          name: 'Summary',
          rowCount: 200,
          columnWidths: {},
          cells: { A1: { value: '=Data!A1' } },
        },
      ],
      true
    );
    expect(history.undo()).toBeUndefined();
    expect(
      readSpreadsheetSheets(left).some((sheet) => ids.includes(sheet.id))
    ).toBe(false);
    expect(history.redo()).toBeUndefined();
    expect(readSpreadsheetSheets(left).map((sheet) => sheet.id)).toEqual(ids);
    dispose();
  });

  const changes: {
    name: string;
    apply: (doc: LoroDoc, id: string, peer: boolean) => void;
  }[] = [
    ...[
      ['value', { value: 'local value' }, { value: 'peer replacement' }],
      ['fill', { fillColor: '#00FF00' }, { fillColor: '#0000FF' }],
      ['format', { format: 'currency' }, { format: 'percent' }],
      ['bold', { bold: false }, { bold: true }],
    ].map(([name, local, peer]) => ({
      name: String(name),
      apply: (doc: LoroDoc, id: string, isPeer: boolean) =>
        writeSpreadsheetCells(
          doc,
          { A1: isPeer ? peer : local } as SpreadsheetCellEdits,
          id
        ),
    })),
    {
      name: 'width',
      apply: (doc, id, peer) =>
        resizeSpreadsheetColumn(doc, 0, peer ? 320 : 240, id),
    },
  ];

  for (const imported of [false, true]) {
    for (const direction of ['undo', 'redo'] as const) {
      it.each(changes)(
        `blocks ${imported ? 'imported' : 'ordinary'} $name ${direction} that would overwrite a peer, without consuming history`,
        ({ name, apply }) => {
          const { left, right, history, sync, dispose } = pair();
          const seed = {
            value: 'original',
            fillColor: '#FF0000',
            format: 'number' as const,
            bold: true,
          };
          let id = 'sheet1';
          if (imported) {
            id = importSpreadsheetSheets(left, [
              {
                name: 'Imported',
                rowCount: 200,
                columnWidths: { 0: 200 },
                cells: { A1: seed },
              },
            ])[0];
          } else {
            writeSpreadsheetCells(left, { A1: seed });
            resizeSpreadsheetColumn(left, 0, 200);
            apply(left, id, false);
          }
          sync();
          // A delayed peer edit can arrive after an import has been undone.
          // Redo must not overwrite that newer persisted field either.
          if (direction === 'redo') {
            expect(history.undo()).toBeUndefined();
            sync();
          }
          if (imported && name === 'bold')
            writeSpreadsheetCells(right, { A1: { bold: false } }, id);
          else {
            if (!imported && name === 'bold' && direction === 'redo')
              writeSpreadsheetCells(right, { A1: { bold: false } }, id);
            apply(right, id, true);
          }
          sync();
          const beforeVersion = left.version().toJSON();
          const beforeDocument = left.toJSON();
          const updates: Uint8Array[] = [];
          const unsubscribe = left.subscribeLocalUpdates((update) =>
            updates.push(update)
          );
          expect(history[direction]()).toContain('newer collaborator edit');
          expect(left.version().toJSON()).toEqual(beforeVersion);
          expect(left.toJSON()).toEqual(beforeDocument);
          expect(updates).toEqual([]);
          expect(
            direction === 'undo' ? history.canUndo() : history.canRedo()
          ).toBe(true);
          if (direction === 'undo')
            expect(readSpreadsheetSheets(left)).toContainEqual({
              id,
              name: imported ? 'Imported' : 'Sheet1',
            });
          unsubscribe();
          dispose();
        }
      );
    }
  }

  it.each(['delete', 'same-value'] as const)(
    'protects a peer %s operation on the same ordinary cell',
    (operation) => {
      const { left, right, history, sync, dispose } = pair();
      writeSpreadsheetCells(left, { A1: { value: 'local value' } });
      sync();
      if (operation === 'delete')
        right.getMap('spreadsheetValues').delete('A1');
      else {
        // Loro drops a set of the existing value; make a real peer rewrite
        // whose final text matches the original local operation.
        right.getMap('spreadsheetValues').set('A1', 'temporary peer value');
        right.commit();
        right.getMap('spreadsheetValues').set('A1', 'local value');
      }
      right.commit();
      sync();
      const before = left.version().toJSON();
      expect(history.undo()).toContain('newer collaborator edit');
      expect(left.version().toJSON()).toEqual(before);
      expect(history.canUndo()).toBe(true);
      expect(readSpreadsheetWorkbook(left)).toEqual(
        readSpreadsheetWorkbook(right)
      );
      dispose();
    }
  );
});
