import { LoroDoc } from 'loro-crdt';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { SpreadsheetDocumentSource } from '../context/spreadsheet-source';
import {
  DEFAULT_SHEET_ID,
  readSpreadsheetCells,
  readSpreadsheetLayout,
  type SpreadsheetSelection,
  writeSpreadsheetCells,
} from '../core/spreadsheet-document';
import {
  addSpreadsheetSheet,
  deleteSpreadsheetSheet,
} from '../core/workbook-document';
import { createSpreadsheetStore } from './create-spreadsheet-store';

describe('spreadsheet store', () => {
  it('reports blocked structural history through its error accessor and preserves the undo step', async () => {
    const doc = new LoroDoc();
    const peer = new LoroDoc();
    const id = addSpreadsheetSheet(doc, 'Before');
    let dispose = () => {};
    const store = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetStore({
        canEdit: () => true,
        source: {
          doc: () => doc,
          ready: () => true,
          error: () => undefined,
          status: () => 'local',
          peers: () => [],
          setSelection: () => {},
        },
      });
    });
    await Promise.resolve();
    store.renameSheet(id, 'After');
    peer.import(doc.export({ mode: 'update' }));
    writeSpreadsheetCells(peer, { A1: { value: '=After!A1' } });
    doc.import(peer.export({ mode: 'update' }));
    const version = doc.version().toJSON();
    store.undo();
    expect(store.error()).toContain('a formula references');
    expect(doc.version().toJSON()).toEqual(version);
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);
    writeSpreadsheetCells(peer, { A1: { value: '' } });
    doc.import(peer.export({ mode: 'update' }));
    store.undo();
    expect(store.error()).toBeUndefined();
    expect(store.sheets()).toContainEqual({ id, name: 'Before' });
    dispose();
    peer.free();
    doc.free();
  });

  it.each(['readonly', 'hydrating'] as const)(
    'does not revive a retained fallback while %s',
    async (state) => {
      const doc = new LoroDoc();
      doc.getMap('spreadsheetDeletedSheets').set(DEFAULT_SHEET_ID, true);
      doc.commit();
      const version = doc.version().toJSON();
      let dispose = () => {};
      const store = createRoot((cleanup) => {
        dispose = cleanup;
        return createSpreadsheetStore({
          canEdit: () => state !== 'readonly',
          source: {
            doc: () => doc,
            ready: () => state !== 'hydrating',
            error: () => undefined,
            status: () => 'local',
            peers: () => [],
            setSelection: () => {},
          },
        });
      });
      await Promise.resolve();
      expect(store.activeSheetId()).toBe(DEFAULT_SHEET_ID);
      store.setCells({ A1: { value: 'blocked' } });
      store.resizeColumn(0, 200);
      store.appendRows(100);
      store.renameSheet(DEFAULT_SHEET_ID, 'Blocked');
      store.addSheet('Blocked');
      store.duplicateSheet(DEFAULT_SHEET_ID);
      store.undo();
      expect(doc.version().toJSON()).toEqual(version);
      expect(doc.getMap('spreadsheetDeletedSheets').get(DEFAULT_SHEET_ID)).toBe(
        true
      );
      expect(doc.getMap('spreadsheetSheetRevivals').toJSON()).toEqual({});
      dispose();
      doc.free();
    }
  );

  it('keeps active sheets local and routes cells, layout and presence to the selected sheet', async () => {
    const doc = new LoroDoc();
    const selections: (SpreadsheetSelection | undefined)[] = [];
    const source: SpreadsheetDocumentSource = {
      doc: () => doc,
      ready: () => true,
      error: () => undefined,
      status: () => 'local',
      peers: () => [],
      setSelection: (selection) => {
        selections.push(selection);
      },
    };
    let dispose = () => {};
    const { alice, bob } = createRoot((cleanup) => {
      dispose = cleanup;
      return {
        alice: createSpreadsheetStore({ source, canEdit: () => true }),
        bob: createSpreadsheetStore({ source, canEdit: () => true }),
      };
    });
    await Promise.resolve();
    const id = alice.addSheet('Budget')!;
    expect(alice.activeSheetId()).toBe(id);
    expect(bob.activeSheetId()).toBe(DEFAULT_SHEET_ID);
    alice.setCells({ A1: { value: 'budget' } });
    alice.resizeColumn(0, 300);
    alice.appendRows(50);
    expect(alice.rowCount()).toBe(250);
    alice.setSelection({ anchor: 'A1', focus: 'B2' });
    expect(alice.selection()).toEqual({
      anchor: 'A1',
      focus: 'B2',
      sheetId: id,
    });
    expect(bob.selection()).toBeUndefined();
    expect(selections.at(-1)).toEqual({
      anchor: 'A1',
      focus: 'B2',
      sheetId: id,
    });
    alice.setActiveSheet(DEFAULT_SHEET_ID);
    expect(alice.cells()).toEqual({});
    expect(alice.rowCount()).toBe(200);
    expect(alice.layout().columnWidths).toEqual({});
    expect(selections.at(-1)).toBeUndefined();
    alice.setActiveSheet(id);
    expect(alice.selection()).toEqual({
      anchor: 'A1',
      focus: 'B2',
      sheetId: id,
    });
    expect(selections.at(-1)).toEqual(alice.selection());
    expect(alice.cells().A1.value).toBe('budget');
    expect(alice.layout().columnWidths[0]).toBe(300);
    const version = doc.version().toJSON();
    alice.setActiveSheet(DEFAULT_SHEET_ID);
    expect(doc.version().toJSON()).toEqual(version);
    dispose();
    doc.free();
  });

  it.each(['switch', 'delete'] as const)(
    'publishes the restored cursor on sheet %s and cancels pending old-sheet presence',
    async (action) => {
      vi.useFakeTimers();
      const doc = new LoroDoc();
      const publish = vi.fn();
      let dispose = () => {};
      try {
        const store = createRoot((cleanup) => {
          dispose = cleanup;
          return createSpreadsheetStore({
            canEdit: () => true,
            source: {
              doc: () => doc,
              ready: () => true,
              error: () => undefined,
              status: () => 'local',
              peers: () => [],
              setSelection: publish,
            },
          });
        });
        await Promise.resolve();
        store.setSelection({ anchor: 'C3', focus: 'E5' });
        const restored = store.selection();
        const other = store.addSheet('Other')!;
        store.setSelection({ anchor: 'A1', focus: 'A1' });
        store.setSelection({ anchor: 'A1', focus: 'B2' });
        if (action === 'switch') store.setActiveSheet(DEFAULT_SHEET_ID);
        else {
          deleteSpreadsheetSheet(doc, other);
          await Promise.resolve();
        }
        expect(store.activeSheetId()).toBe(DEFAULT_SHEET_ID);
        expect(store.selection()).toEqual(restored);
        expect(publish).toHaveBeenLastCalledWith(restored);
        const calls = publish.mock.calls.length;
        await vi.advanceTimersByTimeAsync(200);
        expect(publish).toHaveBeenCalledTimes(calls);
        expect(publish).toHaveBeenLastCalledWith(restored);
      } finally {
        dispose();
        doc.free();
        vi.useRealTimers();
      }
    }
  );

  it('filters remote cursors by sheet and treats legacy presence as Sheet1', async () => {
    const doc = new LoroDoc();
    const source: SpreadsheetDocumentSource = {
      doc: () => doc,
      ready: () => true,
      error: () => undefined,
      status: () => 'local',
      setSelection: () => {},
      peers: () => [
        {
          peerId: 'legacy',
          color: '#123456',
          selection: { anchor: 'A1', focus: 'A1' },
        },
      ],
    };
    let dispose = () => {};
    const store = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetStore({ source, canEdit: () => true });
    });
    await Promise.resolve();
    expect(store.peers()).toHaveLength(1);
    const id = store.addSheet('Other')!;
    expect(store.peers()).toHaveLength(0);
    source.peers = () => [
      {
        peerId: 'new',
        color: '#123456',
        selection: { anchor: 'A1', focus: 'A1', sheetId: id },
      },
    ];
    expect(store.peers()).toHaveLength(1);
    store.setActiveSheet(DEFAULT_SHEET_ID);
    expect(store.peers()).toHaveLength(0);
    dispose();
    doc.free();
  });

  it('falls back after a remote deletion and restores an imported workbook in one undo', async () => {
    const doc = new LoroDoc();
    const source: SpreadsheetDocumentSource = {
      doc: () => doc,
      ready: () => true,
      error: () => undefined,
      status: () => 'local',
      peers: () => [],
      setSelection: () => {},
    };
    let dispose = () => {};
    const store = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetStore({ source, canEdit: () => true });
    });
    await Promise.resolve();
    const id = store.addSheet('Other')!;
    deleteSpreadsheetSheet(doc, id);
    await vi.waitFor(() =>
      expect(store.activeSheetId()).toBe(DEFAULT_SHEET_ID)
    );
    store.setCells({ A1: { value: 'original' } });
    const ids = store.replaceWorkbook([
      {
        name: 'Imported',
        cells: { A1: { value: 'imported' } },
        rowCount: 300,
        columnWidths: {},
      },
      {
        name: 'Summary',
        cells: { A1: { value: '=Imported!A1' } },
        rowCount: 200,
        columnWidths: {},
      },
    ]);
    expect(store.activeSheetId()).toBe(ids[0]);
    expect(store.workbook()).toHaveLength(2);
    store.undo();
    expect(store.activeSheetId()).toBe(DEFAULT_SHEET_ID);
    expect(store.cells().A1.value).toBe('original');
    store.redo();
    expect(store.workbook().map((sheet) => sheet.name)).toEqual([
      'Imported',
      'Summary',
    ]);
    dispose();
    doc.free();
  });

  it('blocks workbook mutations while read-only without blocking tab selection', async () => {
    const doc = new LoroDoc();
    const [canEdit, setCanEdit] = createSignal(true);
    const source: SpreadsheetDocumentSource = {
      doc: () => doc,
      ready: () => true,
      error: () => undefined,
      status: () => 'local',
      peers: () => [],
      setSelection: () => {},
    };
    let dispose = () => {};
    const store = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetStore({ source, canEdit });
    });
    await Promise.resolve();
    const id = store.addSheet('Budget')!;
    setCanEdit(false);
    const version = doc.version().toJSON();
    expect(store.addSheet('blocked')).toBeUndefined();
    expect(store.duplicateSheet(id)).toBeUndefined();
    store.renameSheet(id, 'blocked');
    store.deleteSheet(id);
    expect(
      store.appendSheets([
        { name: 'blocked', cells: {}, rowCount: 200, columnWidths: {} },
      ])
    ).toEqual([]);
    expect(
      store.replaceWorkbook([
        { name: 'blocked', cells: {}, rowCount: 200, columnWidths: {} },
      ])
    ).toEqual([]);
    expect(doc.version().toJSON()).toEqual(version);
    store.setActiveSheet(DEFAULT_SHEET_ID);
    expect(store.activeSheetId()).toBe(DEFAULT_SHEET_ID);
    expect(store.sheets()).toHaveLength(2);
    dispose();
    doc.free();
  });

  it('blocks writes before hydration and while read-only', async () => {
    const doc = new LoroDoc();
    const [ready, setReady] = createSignal(false);
    const [canEdit, setCanEdit] = createSignal(true);
    const source: SpreadsheetDocumentSource = {
      doc: () => doc,
      ready,
      error: () => undefined,
      status: () => 'local',
      peers: () => [],
      setSelection: () => {},
    };
    let dispose = () => {};
    const store = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetStore({ source, canEdit });
    });
    await Promise.resolve();
    store.setCells({ A1: { value: 'too early' } });
    store.appendRows(100);
    store.resizeColumn(0, 240);
    expect(readSpreadsheetLayout(doc)).toEqual({
      rowCount: 200,
      columnWidths: {},
    });
    expect(readSpreadsheetCells(doc)).toEqual({});
    setReady(true);
    store.setCells({ A1: { value: 'allowed' } });
    expect(store.cells().A1.value).toBe('allowed');
    expect(store.canUndo()).toBe(true);
    setCanEdit(false);
    store.setCells({ A1: { value: 'denied' } });
    store.appendRows(100);
    store.resizeColumn(0, 240);
    expect(readSpreadsheetLayout(doc)).toEqual({
      rowCount: 200,
      columnWidths: {},
    });
    store.undo();
    expect(store.cells().A1.value).toBe('allowed');
    expect(store.canUndo()).toBe(false);
    setCanEdit(true);
    store.undo();
    expect(store.cells()).toEqual({});
    store.appendRows(100);
    store.resizeColumn(0, 240);
    expect(store.rowCount()).toBe(300);
    expect(store.layout().columnWidths[0]).toBe(240);
    store.undo();
    expect(store.layout().columnWidths[0]).toBeUndefined();
    store.undo();
    expect(store.rowCount()).toBe(200);
    dispose();
    doc.free();
  });
});
