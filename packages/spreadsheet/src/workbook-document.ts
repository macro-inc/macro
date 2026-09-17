import type { LoroDoc } from 'loro-crdt';
import { formulaReferencesSheet } from './sheet-references';

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
  SPREADSHEET_MAX_ROWS,
  SPREADSHEET_ROWS,
  type SpreadsheetCells,
  type SpreadsheetLayout,
  spreadsheetSheetKey,
  validateSpreadsheetCellEdits,
  writeSpreadsheetCells,
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

export const SPREADSHEET_MAX_SHEETS = 10;
export type SpreadsheetWorkbookSheet = SpreadsheetSheet & {
  cells: SpreadsheetCells;
  layout: SpreadsheetLayout;
};
export type SpreadsheetSheetInput = {
  name: string;
  cells: SpreadsheetCells;
  rowCount: number;
  columnWidths: Record<number, number>;
};

export function readSpreadsheetWorkbook(
  doc: LoroDoc
): SpreadsheetWorkbookSheet[] {
  const readEntries = createSpreadsheetEntryReader(doc);
  return readSpreadsheetSheets(doc).map((sheet) => ({
    ...sheet,
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
  replace: boolean
) {
  if (!inputs.length)
    throw new Error('A workbook must contain at least one sheet.');
  const existing = replace ? [] : readSpreadsheetSheets(doc);
  if (existing.length + inputs.length > SPREADSHEET_MAX_SHEETS)
    throw new Error(
      `A workbook can contain up to ${SPREADSHEET_MAX_SHEETS} sheets.`
    );
  const names = new Set(existing.map((sheet) => sheet.name.toLowerCase()));
  for (const sheet of inputs) {
    const name = validateSpreadsheetSheetName(sheet.name);
    if (name !== sheet.name)
      throw new Error(
        'Imported sheet names cannot begin or end with whitespace.'
      );
    if (names.has(name.toLowerCase()))
      throw new Error(`A sheet named “${name}” already exists.`);
    names.add(name.toLowerCase());
    if (
      !Number.isInteger(sheet.rowCount) ||
      sheet.rowCount < 1 ||
      sheet.rowCount > SPREADSHEET_MAX_ROWS
    )
      throw new Error(
        `Sheets must contain between 1 and ${SPREADSHEET_MAX_ROWS} rows.`
      );
    for (const [address, cell] of Object.entries(sheet.cells)) {
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
        column >= SPREADSHEET_COLUMNS ||
        !Number.isFinite(width) ||
        width < MIN_COLUMN_WIDTH ||
        width > MAX_COLUMN_WIDTH
      )
        throw new Error('A sheet contains an unsupported column width.');
    }
  }
}

/** Validate the entire workbook before the first CRDT mutation; one undo step. */
export function importSpreadsheetSheets(
  doc: LoroDoc,
  inputs: SpreadsheetSheetInput[],
  replace = false
): string[] {
  validateSheetInputs(doc, inputs, replace);
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
  const ids = inputs.map(() => crypto.randomUUID());
  if (!replace) reviveSpreadsheetFallback(doc);
  if (replace) {
    for (const sheet of oldSheets) tombstoneSpreadsheetSheet(doc, sheet.id);
  }
  inputs.forEach((sheet, index) => {
    const id = ids[index];
    doc.getMap('spreadsheetSheetNames').set(id, sheet.name);
    doc.getMap('spreadsheetSheetOrder').set(id, order + index + 1);
    writeSpreadsheetCells(doc, sheet.cells, id, false);
    if (sheet.rowCount > SPREADSHEET_ROWS) {
      doc
        .getMap('spreadsheetRowAdditions')
        .set(
          spreadsheetSheetKey(crypto.randomUUID(), id),
          sheet.rowCount - SPREADSHEET_ROWS
        );
    }
    for (const [column, width] of Object.entries(sheet.columnWidths))
      resizeSpreadsheetColumn(doc, Number(column), width, id, false);
  });
  doc.commit({
    origin: replace ? 'spreadsheet-workbook-replace' : 'spreadsheet-sheet-add',
  });
  return ids;
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
  return importSpreadsheetSheets(doc, [
    {
      name: availableSheetName(doc, sheet.name),
      cells: readSpreadsheetCells(doc, sheetId),
      ...readSpreadsheetLayout(doc, sheetId),
    },
  ])[0];
}
