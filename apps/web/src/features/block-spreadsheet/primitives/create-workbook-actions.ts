import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { WorkbookCalculation } from '../core/calculation';
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
      else options.store.deleteSheet(dialog.id);
      setSheetDialog(undefined);
    } catch (error) {
      setSheetError(
        error instanceof Error ? error.message : 'Unable to update this sheet.'
      );
    }
  }
  async function importExcel(file: File) {
    if (!options.store.canEdit()) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setNotice(
        'Choose an .xlsx Excel workbook. Other file formats are not supported here.'
      );
      return;
    }
    if (file.size > XLSX_MAX_BYTES) {
      setNotice('Choose an Excel workbook up to 5 MB.');
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
  function confirmImport() {
    const current = preview();
    if (!current || !options.store.canEdit()) return;
    try {
      if (importMode() === 'replace') {
        if (current.revision !== options.store.workbook()) {
          setImportError(
            'This workbook changed since the preview opened. Close this preview and import again to review the latest version.'
          );
          return;
        }
        options.store.replaceWorkbook(current.data.sheets);
      } else options.store.appendSheets(current.data.sheets);
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
      const result = await exportWorkbookFile(
        {
          sheets: options.store.workbook().map((sheet) => ({
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
  };
}
