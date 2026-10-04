import type { LoroDoc } from 'loro-crdt';
import { formulaReferencesSheet } from './sheet-references';
import {
  parseWorkbookMetadata,
  type WorkbookSheetMetadata,
} from './workbook-metadata';

export { formulaReferencesSheet } from './sheet-references';

import {
  createSpreadsheetEntryReader,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseCellAddress,
  readSpreadsheetCells,
  readSpreadsheetLayout,
  resizeSpreadsheetColumn,
  SPREADSHEET_COLUMNS,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
  SPREADSHEET_ROWS,
  type SpreadsheetCells,
  type SpreadsheetLayout,
  spreadsheetSheetKey,
  validateSpreadsheetCellEdits,
  writeFreshSpreadsheetCells,
} from './spreadsheet-document';

import {
  readSpreadsheetSheets,
  retainSpreadsheetSheets,
  reviveSpreadsheetFallback,
  type SpreadsheetSheet,
  tombstoneSpreadsheetSheet,
  validateSpreadsheetSheetName,
} from './spreadsheet-sheet-registry';

export {
  isSpreadsheetSheetId,
  readSpreadsheetSheets,
  type SpreadsheetSheet,
  validateSpreadsheetSheetName,
} from './spreadsheet-sheet-registry';

export const SPREADSHEET_MAX_SHEETS = 300;
export type SpreadsheetWorkbookSheet = SpreadsheetSheet & {
  cells: SpreadsheetCells;
  layout: SpreadsheetLayout;
  metadata?: WorkbookSheetMetadata;
};
export type SpreadsheetSheetInput = {
  name: string;
  cells: SpreadsheetCells;
  rowCount: number;
  /** Defaults to the columns that the cells and widths occupy. */
  columnCount?: number;
  columnWidths: Record<number, number>;
  metadata?: WorkbookSheetMetadata;
};

export function readSpreadsheetWorkbook(
  doc: LoroDoc
): SpreadsheetWorkbookSheet[] {
  const readEntries = createSpreadsheetEntryReader(doc);
  return readSpreadsheetSheets(doc).map((sheet) => ({
    ...sheet,
    metadata: parseWorkbookMetadata(
      doc.getMap('spreadsheetSheetMetadata').get(sheet.id)
    ),
    cells: readSpreadsheetCells(doc, sheet.id, readEntries),
    layout: readSpreadsheetLayout(doc, sheet.id, readEntries),
  }));
}

function existingSheet(doc: LoroDoc, sheetId: string): SpreadsheetSheet {
  const sheet = readSpreadsheetSheets(doc).find((item) => item.id === sheetId);
  if (!sheet) throw new Error('This sheet no longer exists.');
  return sheet;
}

function uniqueRequestedName(
  doc: LoroDoc,
  name: string,
  exceptId?: string
): string {
  const normalized = validateSpreadsheetSheetName(name);
  if (
    readSpreadsheetSheets(doc).some(
      (sheet) =>
        sheet.id !== exceptId &&
        sheet.name.toLowerCase() === normalized.toLowerCase()
    )
  )
    throw new Error(`A sheet named “${normalized}” already exists.`);
  return normalized;
}

function availableSheetName(doc: LoroDoc, base?: string): string {
  const names = new Set(
    readSpreadsheetSheets(doc).map((sheet) => sheet.name.toLowerCase())
  );
  for (let index = base ? 2 : 1; ; index++) {
    const ending = base ? ` (${index})` : '';
    const name = base
      ? `${base.slice(0, 31 - ending.length)}${ending}`
      : `Sheet${index}`;
    if (!names.has(name.toLowerCase())) return name;
  }
}

function assertUnreferenced(doc: LoroDoc, sheet: SpreadsheetSheet) {
  for (const current of readSpreadsheetWorkbook(doc)) {
    if (current.id === sheet.id && current.metadata?.definedNames?.length)
      throw new Error(
        `“${sheet.name}” contains Excel name definitions. Keep the sheet name while those definitions are in use.`
      );
    if (
      current.metadata?.definedNames?.some((entry) =>
        formulaReferencesSheet(
          `=${entry.formula.replace(/^=/, '')}`,
          sheet.name
        )
      )
    )
      throw new Error(
        `“${sheet.name}” is referenced by an Excel name definition.`
      );
    for (const cell of Object.values(current.cells)) {
      if (
        cell.format !== 'text' &&
        formulaReferencesSheet(cell.value, sheet.name)
      )
        throw new Error(
          `“${sheet.name}” is referenced by a formula. Update its sheet references before renaming or deleting it.`
        );
    }
  }
}

export function renameSpreadsheetSheet(
  doc: LoroDoc,
  sheetId: string,
  name: string
) {
  const sheet = existingSheet(doc, sheetId);
  const normalized = uniqueRequestedName(doc, name, sheetId);
  if (normalized === sheet.name) return;
  assertUnreferenced(doc, sheet);
  reviveSpreadsheetFallback(doc, sheetId);
  doc.getMap('spreadsheetSheetNames').set(sheetId, normalized);
  retainSpreadsheetSheets(doc, sheetId);
  doc.commit({ origin: 'spreadsheet-sheet-rename' });
}

export function deleteSpreadsheetSheet(doc: LoroDoc, sheetId: string) {
  const sheets = readSpreadsheetSheets(doc);
  const sheet = existingSheet(doc, sheetId);
  if (sheets.length <= 1)
    throw new Error('A workbook must have at least one sheet.');
  assertUnreferenced(doc, sheet);
  tombstoneSpreadsheetSheet(doc, sheetId);
  doc.commit({ origin: 'spreadsheet-sheet-delete' });
}

function validateSheetInputs(
  doc: LoroDoc,
  inputs: SpreadsheetSheetInput[],
  replace: boolean,
  /** Only names and counts, which collaborators can change meanwhile. */
  namesOnly = false
) {
  if (!inputs.length)
    throw new Error('A workbook must contain at least one sheet.');
  const existing = replace ? [] : readSpreadsheetSheets(doc);
  if (existing.length + inputs.length > SPREADSHEET_MAX_SHEETS)
    throw new Error(
      `A workbook can contain up to ${SPREADSHEET_MAX_SHEETS} sheets.`
    );
  const names = new Set(existing.map((sheet) => sheet.name.toLowerCase()));
  // Only names matter here; reading every cell of a large workbook would not.
  const metadata = doc.getMap('spreadsheetSheetMetadata');
  const globalNames = new Set(
    existing.flatMap((sheet) =>
      (parseWorkbookMetadata(metadata.get(sheet.id))?.definedNames ?? [])
        .filter((entry) => !entry.local)
        .map((entry) => entry.name.toLowerCase())
    )
  );
  for (const sheet of inputs) {
    if (
      sheet.metadata &&
      !parseWorkbookMetadata(JSON.stringify(sheet.metadata))
    )
      throw new Error('Invalid Excel workbook metadata.');
    const localNames = new Set<string>();
    for (const entry of sheet.metadata?.definedNames ?? []) {
      const definitions = entry.local ? localNames : globalNames;
      const key = entry.name.toLowerCase();
      if (definitions.has(key))
        throw new Error(`Duplicate Excel name: ${entry.name}`);
      definitions.add(key);
    }
    const name = validateSpreadsheetSheetName(sheet.name);
    if (name !== sheet.name)
      throw new Error(
        'Imported sheet names cannot begin or end with whitespace.'
      );
    if (names.has(name.toLowerCase()))
      throw new Error(`A sheet named “${name}” already exists.`);
    names.add(name.toLowerCase());
    if (namesOnly) continue;
    if (
      !Number.isInteger(sheet.rowCount) ||
      sheet.rowCount < 1 ||
      sheet.rowCount > SPREADSHEET_MAX_ROWS
    )
      throw new Error(
        `Sheets must contain between 1 and ${SPREADSHEET_MAX_ROWS.toLocaleString('en-US')} rows.`
      );
    if (
      sheet.columnCount !== undefined &&
      (!Number.isInteger(sheet.columnCount) ||
        sheet.columnCount < 1 ||
        sheet.columnCount > SPREADSHEET_MAX_COLUMNS)
    )
      throw new Error(
        `Sheets must contain between 1 and ${SPREADSHEET_MAX_COLUMNS.toLocaleString('en-US')} columns.`
      );
    for (const address in sheet.cells) {
      const cell = sheet.cells[address];
      if (!parseCellAddress(address))
        throw new Error(`Cell ${address} is outside the supported sheet size.`);
      if (!cell || typeof cell.value !== 'string')
        throw new Error(`Cell ${address} has an invalid value.`);
    }
    validateSpreadsheetCellEdits(sheet.cells);
    for (const [key, width] of Object.entries(sheet.columnWidths)) {
      const column = Number(key);
      if (
        !Number.isInteger(column) ||
        column < 0 ||
        column >= SPREADSHEET_MAX_COLUMNS ||
        !Number.isFinite(width) ||
        width < MIN_COLUMN_WIDTH ||
        width > MAX_COLUMN_WIDTH
      )
        throw new Error('A sheet contains an unsupported column width.');
    }
  }
}

/** Imported sheets and the ids they will have. */
export type SpreadsheetImport = {
  replace: boolean;
  sheets: { id: string; input: SpreadsheetSheetInput }[];
};

/** Validate an import before its first CRDT mutation and choose sheet ids. */
export function prepareSpreadsheetImport(
  doc: LoroDoc,
  inputs: SpreadsheetSheetInput[],
  replace = false
): SpreadsheetImport {
  validateSheetInputs(doc, inputs, replace);
  return {
    replace,
    sheets: inputs.map((input) => ({ id: crypto.randomUUID(), input })),
  };
}

/**
 * Make imported sheets visible, replacing the workbook's sheets if asked.
 * Their cells must already be written: until this change no reader knows
 * their ids, so a large import can write cells in several steps and still
 * take effect, and undo, as one small change.
 */
export function registerSpreadsheetImport(
  doc: LoroDoc,
  plan: SpreadsheetImport,
  /** Each sheet's formulas, as writing its cells returned them. */
  formulas: ReadonlyMap<string, string[]>
): void {
  const inputs = plan.sheets.map(({ input }) => input);
  // Collaborators may have added or renamed sheets since the import began.
  validateSheetInputs(doc, inputs, plan.replace, true);
  const oldSheets = readSpreadsheetSheets(doc);
  const existingOrder = Object.values(
    doc.getMap('spreadsheetSheetOrder').toJSON()
  );
  const order = existingOrder.reduce<number>(
    (maximum, value) =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(maximum, value)
        : maximum,
    0
  );
  if (!plan.replace) reviveSpreadsheetFallback(doc);
  if (plan.replace) {
    for (const sheet of oldSheets) tombstoneSpreadsheetSheet(doc, sheet.id);
  }
  plan.sheets.forEach(({ id, input: sheet }, index) => {
    if (sheet.metadata)
      doc
        .getMap('spreadsheetSheetMetadata')
        .set(id, JSON.stringify(sheet.metadata));
    doc.getMap('spreadsheetSheetNames').set(id, sheet.name);
    doc.getMap('spreadsheetSheetOrder').set(id, order + index + 1);
    if (sheet.rowCount > SPREADSHEET_ROWS) {
      doc
        .getMap('spreadsheetRowAdditions')
        .set(
          spreadsheetSheetKey(crypto.randomUUID(), id),
          sheet.rowCount - SPREADSHEET_ROWS
        );
    }
    if ((sheet.columnCount ?? 0) > SPREADSHEET_COLUMNS) {
      doc
        .getMap('spreadsheetColumnAdditions')
        .set(
          spreadsheetSheetKey(crypto.randomUUID(), id),
          (sheet.columnCount ?? 0) - SPREADSHEET_COLUMNS
        );
    }
    for (const [column, width] of Object.entries(sheet.columnWidths))
      resizeSpreadsheetColumn(doc, Number(column), width, id, false);
  });
  for (const { id } of plan.sheets)
    retainSpreadsheetSheets(doc, id, formulas.get(id) ?? []);
  doc.commit({
    origin: plan.replace
      ? 'spreadsheet-workbook-replace'
      : 'spreadsheet-sheet-add',
  });
}

/** Cells an import writes per commit, so a page responds between them. */
export const SPREADSHEET_IMPORT_CHUNK_CELLS = 5_000;

/**
 * Write a prepared import's cells in commits of at most `chunk` cells,
 * awaiting `pause` after each so a page stays responsive. Returns each
 * sheet's formulas for `registerSpreadsheetImport`. `check` runs before each
 * commit and throws to stop the import.
 */
export async function writeSpreadsheetImportCells(
  doc: LoroDoc,
  plan: SpreadsheetImport,
  options: {
    chunk: number;
    pause: () => Promise<void>;
    check?: () => void;
    onProgress?: (fraction: number) => void;
  }
): Promise<Map<string, string[]>> {
  const total = plan.sheets.reduce(
    (sum, { input }) => sum + Object.keys(input.cells).length,
    0
  );
  const formulas = new Map<string, string[]>();
  let written = 0;
  for (const { id, input } of plan.sheets) {
    const entries = Object.entries(input.cells);
    const sheetFormulas: string[] = [];
    for (let start = 0; start < entries.length; start += options.chunk) {
      options.check?.();
      const chunk = entries.slice(start, start + options.chunk);
      for (const formula of writeFreshSpreadsheetCells(doc, chunk, id))
        sheetFormulas.push(formula);
      doc.commit({ origin: 'spreadsheet-import-cells' });
      written += chunk.length;
      options.onProgress?.(written / total);
      await options.pause();
    }
    formulas.set(id, sheetFormulas);
  }
  options.check?.();
  return formulas;
}

/** Validate the entire workbook before the first CRDT mutation; one undo step. */
export function importSpreadsheetSheets(
  doc: LoroDoc,
  inputs: SpreadsheetSheetInput[],
  replace = false
): string[] {
  const plan = prepareSpreadsheetImport(doc, inputs, replace);
  const formulas = new Map(
    plan.sheets.map(({ id, input }) => [
      id,
      writeFreshSpreadsheetCells(doc, Object.entries(input.cells), id),
    ])
  );
  registerSpreadsheetImport(doc, plan, formulas);
  return plan.sheets.map(({ id }) => id);
}

export function addSpreadsheetSheet(doc: LoroDoc, name?: string): string {
  const normalized =
    name === undefined
      ? availableSheetName(doc)
      : uniqueRequestedName(doc, name);
  return importSpreadsheetSheets(doc, [
    {
      name: normalized,
      cells: {},
      rowCount: SPREADSHEET_ROWS,
      columnWidths: {},
    },
  ])[0];
}

export function duplicateSpreadsheetSheet(
  doc: LoroDoc,
  sheetId: string
): string {
  const sheet = existingSheet(doc, sheetId);
  const metadata = parseWorkbookMetadata(
    doc.getMap('spreadsheetSheetMetadata').get(sheetId)
  );
  if (metadata?.definedNames)
    metadata.definedNames = metadata.definedNames.filter(
      (entry) => entry.local
    );
  return importSpreadsheetSheets(doc, [
    {
      name: availableSheetName(doc, sheet.name),
      metadata,
      cells: readSpreadsheetCells(doc, sheetId),
      ...readSpreadsheetLayout(doc, sheetId),
    },
  ])[0];
}
