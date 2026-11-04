import type { LoroDoc } from 'loro-crdt';
import {
  MAX_SHEET_TABLES,
  nextTableName,
  type SheetTable,
  tableBounds,
  validSheetTable,
} from './sheet-tables';
import {
  splitSpreadsheetSheetKey,
  spreadsheetSheetKey,
} from './spreadsheet-document';
import {
  parseWorkbookMetadata,
  type WorkbookSheetMetadata,
} from './workbook-metadata';

const TABLES = 'spreadsheetTables';
const METADATA = 'spreadsheetSheetMetadata';
const MAX_TABLE_ID_LENGTH = 64;
const MAX_TABLE_ENTRY_LENGTH = 1_000_000;

/** A stored table entry: its key holds the sheet and table ids, its value
 * the table without its id. */
export function parseStoredTable(
  id: string,
  value: unknown
): SheetTable | undefined {
  if (
    !id ||
    id.length > MAX_TABLE_ID_LENGTH ||
    id.includes('!') ||
    typeof value !== 'string' ||
    value.length > MAX_TABLE_ENTRY_LENGTH
  )
    return;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      'id' in parsed
    )
      return;
    const table = { ...parsed, id };
    return validSheetTable(table) ? table : undefined;
  } catch {
    return;
  }
}

function overlaps(first: SheetTable, second: SheetTable) {
  const a = tableBounds(first);
  const b = tableBounds(second);
  return (
    a.top <= b.bottom &&
    a.bottom >= b.top &&
    a.left <= b.right &&
    a.right >= b.left
  );
}

/**
 * The tables of `sheetIds`, by sheet, each sheet's in reading order.
 * Collaborators converting ranges at the same time can store overlapping
 * tables or repeated names; every reader resolves them the same way: of
 * overlapping tables the one with the lowest id stays, and a repeated name
 * goes to the lowest id while the others read with the next free `TableN`.
 */
export function readSpreadsheetTables(
  doc: LoroDoc,
  sheetIds: Iterable<string>
): Map<string, SheetTable[]> {
  const live = new Set(sheetIds);
  const stored: { sheetId: string; table: SheetTable }[] = [];
  for (const [key, value] of doc.getMap(TABLES).entries()) {
    const { sheetId, field } = splitSpreadsheetSheetKey(key);
    if (!live.has(sheetId)) continue;
    const table = parseStoredTable(field, value);
    if (table) stored.push({ sheetId, table });
  }
  stored.sort((a, b) => (a.table.id! < b.table.id! ? -1 : 1));
  const taken = new Set<string>();
  const result = new Map<string, SheetTable[]>();
  for (const { sheetId, table } of stored) {
    const tables = result.get(sheetId) ?? [];
    if (
      tables.length >= MAX_SHEET_TABLES ||
      tables.some((other) => overlaps(other, table))
    )
      continue;
    const name = taken.has(table.name.toLowerCase())
      ? nextTableName(taken)
      : table.name;
    taken.add(name.toLowerCase());
    tables.push(name === table.name ? table : { ...table, name });
    result.set(sheetId, tables);
  }
  for (const tables of result.values())
    tables.sort((a, b) => {
      const first = tableBounds(a);
      const second = tableBounds(b);
      return first.top - second.top || first.left - second.left;
    });
  return result;
}

/** A sheet's stored layout and definitions, without its tables. */
function storedMetadata(doc: LoroDoc, sheetId: string) {
  const metadata = parseWorkbookMetadata(doc.getMap(METADATA).get(sheetId));
  if (!metadata) return;
  const { tables: _tables, ...rest } = metadata;
  return rest;
}

/** A sheet's metadata with `tables`, as `readSpreadsheetTables` gives them. */
export function readSheetMetadata(
  doc: LoroDoc,
  sheetId: string,
  tables: SheetTable[] | undefined
): WorkbookSheetMetadata | undefined {
  const metadata = storedMetadata(doc, sheetId);
  if (!tables?.length) return metadata;
  return { ...metadata, tables };
}

/**
 * Save a sheet's metadata, writing only what changed: its layout and
 * definitions as one entry and each table as its own, so collaborators can
 * change different tables, or a table and the sheet's other settings, at
 * once. A table without an id is new and gets one. Does not commit.
 */
export function writeSheetMetadata(
  doc: LoroDoc,
  sheetId: string,
  metadata: WorkbookSheetMetadata | undefined
): void {
  if (metadata && !parseWorkbookMetadata(JSON.stringify(metadata)))
    throw new Error('Invalid sheet layout.');
  const { tables = [], ...rest } = metadata ?? {};
  const encoded = JSON.stringify(rest);
  if (JSON.stringify(storedMetadata(doc, sheetId) ?? {}) !== encoded)
    doc.getMap(METADATA).set(sheetId, encoded);
  const map = doc.getMap(TABLES);
  const previous = new Set(
    map
      .keys()
      .filter((key) => splitSpreadsheetSheetKey(key).sheetId === sheetId)
  );
  for (const table of tables) {
    const { id = crypto.randomUUID(), ...value } = table;
    const key = spreadsheetSheetKey(id, sheetId);
    const encodedTable = JSON.stringify(value);
    previous.delete(key);
    if (map.get(key) !== encodedTable) map.set(key, encodedTable);
  }
  for (const key of previous) map.delete(key);
}
