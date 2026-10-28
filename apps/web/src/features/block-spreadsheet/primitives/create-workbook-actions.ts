import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { WorkbookCalculation } from '../core/calculation';
import { createChartReader } from '../core/chart-data';
import {
  type WorkbookFileData,
  XLSX_MAX_BYTES,
} from '../core/workbook-file-types';
import type { SpreadsheetStore } from './create-spreadsheet-store';
import { exportWorkbookFile, importWorkbookFile } from './workbook-file-client';

export function createWorkbookActions(options: {
  store: SpreadsheetStore;
  values: Accessor<WorkbookCalculation>;
  calculationReady: Accessor<boolean>;
  commit: () => void;
  onExport: (bytes: Uint8Array) => void;
}) {
  const [busy, setBusy] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [preview, setPreview] = createSignal<{
    name: string;
    data: WorkbookFileData;
    revision: ReturnType<SpreadsheetStore['workbook']>;
  }>();
  const [importMode, setImportMode] = createSignal<'append' | 'replace'>(
    'append'
  );
  const [importError, setImportError] = createSignal('');
  const [importing, setImporting] = createSignal(false);
  const [importProgress, setImportProgress] = createSignal(0);
  const [sheetDialog, setSheetDialog] = createSignal<{
    kind: 'rename' | 'delete';
    id: string;
    name: string;
  }>();
  const [sheetName, setSheetName] = createSignal('');
  const [sheetError, setSheetError] = createSignal('');
  let pending: AbortController | undefined;
  onCleanup(() => pending?.abort());

  function changeSheet(action: () => void) {
    options.commit();
    setNotice('');
    try {
      action();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Unable to update this sheet.'
      );
    }
  }
  function openSheetDialog(kind: 'rename' | 'delete', id: string) {
    options.commit();
    const sheet = options.store.sheets().find((sheet) => sheet.id === id);
    if (!sheet || !options.store.canEdit()) return;
    setSheetName(sheet.name);
    setSheetError('');
    setSheetDialog({ kind, ...sheet });
  }
  function confirmSheetDialog() {
    const dialog = sheetDialog();
    if (!dialog || !options.store.canEdit()) return;
    try {
      if (dialog.kind === 'rename')
        options.store.renameSheet(dialog.id, sheetName());
      // Charts reading the sheet keep the values they show.
      else
        options.store.deleteSheet(
          dialog.id,
          createChartReader(options.store.workbook, options.values)
        );
      setSheetDialog(undefined);
    } catch (error) {
      setSheetError(
        error instanceof Error ? error.message : 'Unable to update this sheet.'
      );
    }
  }
  async function importExcel(file: File) {
    if (!options.store.canEdit()) return;
    if (!/\.xls[xm]$/i.test(file.name)) {
      setNotice(
        'Choose an .xlsx or .xlsm Excel workbook. Other file formats are not supported here.'
      );
      return;
    }
    if (file.size > XLSX_MAX_BYTES) {
      setNotice(
        `Choose an Excel workbook up to ${XLSX_MAX_BYTES / 1024 / 1024} MB.`
      );
      return;
    }
    pending?.abort();
    const current = new AbortController();
    pending = current;
    setPreview(undefined);
    setImportError('');
    setBusy('Reading workbook…');
    setNotice('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (current.signal.aborted || !options.store.canEdit()) return;
      const data = await importWorkbookFile(bytes, current.signal);
      if (current.signal.aborted || !options.store.canEdit()) return;
      options.commit();
      setImportMode('append');
      setImportError('');
      setPreview({ name: file.name, data, revision: options.store.workbook() });
    } catch (error) {
      if (!current.signal.aborted)
        setNotice(
          error instanceof Error
            ? error.message
            : 'Unable to read this workbook.'
        );
    } finally {
      if (pending === current) {
        pending = undefined;
        setBusy('');
      }
    }
  }
  async function confirmImport() {
    const current = preview();
    if (!current || importing() || !options.store.canEdit()) return;
    // Show the pending dialog before writing begins. Hidden tabs never
    // paint; the timeout covers them.
    setImportProgress(0);
    setImporting(true);
    await new Promise((resolve) => {
      globalThis.requestAnimationFrame?.(() => setTimeout(resolve));
      setTimeout(resolve, 50);
    });
    try {
      if (preview() !== current || !options.store.canEdit()) return;
      if (importMode() === 'replace') {
        if (current.revision !== options.store.workbook()) {
          setImportError(
            'This workbook changed since the preview opened. Close this preview and import again to review the latest version.'
          );
          return;
        }
        await options.store.replaceWorkbook(current.data.sheets, {
          onProgress: setImportProgress,
          images: current.data.images,
        });
      } else
        await options.store.appendSheets(current.data.sheets, {
          onProgress: setImportProgress,
          images: current.data.images,
        });
      setNotice(
        `Imported ${current.data.sheets.length} ${current.data.sheets.length === 1 ? 'sheet' : 'sheets'} from ${current.name}`
      );
      setPreview(undefined);
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : 'Unable to import this workbook.'
      );
    } finally {
      setImporting(false);
    }
  }
  async function exportExcel() {
    options.commit();
    if (!options.calculationReady() || busy()) return;
    const current = new AbortController();
    pending = current;
    setBusy('Preparing download…');
    setNotice('');
    try {
      const workbook = options.store.workbook();
      const keys = workbook.flatMap((sheet) =>
        (sheet.metadata?.drawings ?? []).flatMap((drawing) =>
          drawing.type === 'image' ? [drawing.image] : []
        )
      );
      const result = await exportWorkbookFile(
        {
          ...(keys.length && { images: options.store.images(keys) }),
          sheets: workbook.map((sheet) => ({
            name: sheet.name,
            metadata: sheet.metadata,
            cells: sheet.cells,
            rowCount: sheet.layout.rowCount,
            columnWidths: sheet.layout.columnWidths,
            values: options.values()[sheet.id],
          })),
        },
        current.signal
      );
      if (current.signal.aborted) return;
      options.onExport(result.bytes);
      setNotice(result.warnings.join(' · ') || 'Excel workbook downloaded');
    } catch (error) {
      if (!current.signal.aborted)
        setNotice(
          error instanceof Error
            ? error.message
            : 'Unable to export this workbook.'
        );
    } finally {
      if (pending === current) {
        pending = undefined;
        setBusy('');
      }
    }
  }
  return {
    busy,
    notice,
    clearNotice: () => setNotice(''),
    preview,
    importMode,
    setImportMode,
    importError,
    confirmImport,
    importing,
    importProgress,
    closePreview: () => setPreview(undefined),
    importExcel,
    exportExcel,
    sheetDialog,
    sheetName,
    setSheetName,
    sheetError,
    confirmSheetDialog,
    closeSheetDialog: () => setSheetDialog(undefined),
    openSheetDialog,
    selectSheet: (id: string) =>
      changeSheet(() => options.store.setActiveSheet(id)),
    addSheet: () => changeSheet(() => options.store.addSheet()),
    duplicateSheet: (id: string) =>
      changeSheet(() => options.store.duplicateSheet(id)),
    moveSheet: (id: string, index: number) =>
      changeSheet(() => options.store.moveSheet(id, index)),
  };
}
