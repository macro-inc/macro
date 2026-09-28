import { type LoroDoc, LoroMap } from 'loro-crdt';
import { match } from 'ts-pattern';
import {
  isSpreadsheetStyleEntry,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseCellAddress,
  SPREADSHEET_COLUMNS,
  SPREADSHEET_FORMAT_VERSION,
  SPREADSHEET_MAX_CELL_LENGTH,
  SPREADSHEET_MAX_ROWS,
} from './spreadsheet-document';
import { SPREADSHEET_LORO_SCHEMA } from './spreadsheet-schema';
import {
  isSpreadsheetSheetId,
  validateSpreadsheetSheetName,
} from './spreadsheet-sheet-registry';
import { parseWorkbookMetadata } from './workbook-metadata';

const MAX_DOCUMENT_ENTRIES = 1_000_000;
const textEncoder = new TextEncoder();
const knownRoots = new Set([
  'spreadsheetMeta',
  ...Object.keys(SPREADSHEET_LORO_SCHEMA.definition),
]);

function sheetName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return validateSpreadsheetSheetName(value) === value;
  } catch {
    return false;
  }
}

function sheetKey(key: string): string | undefined {
  const parts = key.split('!');
  if (parts.length === 1) return key;
  if (parts.length === 2 && isSpreadsheetSheetId(parts[0])) return parts[1];
}

function integer(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function retainedSheet(key: string, value: unknown): boolean {
  const separator = key.indexOf('!');
  if (
    separator < 0 ||
    !isSpreadsheetSheetId(key.slice(0, separator)) ||
    !key.slice(separator + 1).length ||
    textEncoder.encode(key.slice(separator + 1)).length > 64 ||
    typeof value !== 'string' ||
    textEncoder.encode(value).length > 512
  )
    return false;
  try {
    const identity = JSON.parse(value);
    return (
      !!identity &&
      sheetName(identity.name) &&
      Number.isFinite(identity.order) &&
      Number.isFinite(identity.revision) &&
      identity.revision >= 0
    );
  } catch {
    return false;
  }
}

function validEntry(root: string, key: string, value: unknown): boolean {
  return match(root)
    .with(
      'spreadsheetMeta',
      () => key === 'formatVersion' && value === SPREADSHEET_FORMAT_VERSION
    )
    .with(
      'spreadsheetSheetMetadata',
      () => isSpreadsheetSheetId(key) && !!parseWorkbookMetadata(value)
    )
    .with(
      'spreadsheetSheetNames',
      () => isSpreadsheetSheetId(key) && sheetName(value)
    )
    .with(
      'spreadsheetSheetOrder',
      () => isSpreadsheetSheetId(key) && Number.isFinite(value)
    )
    .with(
      'spreadsheetDeletedSheets',
      () => isSpreadsheetSheetId(key) && typeof value === 'boolean'
    )
    .with(
      'spreadsheetSheetRevivals',
      () => textEncoder.encode(key).length <= 200 && isSpreadsheetSheetId(value)
    )
    .with('spreadsheetSheetRetentions', () => retainedSheet(key, value))
    .otherwise(() => validCellEntry(root, key, value));
}

function validCellEntry(root: string, key: string, value: unknown): boolean {
  const field = sheetKey(key);
  if (field === undefined) return false;
  if (root === 'spreadsheetColumnWidths')
    return (
      /^\d+$/.test(field) &&
      Number(field) < SPREADSHEET_COLUMNS &&
      integer(value, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH)
    );
  if (root === 'spreadsheetRowAdditions')
    return (
      field.length > 0 &&
      textEncoder.encode(field).length <= 64 &&
      integer(value, 1, SPREADSHEET_MAX_ROWS)
    );
  if (!parseCellAddress(field)) return false;
  if (root === 'spreadsheetValues')
    return (
      typeof value === 'string' && value.length <= SPREADSHEET_MAX_CELL_LENGTH
    );
  return isSpreadsheetStyleEntry(root, value);
}

/** Validate native workbook state at the spreadsheet business boundary.
 * Sync stores arbitrary CRDT documents; it does not enforce this schema.
 */
export function validateSpreadsheetDocument(doc: LoroDoc): void {
  const invalid = () =>
    new Error(
      'Only native spreadsheet maps with supported values may be edited.'
    );
  let entries = 0;
  let formatVersion: unknown;
  // Inspect actual containers and entries, not deep JSON, which turns nested
  // text/counter containers into scalars indistinguishable from cell values.
  for (const [name, id] of Object.entries(doc.getShallowValue())) {
    const container = doc.getContainerById(id);
    if (!knownRoots.has(name) || !(container instanceof LoroMap))
      throw invalid();
    entries += container.size;
    if (entries > MAX_DOCUMENT_ENTRIES)
      throw new Error('The spreadsheet exceeds the supported entry limit.');
    for (const [key, value] of container.entries()) {
      if (
        !['string', 'boolean', 'number'].includes(typeof value) ||
        !validEntry(name, key, value)
      )
        throw invalid();
      if (name === 'spreadsheetMeta' && key === 'formatVersion')
        formatVersion = value;
    }
  }
  if (formatVersion !== SPREADSHEET_FORMAT_VERSION) throw invalid();
}
