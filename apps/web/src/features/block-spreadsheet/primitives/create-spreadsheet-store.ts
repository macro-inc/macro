import {
  readSpreadsheetSheets,
  type SpreadsheetSheet,
} from '@macro-inc/spreadsheet/spreadsheet-sheet-registry';
import {
  parseWorkbookMetadata,
  type WorkbookSheetMetadata,
} from '@macro-inc/spreadsheet/workbook-metadata';
import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';
import type { LoroDoc, LoroEventBatch } from 'loro-crdt';
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
  appendSpreadsheetAxis,
  appendSpreadsheetRows,
  applySpreadsheetCellEntry,
  createSpreadsheetEntryReader,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_SHEET_ID,
  freshSpreadsheetCells,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseCellAddress,
  readSpreadsheetCells,
  resizeSpreadsheetColumn,
  SPREADSHEET_CELL_MAPS,
  SPREADSHEET_COLUMNS,
  SPREADSHEET_DEFAULT_STYLE,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
  SPREADSHEET_ROWS,
  type SpreadsheetCellEdits,
  type SpreadsheetCells,
  type SpreadsheetEntryReader,
  type SpreadsheetLayout,
  type SpreadsheetSelection,
  splitSpreadsheetSheetKey,
  spreadsheetSheetKey,
  validateSpreadsheetCellEdits,
  writeSpreadsheetCells,
} from '../core/spreadsheet-document';
import { createSpreadsheetHistory } from '../core/spreadsheet-history';
import {
  addSpreadsheetSheet,
  deleteSpreadsheetSheet,
  duplicateSpreadsheetSheet,
  prepareSpreadsheetImport,
  readSpreadsheetImages,
  readSpreadsheetWorkbook,
  registerSpreadsheetImport,
  renameSpreadsheetSheet,
  SPREADSHEET_IMPORT_CHUNK_CELLS,
  type SpreadsheetSheetInput,
  type SpreadsheetWorkbookSheet,
  writeSpreadsheetImportCells,
} from '../core/workbook-document';
import { yieldToPage } from '../core/yield-to-page';

const CELL_MAPS = new Set(SPREADSHEET_CELL_MAPS);

export type SpreadsheetImportOptions = {
  /** Called with the fraction of cells written. */
  onProgress?: (fraction: number) => void;
  /** Images the imported sheets draw, by key. */
  images?: Record<string, string>;
};

/** How many changes collaborators have made to the document. */
function remoteChangeCount(doc: LoroDoc) {
  let count = 0;
  for (const [peer, counter] of doc.oplogVersion().toJSON())
    if (peer !== doc.peerIdStr) count += counter;
  return count;
}
const LAYOUT_MAPS = new Set([
  'spreadsheetColumnWidths',
  'spreadsheetRowAdditions',
  'spreadsheetColumnAdditions',
]);
const REGISTRY_MAPS = new Set([
  'spreadsheetSheetNames',
  'spreadsheetSheetOrder',
  'spreadsheetDeletedSheets',
  'spreadsheetSheetRevivals',
  'spreadsheetSheetRetentions',
]);

/** Changes received since the last refresh, keyed by root map. */
type PendingChanges = {
  full: boolean;
  registry: boolean;
  cells: Map<string, Map<string, unknown>>;
  layout: Set<string>;
  metadata: Set<string>;
};
const nothingPending = (): PendingChanges => ({
  full: false,
  registry: false,
  cells: new Map(),
  layout: new Set(),
  metadata: new Set(),
});

/** Changed cell addresses per sheet; `undefined` means every cell. */
export type SpreadsheetChanges = Map<string, Set<string> | undefined>;

/** Layout from the small layout maps plus the extent of the in-memory cells,
 * matching `readSpreadsheetLayout` without scanning every document map. */
function sheetLayout(
  doc: LoroDoc,
  sheetId: string,
  cells: SpreadsheetCells
): SpreadsheetLayout {
  const prefix = sheetId === DEFAULT_SHEET_ID ? undefined : `${sheetId}!`;
  const entries = (name: string) =>
    Object.entries(doc.getMap(name).toJSON()).flatMap(([key, value]) => {
      if (prefix)
        return key.startsWith(prefix)
          ? [[key.slice(prefix.length), value] as const]
          : [];
      return key.includes('!') ? [] : [[key, value] as const];
    });
  const allocated = (name: string, initial: number, limit: number) =>
    entries(name).reduce(
      (count, [, value]) =>
        typeof value === 'number' && Number.isInteger(value) && value > 0
          ? count + Math.min(value, limit)
          : count,
      initial
    );
  let rowCount = allocated(
    'spreadsheetRowAdditions',
    SPREADSHEET_ROWS,
    SPREADSHEET_MAX_ROWS
  );
  let columnCount = allocated(
    'spreadsheetColumnAdditions',
    SPREADSHEET_COLUMNS,
    SPREADSHEET_MAX_COLUMNS
  );
  for (const address in cells) {
    const position = parseCellAddress(address);
    if (!position) continue;
    if (position.row >= rowCount) rowCount = position.row + 1;
    if (position.column >= columnCount) columnCount = position.column + 1;
  }
  const columnWidths: Record<number, number> = {};
  for (const [key, value] of entries('spreadsheetColumnWidths')) {
    const column = Number(key);
    if (
      Number.isInteger(column) &&
      column >= 0 &&
      column < SPREADSHEET_MAX_COLUMNS &&
      typeof value === 'number' &&
      Number.isFinite(value)
    )
      columnWidths[column] = Math.max(
        MIN_COLUMN_WIDTH,
        Math.min(MAX_COLUMN_WIDTH, value)
      );
  }
  return {
    rowCount: Math.min(rowCount, SPREADSHEET_MAX_ROWS),
    columnCount: Math.min(columnCount, SPREADSHEET_MAX_COLUMNS),
    columnWidths,
  };
}

export function createSpreadsheetStore(options: {
  source: SpreadsheetDocumentSource;
  canEdit: Accessor<boolean>;
}) {
  const [workbook, setWorkbook] = createSignal<SpreadsheetWorkbookSheet[]>([
    {
      id: DEFAULT_SHEET_ID,
      name: 'Sheet1',
      cells: {},
      layout: {
        rowCount: SPREADSHEET_ROWS,
        columnCount: SPREADSHEET_COLUMNS,
        columnWidths: {},
      },
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
  const [revision, setRevision] = createSignal(0);
  let history: ReturnType<typeof createSpreadsheetHistory> | undefined;
  const imageCache = new Map<string, string>();
  // Cells are patched in place: copying a large sheet's cell record on every
  // edit costs more than the edit. `revision` identifies each change instead.
  let pending = { ...nothingPending(), full: true };
  const journal: {
    revision: number;
    changes: SpreadsheetChanges | undefined;
  }[] = [];

  let listen: (() => () => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  const record = (batch: LoroEventBatch) => {
    for (const event of batch.events) {
      const root = event.path[0];
      if (
        event.path.length !== 1 ||
        typeof root !== 'string' ||
        event.diff.type !== 'map'
      ) {
        pending.full = true;
        continue;
      }
      const updated = event.diff.updated;
      if (CELL_MAPS.has(root)) {
        let entries = pending.cells.get(root);
        if (!entries) {
          entries = new Map();
          pending.cells.set(root, entries);
        }
        // A sheet this store has not read yet is read whole when the registry
        // change that adds it applies, so skip an import's cell-by-cell diff.
        let sheetId: string | undefined;
        let known = true;
        for (const key of Object.keys(updated)) {
          const separator = key.indexOf('!');
          const id =
            separator === -1 ? DEFAULT_SHEET_ID : key.slice(0, separator);
          if (id !== sheetId) {
            sheetId = id;
            known = workbook().some((sheet) => sheet.id === id);
          }
          if (known) entries.set(key, updated[key]);
        }
      } else if (LAYOUT_MAPS.has(root)) {
        for (const key of Object.keys(updated))
          pending.layout.add(splitSpreadsheetSheetKey(key).sheetId);
      } else if (root === 'spreadsheetSheetMetadata') {
        for (const key of Object.keys(updated)) pending.metadata.add(key);
      } else if (REGISTRY_MAPS.has(root)) pending.registry = true;
    }
  };

  // Cells of sheets this store just imported, which the import validated and
  // wrote unchanged; decoding them back out of Loro takes seconds when large.
  let imported: Map<string, SpreadsheetCells> | undefined;
  const readSheet = (
    doc: LoroDoc,
    sheet: SpreadsheetSheet,
    readEntries: SpreadsheetEntryReader
  ): SpreadsheetWorkbookSheet => {
    const cells =
      imported?.get(sheet.id) ??
      readSpreadsheetCells(doc, sheet.id, readEntries);
    return {
      ...sheet,
      metadata: parseWorkbookMetadata(
        doc.getMap('spreadsheetSheetMetadata').get(sheet.id)
      ),
      cells,
      layout: sheetLayout(doc, sheet.id, cells),
    };
  };

  const apply = (doc: LoroDoc): SpreadsheetChanges | undefined => {
    const changes = pending;
    pending = nothingPending();
    if (changes.full) {
      const next = readSpreadsheetWorkbook(doc);
      setWorkbook(next);
      return undefined;
    }
    const sheets = new Map(workbook().map((sheet) => [sheet.id, sheet]));
    const changed: SpreadsheetChanges = new Map();
    const touched = new Set<string>();
    let order = workbook().map((sheet) => sheet.id);
    if (changes.registry) {
      const registry = readSpreadsheetSheets(doc);
      order = registry.map((sheet) => sheet.id);
      // Each new sheet reads from one decoding of the cell maps.
      let readEntries: SpreadsheetEntryReader | undefined;
      for (const sheet of registry) {
        const current = sheets.get(sheet.id);
        if (!current) {
          readEntries ??= createSpreadsheetEntryReader(doc);
          sheets.set(sheet.id, readSheet(doc, sheet, readEntries));
          changed.set(sheet.id, undefined);
        } else if (current.name !== sheet.name) {
          sheets.set(sheet.id, { ...current, name: sheet.name });
          touched.add(sheet.id);
        }
      }
    }
    const extents = new Map<string, { rows: number; columns: number }>();
    for (const [map, entries] of changes.cells) {
      for (const [key, value] of entries) {
        const { sheetId, field } = splitSpreadsheetSheetKey(key);
        const sheet = sheets.get(sheetId);
        const position = parseCellAddress(field);
        if (
          !sheet ||
          !position ||
          (changed.has(sheetId) && !changed.get(sheetId))
        )
          continue;
        const next = applySpreadsheetCellEntry(sheet.cells[field], map, value);
        if (next) sheet.cells[field] = next;
        else delete sheet.cells[field];
        let addresses = changed.get(sheetId);
        if (!addresses) {
          addresses = new Set();
          changed.set(sheetId, addresses);
        }
        addresses.add(field);
        touched.add(sheetId);
        const extent = extents.get(sheetId) ?? { rows: 0, columns: 0 };
        extent.rows = Math.max(extent.rows, position.row + 1);
        extent.columns = Math.max(extent.columns, position.column + 1);
        extents.set(sheetId, extent);
        // A deleted edge cell may shrink an occupied extent; recompute it.
        if (
          !next &&
          (position.row + 1 >= sheet.layout.rowCount ||
            position.column + 1 >= sheet.layout.columnCount)
        )
          changes.layout.add(sheetId);
      }
    }
    for (const id of changes.layout) {
      const sheet = sheets.get(id);
      if (!sheet) continue;
      sheets.set(id, { ...sheet, layout: sheetLayout(doc, id, sheet.cells) });
      touched.add(id);
    }
    for (const [id, extent] of extents) {
      const sheet = sheets.get(id);
      if (!sheet || changes.layout.has(id)) continue;
      if (
        extent.rows > sheet.layout.rowCount ||
        extent.columns > sheet.layout.columnCount
      )
        sheets.set(id, {
          ...sheet,
          layout: {
            ...sheet.layout,
            rowCount: Math.max(sheet.layout.rowCount, extent.rows),
            columnCount: Math.max(sheet.layout.columnCount, extent.columns),
          },
        });
    }
    for (const id of changes.metadata) {
      const sheet = sheets.get(id);
      if (!sheet) continue;
      sheets.set(id, {
        ...sheet,
        metadata: parseWorkbookMetadata(
          doc.getMap('spreadsheetSheetMetadata').get(id)
        ),
      });
      touched.add(id);
    }
    if (!changes.registry && !touched.size) return changed;
    setWorkbook(order.flatMap((id) => sheets.get(id) ?? []));
    return changed;
  };

  const refresh = () => {
    const doc = options.source.doc();
    if (doc) {
      batch(() => {
        const changes = apply(doc);
        if (!changes || changes.size) {
          const next = revision() + 1;
          journal.push({ revision: next, changes });
          if (journal.length > 200) journal.splice(0, journal.length - 200);
          setRevision(next);
        }
        const sheets = workbook();
        if (!sheets.some((sheet) => sheet.id === activeSheetId())) {
          setActiveSheet(sheets[0].id);
        }
      });
    }
    setCanUndo(history?.canUndo() ?? false);
    setCanRedo(history?.canRedo() ?? false);
  };

  /** Cells changed after `since`, or undefined when a full read is needed. */
  const changesSince = (since: number): SpreadsheetChanges | undefined => {
    if (since === revision()) return new Map();
    const first = journal.findIndex((entry) => entry.revision > since);
    if (first < 0 || journal[first].revision !== since + 1) return undefined;
    const merged: SpreadsheetChanges = new Map();
    for (const { changes } of journal.slice(first)) {
      if (!changes) return undefined;
      for (const [sheetId, addresses] of changes) {
        if (merged.has(sheetId) && !merged.get(sheetId)) continue;
        if (!addresses) {
          merged.set(sheetId, undefined);
          continue;
        }
        let all = merged.get(sheetId);
        if (!all) {
          all = new Set();
          merged.set(sheetId, all);
        }
        for (const address of addresses) all.add(address);
      }
    }
    return merged;
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
      pending = { ...nothingPending(), full: true };
      listen = () =>
        doc.subscribe((batch) => {
          record(batch);
          refresh();
        });
      unsubscribe = listen();
      refresh();
      onCleanup(() => {
        unsubscribe?.();
        unsubscribe = listen = undefined;
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

  /**
   * Import sheets without holding the page: cells are written in small
   * commits under sheet ids no reader knows yet, and left out of history.
   * The final change registers the sheets; it is the import's undo step.
   */
  async function importSheets(
    inputs: SpreadsheetSheetInput[],
    replace: boolean,
    { onProgress, images }: SpreadsheetImportOptions = {}
  ): Promise<string[]> {
    const doc = options.source.doc();
    if (!doc || !editable()) return [];
    const plan = prepareSpreadsheetImport(doc, inputs, replace, images);
    const check = () => {
      if (options.source.doc() !== doc || !editable())
        throw new Error('The spreadsheet closed or became view only.');
    };
    const undo = history;
    const remote = remoteChangeCount(doc);
    // Without a listener, Loro skips building change events that list every
    // cell; the registration reads the new sheets whole.
    unsubscribe?.();
    unsubscribe = undefined;
    undo?.pause();
    let paused = !!undo;
    try {
      const formulas = await writeSpreadsheetImportCells(doc, plan, {
        chunk: SPREADSHEET_IMPORT_CHUNK_CELLS,
        pause: yieldToPage,
        check,
        onProgress,
      });
      undo?.resume();
      paused = false;
      registerSpreadsheetImport(doc, plan, formulas);
    } finally {
      if (paused) undo?.resume();
      if (options.source.doc() === doc) {
        pending.registry = true;
        // Collaborator changes made meanwhile were not recorded.
        if (remoteChangeCount(doc) !== remote) pending.full = true;
        unsubscribe = listen?.();
      }
    }
    imported = new Map(
      plan.sheets.map(({ id, input }) => [
        id,
        freshSpreadsheetCells(input.cells),
      ])
    );
    try {
      refresh();
    } finally {
      imported = undefined;
    }
    const ids = plan.sheets.map(({ id }) => id);
    setActiveSheet(ids[0]);
    return ids;
  }

  return {
    cells,
    layout,
    workbook,
    revision,
    changesSince,
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
    /** `read` gives the calculated values charts keep from the sheet. */
    deleteSheet(
      id: string,
      read?: Parameters<typeof deleteSpreadsheetSheet>[2]
    ) {
      const doc = options.source.doc();
      if (!doc || !editable()) return;
      deleteSpreadsheetSheet(doc, id, read);
      refresh();
    },
    appendSheets: (
      inputs: SpreadsheetSheetInput[],
      importOptions?: SpreadsheetImportOptions
    ) => importSheets(inputs, false, importOptions),
    replaceWorkbook: (
      inputs: SpreadsheetSheetInput[],
      importOptions?: SpreadsheetImportOptions
    ) => importSheets(inputs, true, importOptions),
    /** The workbook's images by key, for export. */
    images: (keys: Iterable<string>) => {
      const doc = options.source.doc();
      return doc ? readSpreadsheetImages(doc, new Set(keys)) : {};
    },
    /** One image's data URL; images never change, so each is read once. */
    image(key: string) {
      const doc = options.source.doc();
      if (!doc) return;
      let url = imageCache.get(key);
      if (url === undefined) {
        url = readSpreadsheetImages(doc, [key])[key];
        if (url !== undefined) imageCache.set(key, url);
      }
      return url;
    },
    rowCount: () => layout().rowCount,
    columnCount: () => layout().columnCount,
    appendColumns(count: number) {
      const doc = options.source.doc();
      if (!doc || !editable()) return;
      appendSpreadsheetAxis(doc, 'column', count, activeSheetId());
      refresh();
    },
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
      next: SpreadsheetWorkbookSheet[],
      expectedRevision: number
    ) {
      const doc = options.source.doc();
      if (!doc || !editable())
        throw new Error('This spreadsheet is view only.');
      if (options.source.status() !== 'local')
        throw new Error(
          'Inserting and deleting rows or columns is not yet available in shared workbooks.'
        );
      if (revision() !== expectedRevision)
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
