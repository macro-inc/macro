import {
  parseWorkbookMetadata,
  type WorkbookSheetMetadata,
} from '@macro-inc/spreadsheet/workbook-metadata';
import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type { SpreadsheetDocumentSource } from '../context/spreadsheet-source';
import {
  appendSpreadsheetRows,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_SHEET_ID,
  resizeSpreadsheetColumn,
  SPREADSHEET_DEFAULT_STYLE,
  SPREADSHEET_ROWS,
  type SpreadsheetCellEdits,
  type SpreadsheetSelection,
  spreadsheetSheetKey,
  validateSpreadsheetCellEdits,
  writeSpreadsheetCells,
} from '../core/spreadsheet-document';
import { createSpreadsheetHistory } from '../core/spreadsheet-history';
import {
  addSpreadsheetSheet,
  deleteSpreadsheetSheet,
  duplicateSpreadsheetSheet,
  importSpreadsheetSheets,
  readSpreadsheetWorkbook,
  renameSpreadsheetSheet,
  type SpreadsheetSheetInput,
  type SpreadsheetWorkbookSheet,
} from '../core/workbook-document';

export function createSpreadsheetStore(options: {
  source: SpreadsheetDocumentSource;
  canEdit: Accessor<boolean>;
}) {
  const [workbook, setWorkbook] = createSignal<SpreadsheetWorkbookSheet[]>([
    {
      id: DEFAULT_SHEET_ID,
      name: 'Sheet1',
      cells: {},
      layout: { rowCount: SPREADSHEET_ROWS, columnWidths: {} },
    },
  ]);
  const [selection, setLocalSelection] = createSignal<SpreadsheetSelection>();
  const selections = new Map<string, SpreadsheetSelection>();
  const publishSelection = leadingAndTrailing(
    throttle,
    options.source.setSelection,
    100
  );
  const [activeSheetId, setActiveSheetId] = createSignal(DEFAULT_SHEET_ID);
  const activeSheet = () =>
    workbook().find((sheet) => sheet.id === activeSheetId()) ?? workbook()[0];
  const cells = () => activeSheet().cells;
  const layout = () => activeSheet().layout;
  const [canUndo, setCanUndo] = createSignal(false);
  const [canRedo, setCanRedo] = createSignal(false);
  const [historyError, setHistoryError] = createSignal<string>();
  let history: ReturnType<typeof createSpreadsheetHistory> | undefined;

  const refresh = () => {
    const doc = options.source.doc();
    if (doc) {
      const next = readSpreadsheetWorkbook(doc);
      batch(() => {
        setWorkbook(next);
        if (!next.some((sheet) => sheet.id === activeSheetId())) {
          setActiveSheet(next[0].id);
        }
      });
    }
    setCanUndo(history?.canUndo() ?? false);
    setCanRedo(history?.canRedo() ?? false);
  };

  // Loro is an external imperative system; subscribe only once hydration has
  // supplied its document. Resetting a sync session also replaces its history.
  createEffect(
    on(options.source.doc, (doc) => {
      if (!doc) return;
      setHistoryError(undefined);
      const undo = createSpreadsheetHistory(doc, () =>
        setHistoryError(undefined)
      );
      history = undo;
      const unsubscribe = doc.subscribe(refresh);
      refresh();
      onCleanup(() => {
        unsubscribe();
        undo.free();
        if (history === undo) history = undefined;
      });
    })
  );

  const editable = () => options.source.ready() && options.canEdit();

  function setActiveSheet(id: string) {
    if (!workbook().some((sheet) => sheet.id === id)) return;
    publishSelection.clear();
    batch(() => {
      setActiveSheetId(id);
      setLocalSelection(selections.get(id));
      options.source.setSelection(selections.get(id));
    });
  }

  function importSheets(inputs: SpreadsheetSheetInput[], replace: boolean) {
    const doc = options.source.doc();
    if (!doc || !editable()) return [];
    const ids = importSpreadsheetSheets(doc, inputs, replace);
    refresh();
    setActiveSheet(ids[0]);
    return ids;
  }

  return {
    cells,
    layout,
    workbook,
    sheets: () => workbook().map(({ id, name }) => ({ id, name })),
    activeSheetId,
    activeSheet,
    selection,
    setActiveSheet,
    addSheet(name?: string) {
      const doc = options.source.doc();
      if (!doc || !editable()) return;
      const id = addSpreadsheetSheet(doc, name);
      refresh();
      setActiveSheet(id);
      return id;
    },
    renameSheet(id: string, name: string) {
      const doc = options.source.doc();
      if (!doc || !editable()) return;
      renameSpreadsheetSheet(doc, id, name);
      refresh();
    },
    duplicateSheet(id: string) {
      const doc = options.source.doc();
      if (!doc || !editable()) return;
      const created = duplicateSpreadsheetSheet(doc, id);
      refresh();
      setActiveSheet(created);
      return created;
    },
    deleteSheet(id: string) {
      const doc = options.source.doc();
      if (!doc || !editable()) return;
      deleteSpreadsheetSheet(doc, id);
      refresh();
    },
    appendSheets: (inputs: SpreadsheetSheetInput[]) =>
      importSheets(inputs, false),
    replaceWorkbook: (inputs: SpreadsheetSheetInput[]) =>
      importSheets(inputs, true),
    rowCount: () => layout().rowCount,
    resizeColumn(column: number, width: number) {
      const doc = options.source.doc();
      if (!doc || !editable()) return;
      resizeSpreadsheetColumn(doc, column, width, activeSheetId());
      refresh();
    },
    setMetadata(metadata: WorkbookSheetMetadata) {
      const doc = options.source.doc();
      if (!doc || !editable()) return;
      const encoded = JSON.stringify(metadata);
      if (!parseWorkbookMetadata(encoded))
        throw new Error('Invalid sheet layout.');
      doc.getMap('spreadsheetSheetMetadata').set(activeSheetId(), encoded);
      doc.commit({ origin: 'spreadsheet-layout' });
      refresh();
    },
    canChangeStructure: () => editable() && options.source.status() === 'local',
    applyStructure(
      expected: SpreadsheetWorkbookSheet[],
      next: SpreadsheetWorkbookSheet[]
    ) {
      const doc = options.source.doc();
      if (!doc || !editable())
        throw new Error('This spreadsheet is view only.');
      if (options.source.status() !== 'local')
        throw new Error(
          'Inserting and deleting rows or columns is not yet available in shared workbooks.'
        );
      if (
        JSON.stringify(readSpreadsheetWorkbook(doc)) !==
        JSON.stringify(expected)
      )
        throw new Error(
          'The workbook changed while moving cells. No changes were applied; try again.'
        );
      for (const sheet of next) {
        validateSpreadsheetCellEdits(sheet.cells);
        if (
          sheet.metadata &&
          !parseWorkbookMetadata(JSON.stringify(sheet.metadata))
        )
          throw new Error(
            'The changed layout would exceed the supported sheet size.'
          );
      }
      for (const sheet of next) {
        const previous = expected.find((item) => item.id === sheet.id)!;
        const edits: SpreadsheetCellEdits = {};
        for (const address of new Set([
          ...Object.keys(previous.cells),
          ...Object.keys(sheet.cells),
        ])) {
          if (
            JSON.stringify(previous.cells[address]) !==
            JSON.stringify(sheet.cells[address])
          )
            edits[address] = sheet.cells[address]
              ? { ...SPREADSHEET_DEFAULT_STYLE, ...sheet.cells[address] }
              : null;
        }
        writeSpreadsheetCells(doc, edits, sheet.id, false);
        if (
          JSON.stringify(previous.metadata) !== JSON.stringify(sheet.metadata)
        )
          doc
            .getMap('spreadsheetSheetMetadata')
            .set(sheet.id, JSON.stringify(sheet.metadata ?? {}));
        for (const key of new Set([
          ...Object.keys(previous.layout.columnWidths),
          ...Object.keys(sheet.layout.columnWidths),
        ])) {
          if (
            previous.layout.columnWidths[Number(key)] !==
            sheet.layout.columnWidths[Number(key)]
          )
            resizeSpreadsheetColumn(
              doc,
              Number(key),
              sheet.layout.columnWidths[Number(key)] ?? DEFAULT_COLUMN_WIDTH,
              sheet.id,
              false
            );
        }
        const addition = sheet.layout.rowCount - previous.layout.rowCount;
        if (addition > 0)
          doc
            .getMap('spreadsheetRowAdditions')
            .set(spreadsheetSheetKey(crypto.randomUUID(), sheet.id), addition);
      }
      doc.commit({ origin: 'spreadsheet-axis-change' });
      refresh();
    },
    appendRows(count: number) {
      const doc = options.source.doc();
      if (!doc || !editable()) return;
      appendSpreadsheetRows(doc, count, activeSheetId());
      refresh();
    },
    ready: options.source.ready,
    error: () => options.source.error() ?? historyError(),
    status: options.source.status,
    peers: () =>
      options.source
        .peers()
        .filter(
          (peer) =>
            (peer.selection.sheetId ?? DEFAULT_SHEET_ID) === activeSheetId()
        ),
    canEdit: editable,
    canUndo: () => editable() && canUndo(),
    canRedo: () => editable() && canRedo(),
    setSelection(selection: SpreadsheetSelection | undefined) {
      const current = selection
        ? { ...selection, sheetId: activeSheetId() }
        : undefined;
      setLocalSelection(current);
      if (current) selections.set(activeSheetId(), current);
      else selections.delete(activeSheetId());
      publishSelection(current);
    },
    setSheetCells(id: string, edits: SpreadsheetCellEdits) {
      const doc = options.source.doc();
      if (!doc || !editable() || !workbook().some((sheet) => sheet.id === id))
        return;
      writeSpreadsheetCells(doc, edits, id);
      refresh();
    },
    setCells(edits: SpreadsheetCellEdits) {
      const doc = options.source.doc();
      if (!doc || !editable()) return;
      writeSpreadsheetCells(doc, edits, activeSheetId());
      refresh();
    },
    undo() {
      if (!editable()) return;
      setHistoryError(history?.undo());
      refresh();
    },
    redo() {
      if (!editable()) return;
      setHistoryError(history?.redo());
      refresh();
    },
  };
}

export type SpreadsheetStore = ReturnType<typeof createSpreadsheetStore>;
