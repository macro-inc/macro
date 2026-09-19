import { LoroDoc } from 'loro-crdt';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkbookFileData,
  WorkbookFileExport,
} from '../core/workbook-file-types';
import { createSpreadsheetStore } from './create-spreadsheet-store';
import { createWorkbookActions } from './create-workbook-actions';
import { exportWorkbookFile, importWorkbookFile } from './workbook-file-client';

vi.mock('./workbook-file-client', () => ({
  importWorkbookFile: vi.fn(),
  exportWorkbookFile: vi.fn(),
}));
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  vi.resetAllMocks();
});
const imported: WorkbookFileData = {
  sheets: [
    {
      name: 'Imported',
      cells: { A1: { value: '=2+2', bold: true } },
      rowCount: 200,
      columnWidths: {},
    },
  ],
  warnings: ['Charts are not supported.'],
};
const file = {
  name: 'budget.xlsx',
  size: 10,
  arrayBuffer: async () => new ArrayBuffer(10),
} as File;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const doc = new LoroDoc();
  cleanups.push(() => doc.free());
  return createRoot((dispose) => {
    cleanups.unshift(dispose);
    const [canEdit, setCanEdit] = createSignal(true);
    const [ready, setReady] = createSignal(true);
    const store = createSpreadsheetStore({
      canEdit,
      source: {
        doc: () => doc,
        ready: () => true,
        error: () => undefined,
        status: () => 'local',
        peers: () => [],
        setSelection: () => {},
      },
    });
    const onExport = vi.fn();
    const actions = createWorkbookActions({
      store,
      values: () => ({ sheet1: { A1: { display: '7', number: 7 } } }),
      calculationReady: ready,
      commit: () => {},
      onExport,
    });
    return { store, actions, setCanEdit, setReady, onExport, dispose };
  });
}

describe('workbook import and export actions', () => {
  it('previews all warnings without writing and imports as one undoable operation', async () => {
    const { store, actions } = setup();
    store.setCells({ A1: { value: 'original' } });
    vi.mocked(importWorkbookFile).mockResolvedValue(imported);
    await actions.importExcel(file);
    expect(store.sheets()).toHaveLength(1);
    expect(store.cells().A1.value).toBe('original');
    expect(actions.preview()?.data.warnings).toEqual(imported.warnings);
    actions.confirmImport();
    expect(store.sheets()).toHaveLength(2);
    expect(store.cells().A1.value).toBe('=2+2');
    store.undo();
    expect(store.sheets()).toHaveLength(1);
    expect(store.cells().A1.value).toBe('original');
  });

  it('cancels without changes and refuses imports after permission revocation', async () => {
    const { store, actions, setCanEdit } = setup();
    vi.mocked(importWorkbookFile).mockResolvedValue(imported);
    await actions.importExcel(file);
    actions.closePreview();
    expect(store.sheets()).toHaveLength(1);
    await actions.importExcel(file);
    setCanEdit(false);
    actions.confirmImport();
    expect(store.sheets()).toHaveLength(1);
    expect(actions.preview()).toBeDefined();
  });

  it('does not replace edits that arrived after the preview opened', async () => {
    const { store, actions } = setup();
    vi.mocked(importWorkbookFile).mockResolvedValue(imported);
    await actions.importExcel(file);
    actions.setImportMode('replace');
    store.setCells({ B1: { value: 'new work' } });
    actions.confirmImport();
    expect(actions.importError()).toContain('changed since the preview');
    expect(store.cells().B1.value).toBe('new work');
    expect(store.sheets()).toHaveLength(1);
  });

  it('replaces and undoes the entire workbook when the preview is current', async () => {
    const { store, actions } = setup();
    store.setCells({ A1: { value: 'original' } });
    vi.mocked(importWorkbookFile).mockResolvedValue(imported);
    await actions.importExcel(file);
    actions.setImportMode('replace');
    actions.confirmImport();
    expect(store.activeSheet().name).toBe('Imported');
    expect(store.cells().A1.value).toBe('=2+2');
    store.undo();
    expect(store.activeSheet().name).toBe('Sheet1');
    expect(store.cells().A1.value).toBe('original');
  });

  it('shows parse failures and name conflicts without partially changing the workbook', async () => {
    const { store, actions } = setup();
    vi.mocked(importWorkbookFile).mockRejectedValueOnce(
      new Error('Encrypted workbook')
    );
    await actions.importExcel(file);
    expect(actions.notice()).toBe('Encrypted workbook');
    expect(actions.busy()).toBe('');
    vi.mocked(importWorkbookFile).mockResolvedValue({
      ...imported,
      sheets: [{ ...imported.sheets[0], name: 'Sheet1' }],
    });
    await actions.importExcel(file);
    actions.confirmImport();
    expect(actions.importError()).toContain('already exists');
    expect(store.cells()).toEqual({});
    expect(store.sheets()).toHaveLength(1);
  });

  it('exports current formula caches and blocks export while calculation is pending', async () => {
    const { store, actions, onExport, setReady } = setup();
    store.setCells({ A1: { value: '=3+4' } });
    setReady(false);
    await actions.exportExcel();
    expect(exportWorkbookFile).not.toHaveBeenCalled();
    setReady(true);
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(exportWorkbookFile).mockResolvedValue({ bytes, warnings: [] });
    await actions.exportExcel();
    expect(exportWorkbookFile).toHaveBeenCalledWith(
      {
        sheets: [
          {
            name: 'Sheet1',
            cells: { A1: { value: '=3+4' } },
            rowCount: 200,
            columnWidths: {},
            values: { A1: { display: '7', number: 7 } },
          },
        ],
      },
      expect.any(AbortSignal)
    );
    expect(onExport).toHaveBeenCalledWith(bytes);
    expect(actions.busy()).toBe('');
  });

  it.each([
    'budget.xls',
    'budget.xlsm',
    'budget.xlsx.exe',
    'budget.csv',
    'budget',
  ])(
    'rejects unsupported filename %s before reading or decoding',
    async (name) => {
      const { actions } = setup();
      const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
      await actions.importExcel({ ...file, name, arrayBuffer });
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(importWorkbookFile).not.toHaveBeenCalled();
      expect(actions.notice()).toContain('.xlsx');
    }
  );

  it('accepts uppercase extensions but rejects oversized files before reading', async () => {
    const { actions } = setup();
    vi.mocked(importWorkbookFile).mockResolvedValue(imported);
    await actions.importExcel({ ...file, name: 'REPORT.XLSX' });
    expect(actions.preview()?.name).toBe('REPORT.XLSX');
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    await actions.importExcel({
      ...file,
      size: 5 * 1024 * 1024 + 1,
      arrayBuffer,
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(actions.notice()).toContain('5 MB');
  });

  it('replaces an old preview immediately and ignores stale decoder results from superseded requests', async () => {
    const { actions, store } = setup();
    vi.mocked(importWorkbookFile).mockResolvedValueOnce(imported);
    await actions.importExcel(file);
    const first = deferred<WorkbookFileData>();
    const second = deferred<WorkbookFileData>();
    vi.mocked(importWorkbookFile)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const firstRun = actions.importExcel({ ...file, name: 'first.xlsx' });
    expect(actions.preview()).toBeUndefined();
    await Promise.resolve();
    const firstSignal = vi.mocked(importWorkbookFile).mock.calls[1][1];
    const secondRun = actions.importExcel({ ...file, name: 'second.xlsx' });
    await Promise.resolve();
    expect(firstSignal?.aborted).toBe(true);
    first.resolve(imported);
    await firstRun;
    expect(actions.preview()).toBeUndefined();
    expect(actions.busy()).toContain('Reading');
    second.resolve({
      sheets: [{ ...imported.sheets[0], name: 'Latest' }],
      warnings: [],
    });
    await secondRun;
    expect(actions.preview()?.name).toBe('second.xlsx');
    expect(actions.preview()?.data.sheets[0].name).toBe('Latest');
    expect(actions.busy()).toBe('');
    expect(store.sheets()).toHaveLength(1);
  });

  it('does not start a decoder after a file read was cancelled or edit access was lost', async () => {
    const { actions, setCanEdit, dispose } = setup();
    const reading = deferred<ArrayBuffer>();
    const run = actions.importExcel({
      ...file,
      arrayBuffer: () => reading.promise,
    });
    setCanEdit(false);
    reading.resolve(new ArrayBuffer(10));
    await run;
    expect(importWorkbookFile).not.toHaveBeenCalled();
    expect(actions.preview()).toBeUndefined();
    setCanEdit(true);
    const secondRead = deferred<ArrayBuffer>();
    const secondRun = actions.importExcel({
      ...file,
      arrayBuffer: () => secondRead.promise,
    });
    dispose();
    secondRead.resolve(new ArrayBuffer(10));
    await secondRun;
    expect(importWorkbookFile).not.toHaveBeenCalled();
  });

  it('ignores a parsed workbook if edit permission was revoked while decoding', async () => {
    const { actions, store, setCanEdit } = setup();
    const decoder = deferred<WorkbookFileData>();
    vi.mocked(importWorkbookFile).mockReturnValueOnce(decoder.promise);
    const run = actions.importExcel(file);
    await Promise.resolve();
    setCanEdit(false);
    decoder.resolve(imported);
    await run;
    expect(actions.preview()).toBeUndefined();
    expect(actions.busy()).toBe('');
    expect(store.cells()).toEqual({});
  });

  it('exports the captured snapshot once even if the sheet changes or becomes view only while encoding', async () => {
    const { store, actions, onExport, setCanEdit } = setup();
    store.setCells({ A1: { value: '=3+4' } });
    const encoding = deferred<WorkbookFileExport>();
    vi.mocked(exportWorkbookFile).mockReturnValueOnce(encoding.promise);
    const run = actions.exportExcel();
    const request = vi.mocked(exportWorkbookFile).mock.calls[0][0];
    store.setCells({ A1: { value: '99' } });
    setCanEdit(false);
    await actions.exportExcel();
    expect(exportWorkbookFile).toHaveBeenCalledOnce();
    expect(request.sheets[0].cells.A1.value).toBe('=3+4');
    expect(request.sheets[0].values?.A1.number).toBe(7);
    const bytes = new Uint8Array([1, 2]);
    encoding.resolve({ bytes, warnings: ['An export limitation'] });
    await run;
    expect(onExport).toHaveBeenCalledExactlyOnceWith(bytes);
    expect(actions.notice()).toBe('An export limitation');
    expect(store.cells().A1.value).toBe('99');
  });

  it('cancels pending exports on disposal and when a new import supersedes them', async () => {
    const { actions, onExport, dispose } = setup();
    const first = deferred<WorkbookFileExport>();
    vi.mocked(exportWorkbookFile).mockReturnValueOnce(first.promise);
    const run = actions.exportExcel();
    const signal = vi.mocked(exportWorkbookFile).mock.calls[0][1];
    vi.mocked(importWorkbookFile).mockResolvedValueOnce(imported);
    await actions.importExcel(file);
    expect(signal?.aborted).toBe(true);
    first.resolve({ bytes: new Uint8Array(), warnings: [] });
    await run;
    expect(onExport).not.toHaveBeenCalled();
    const second = deferred<WorkbookFileExport>();
    vi.mocked(exportWorkbookFile).mockReturnValueOnce(second.promise);
    const secondRun = actions.exportExcel();
    dispose();
    second.resolve({ bytes: new Uint8Array(), warnings: [] });
    await secondRun;
    expect(onExport).not.toHaveBeenCalled();
  });

  it('ignores a decoder that completes after disposal', async () => {
    const { actions, dispose } = setup();
    let resolve!: (data: WorkbookFileData) => void;
    vi.mocked(importWorkbookFile).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const processing = actions.importExcel(file);
    await Promise.resolve();
    dispose();
    resolve(imported);
    await processing;
    expect(actions.preview()).toBeUndefined();
  });
});
