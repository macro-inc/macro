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
  metadata?: WorkbookSheetMetadata;
};
export type SpreadsheetSheetInput = {
  name: string;
  cells: SpreadsheetCells;
  rowCount: number;
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
  const globalNames = new Set(
    (replace ? [] : readSpreadsheetWorkbook(doc)).flatMap((sheet) =>
      (sheet.metadata?.definedNames ?? [])
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
    if (sheet.metadata)
      doc
        .getMap('spreadsheetSheetMetadata')
        .set(id, JSON.stringify(sheet.metadata));
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
