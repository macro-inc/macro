import { LoroDoc } from 'loro-crdt';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { SpreadsheetDocumentSource } from '../context/spreadsheet-source';
import {
  DEFAULT_SHEET_ID,
  readSpreadsheetCells,
  readSpreadsheetLayout,
  resizeSpreadsheetColumn,
  type SpreadsheetSelection,
  writeSpreadsheetCells,
} from '../core/spreadsheet-document';
import {
  addSpreadsheetSheet,
  deleteSpreadsheetSheet,
  moveSpreadsheetSheet,
  readSpreadsheetSheets,
} from '../core/workbook-document';
import { createSpreadsheetStore } from './create-spreadsheet-store';

describe('spreadsheet store', () => {
  it('applies structural patches as one undo step and rejects stale collaborator snapshots', async () => {
    const doc = new LoroDoc();
    writeSpreadsheetCells(doc, {
      A1: { value: '10', bold: true },
      A2: { value: '20' },
    });
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
    // Live cells change in place; structural edits compare by revision.
    const before = structuredClone(store.workbook());
    const next = before.map((sheet) => ({
      ...sheet,
      cells: { A2: sheet.cells.A1, A3: sheet.cells.A2 },
      metadata: { hiddenRows: [1] },
    }));
    store.applyStructure(before, next, store.revision());
    expect(store.cells().A1).toBeUndefined();
    expect(store.cells().A2).toEqual({ value: '10', bold: true });
    store.undo();
    expect(store.cells()).toEqual(before[0].cells);
    expect(store.activeSheet().metadata?.hiddenRows).toBeUndefined();
    const revision = store.revision();
    const peer = new LoroDoc();
    peer.import(doc.export({ mode: 'snapshot' }));
    writeSpreadsheetCells(peer, { B1: { value: 'New collaborator edit' } });
    doc.import(peer.export({ mode: 'update' }));
    expect(() => store.applyStructure(before, next, revision)).toThrow(
      'workbook changed'
    );
    expect(readSpreadsheetCells(doc).B1.value).toBe('New collaborator edit');
    dispose();
    peer.free();
    doc.free();
  });

  it("rejects a shift prepared before a collaborator's width or layout change", async () => {
    const doc = new LoroDoc();
    writeSpreadsheetCells(doc, { A1: { value: 'Name' } });
    resizeSpreadsheetColumn(doc, 1, 150);
    let dispose = () => {};
    const store = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetStore({
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
    });
    await Promise.resolve();
    store.setMetadata({ hiddenColumns: [1] });
    const peer = new LoroDoc();
    peer.import(doc.export({ mode: 'snapshot' }));
    // Insert a column at A, as the calculation worker would return it.
    const shift = () => {
      const before = structuredClone(store.workbook());
      const next = before.map((sheet) => ({
        ...sheet,
        cells: { B1: sheet.cells.A1 },
        metadata: { ...sheet.metadata, hiddenColumns: [2] },
        layout: {
          ...sheet.layout,
          columnCount: sheet.layout.columnCount + 1,
          columnWidths: Object.fromEntries(
            Object.entries(sheet.layout.columnWidths).map(([key, width]) => [
              Number(key) + 1,
              width,
            ])
          ),
        },
      }));
      return { before, next, revision: store.revision() };
    };
    const sync = () => {
      doc.import(peer.export({ mode: 'update', from: doc.oplogVersion() }));
      peer.import(doc.export({ mode: 'update', from: peer.oplogVersion() }));
    };

    let pending = shift();
    resizeSpreadsheetColumn(peer, 2, 240);
    sync();
    expect(() =>
      store.applyStructure(pending.before, pending.next, pending.revision)
    ).toThrow('workbook changed');
    expect(readSpreadsheetLayout(doc).columnWidths[2]).toBe(240);
    expect(store.cells().A1.value).toBe('Name');

    pending = shift();
    peer
      .getMap('spreadsheetSheetMetadata')
      .set(
        DEFAULT_SHEET_ID,
        JSON.stringify({ hiddenColumns: [1], hiddenRows: [4] })
      );
    peer.commit();
    sync();
    expect(() =>
      store.applyStructure(pending.before, pending.next, pending.revision)
    ).toThrow('workbook changed');
    expect(store.activeSheet().metadata).toEqual({
      hiddenColumns: [1],
      hiddenRows: [4],
    });

    // A shift prepared after both changes moves them with the cells.
    pending = shift();
    store.applyStructure(pending.before, pending.next, pending.revision);
    expect(store.cells().B1.value).toBe('Name');
    expect(readSpreadsheetLayout(doc).columnWidths[3]).toBe(240);
    expect(store.activeSheet().metadata?.hiddenRows).toEqual([4]);
    dispose();
    peer.free();
    doc.free();
  });

  it('shifts coordinates in a connected workbook and keeps inserted columns', async () => {
    const doc = new LoroDoc();
    writeSpreadsheetCells(doc, { A1: { value: 'Name' }, B1: { value: '=A1' } });
    let dispose = () => {};
    const store = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetStore({
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
    });
    await Promise.resolve();
    expect(store.canChangeStructure()).toBe(true);
    const before = structuredClone(store.workbook());
    const columns = before[0].layout.columnCount;
    const next = before.map((sheet) => ({
      ...sheet,
      cells: { B1: sheet.cells.A1, C1: { ...sheet.cells.B1, value: '=B1' } },
      layout: { ...sheet.layout, columnCount: columns + 1 },
    }));
    store.applyStructure(before, next, store.revision());
    expect(store.cells().A1).toBeUndefined();
    expect(store.cells().B1.value).toBe('Name');
    expect(store.cells().C1.value).toBe('=B1');
    expect(readSpreadsheetLayout(doc).columnCount).toBe(columns + 1);
    store.undo();
    expect(store.cells().A1.value).toBe('Name');
    expect(readSpreadsheetLayout(doc).columnCount).toBe(columns);
    dispose();
    doc.free();
  });

  it.each(['connecting', 'offline'] as const)(
    'rejects coordinate shifts for a %s collaborative source',
    async (status) => {
      const doc = new LoroDoc();
      writeSpreadsheetCells(doc, { A1: { value: 'Keep me' } });
      let dispose = () => {};
      const store = createRoot((cleanup) => {
        dispose = cleanup;
        return createSpreadsheetStore({
          canEdit: () => true,
          source: {
            doc: () => doc,
            ready: () => true,
            error: () => undefined,
            status: () => status,
            peers: () => [],
            setSelection: () => {},
          },
        });
      });
      await Promise.resolve();
      const before = store.workbook(),
        version = doc.version().toJSON();
      expect(store.canChangeStructure()).toBe(false);
      expect(() =>
        store.applyStructure(before, before, store.revision())
      ).toThrow('Reconnect');
      expect(doc.version().toJSON()).toEqual(version);
      dispose();
      doc.free();
    }
  );
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

  it('moves sheets as undoable steps that merge with a collaborator moving another sheet', async () => {
    const doc = new LoroDoc();
    const peer = new LoroDoc();
    const b = addSpreadsheetSheet(doc, 'B');
    const c = addSpreadsheetSheet(doc, 'C');
    const d = addSpreadsheetSheet(doc, 'D');
    let dispose = () => {};
    const store = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetStore({
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
    });
    await Promise.resolve();
    const names = () => store.sheets().map((sheet) => sheet.name);
    store.moveSheet(d, 0);
    expect(names()).toEqual(['D', 'Sheet1', 'B', 'C']);
    store.moveSheet(DEFAULT_SHEET_ID, 3);
    expect(names()).toEqual(['D', 'B', 'C', 'Sheet1']);
    store.undo();
    expect(names()).toEqual(['D', 'Sheet1', 'B', 'C']);
    store.redo();
    expect(names()).toEqual(['D', 'B', 'C', 'Sheet1']);
    store.moveSheet(b, 1);
    expect(names()).toEqual(['D', 'B', 'C', 'Sheet1']);

    peer.import(doc.export({ mode: 'snapshot' }));
    moveSpreadsheetSheet(peer, c, 0);
    store.moveSheet(DEFAULT_SHEET_ID, 1);
    doc.import(peer.export({ mode: 'update' }));
    peer.import(doc.export({ mode: 'update' }));
    expect(names()).toEqual(['C', 'D', 'Sheet1', 'B']);
    expect(readSpreadsheetSheets(peer).map((sheet) => sheet.name)).toEqual(
      names()
    );
    dispose();
    peer.free();
    doc.free();
  });

  it('renumbers sheets whose orders tie when moving between them', () => {
    const doc = new LoroDoc();
    const b = addSpreadsheetSheet(doc, 'B');
    const c = addSpreadsheetSheet(doc, 'C');
    const order = doc.getMap('spreadsheetSheetOrder');
    order.set(b, 5);
    order.set(c, 5);
    doc.commit();
    // Equal orders sort by sheet id.
    const [, first, second] = readSpreadsheetSheets(doc).map(
      (sheet) => sheet.name
    );
    moveSpreadsheetSheet(doc, DEFAULT_SHEET_ID, 1);
    expect(readSpreadsheetSheets(doc).map((sheet) => sheet.name)).toEqual([
      first,
      'Sheet1',
      second,
    ]);
    expect(Object.values(order.toJSON()).sort()).toEqual([0, 1, 2]);
    expect(() => moveSpreadsheetSheet(doc, 'missing', 0)).toThrow(
      'no longer exists'
    );
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
      store.moveSheet(DEFAULT_SHEET_ID, 1);
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
    const ids = await store.replaceWorkbook([
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

  it('writes a large import in steps that undo as one', async () => {
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
    store.setCells({ A1: { value: 'original' } });
    const cells: Record<string, { value: string; numberFormat?: string }> = {};
    for (let row = 1; row <= 6_000; row++) {
      cells[`A${row}`] = {
        value: String(45_000 + row),
        numberFormat: 'm/d/yyyy',
      };
      cells[`B${row}`] = { value: `=A${row}+1` };
    }
    const progress: number[] = [];
    const commits: string[] = [];
    const unsubscribe = doc.subscribeLocalUpdates(() => commits.push('update'));
    const [id] = await store.replaceWorkbook(
      [{ name: 'Large', cells, rowCount: 6_000, columnWidths: {} }],
      { onProgress: (fraction) => progress.push(fraction) }
    );
    unsubscribe();
    // 12,000 cells take several commits, each reported, and a registration.
    expect(progress.length).toBeGreaterThan(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
    expect(commits.length).toBe(progress.length + 1);
    expect(store.activeSheetId()).toBe(id);
    expect(Object.keys(store.cells())).toHaveLength(12_000);
    expect(store.cells().A6000).toEqual({
      value: '51000',
      numberFormat: 'm/d/yyyy',
    });
    store.undo();
    expect(store.workbook().map((sheet) => sheet.name)).toEqual(['Sheet1']);
    expect(store.cells().A1.value).toBe('original');
    store.redo();
    expect(store.workbook().map((sheet) => sheet.name)).toEqual(['Large']);
    expect(Object.keys(store.cells())).toHaveLength(12_000);
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
      await store.appendSheets([
        { name: 'blocked', cells: {}, rowCount: 200, columnWidths: {} },
      ])
    ).toEqual([]);
    expect(
      await store.replaceWorkbook([
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
      columnCount: 26,
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
      columnCount: 26,
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
