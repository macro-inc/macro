import type { LoroDoc } from 'loro-crdt';
import {
  DEFAULT_SHEET_ID,
  retainSpreadsheetSheets,
  reviveSpreadsheetFallback,
} from './spreadsheet-sheet-registry';

export { DEFAULT_SHEET_ID } from './spreadsheet-sheet-registry';

export const SPREADSHEET_ROWS = 200;
export const SPREADSHEET_MAX_ROWS = 1_000;
export const SPREADSHEET_COLUMNS = 26;
export const DEFAULT_COLUMN_WIDTH = 100;
export const MIN_COLUMN_WIDTH = 64;
export const MAX_COLUMN_WIDTH = 640;
export const SPREADSHEET_FORMAT_VERSION = 1;
export const SPREADSHEET_MAX_CELL_LENGTH = 10_000;

export type SpreadsheetFormat =
  | 'general'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'time'
  | 'scientific'
  | 'text';
export type SpreadsheetCell = {
  value: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontFamily?: 'sans' | 'serif' | 'mono';
  fontSize?: number;
  textColor?: string;
  fillColor?: string;
  horizontalAlign?: 'auto' | 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
  decimals?: number;
  format?: SpreadsheetFormat;
};
export type SpreadsheetCellStyle = Omit<SpreadsheetCell, 'value'>;
export type SpreadsheetCells = Record<string, SpreadsheetCell>;

/** Explicit defaults are also the patch used to clear a destination's style. */
export const SPREADSHEET_DEFAULT_STYLE: Required<SpreadsheetCellStyle> = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  fontFamily: 'sans',
  fontSize: 10,
  textColor: '',
  fillColor: '',
  horizontalAlign: 'auto',
  verticalAlign: 'middle',
  wrap: false,
  borderTop: false,
  borderRight: false,
  borderBottom: false,
  borderLeft: false,
  decimals: -1,
  format: 'general',
};

const booleanStyle = (value: unknown): value is boolean =>
  typeof value === 'boolean';
const colorStyle = (value: unknown): value is string =>
  typeof value === 'string' && (value === '' || /^#[0-9a-f]{6}$/i.test(value));
const integerStyle = (
  value: unknown,
  min: number,
  max: number
): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;

type StyleField<T> = { map: string; valid: (value: unknown) => value is T };
const styleFields: {
  [K in keyof Required<SpreadsheetCellStyle>]: StyleField<
    Required<SpreadsheetCellStyle>[K]
  >;
} = {
  bold: { map: 'spreadsheetBold', valid: booleanStyle },
  italic: { map: 'spreadsheetItalic', valid: booleanStyle },
  underline: { map: 'spreadsheetUnderline', valid: booleanStyle },
  strikethrough: { map: 'spreadsheetStrikethrough', valid: booleanStyle },
  fontFamily: {
    map: 'spreadsheetFontFamily',
    valid: (value): value is 'sans' | 'serif' | 'mono' =>
      value === 'sans' || value === 'serif' || value === 'mono',
  },
  fontSize: {
    map: 'spreadsheetFontSize',
    valid: (value): value is number => integerStyle(value, 8, 36),
  },
  textColor: { map: 'spreadsheetTextColor', valid: colorStyle },
  fillColor: { map: 'spreadsheetFillColor', valid: colorStyle },
  horizontalAlign: {
    map: 'spreadsheetHorizontalAlign',
    valid: (value): value is 'auto' | 'left' | 'center' | 'right' =>
      value === 'auto' ||
      value === 'left' ||
      value === 'center' ||
      value === 'right',
  },
  verticalAlign: {
    map: 'spreadsheetVerticalAlign',
    valid: (value): value is 'top' | 'middle' | 'bottom' =>
      value === 'top' || value === 'middle' || value === 'bottom',
  },
  wrap: { map: 'spreadsheetWrap', valid: booleanStyle },
  borderTop: { map: 'spreadsheetBorderTop', valid: booleanStyle },
  borderRight: { map: 'spreadsheetBorderRight', valid: booleanStyle },
  borderBottom: { map: 'spreadsheetBorderBottom', valid: booleanStyle },
  borderLeft: { map: 'spreadsheetBorderLeft', valid: booleanStyle },
  decimals: {
    map: 'spreadsheetDecimals',
    valid: (value): value is number => integerStyle(value, -1, 10),
  },
  format: { map: 'spreadsheetFormats', valid: isSpreadsheetFormat },
};
const styleKeys = Object.keys(styleFields) as (keyof SpreadsheetCellStyle)[];

/** Clipboard styles and local patches use the same validation as remote data. */
export function isSpreadsheetCellStyle(
  value: unknown
): value is SpreadsheetCellStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return styleKeys.every(
    (key) => !(key in value) || styleFields[key].valid(Reflect.get(value, key))
  );
}
export type SpreadsheetCellEdits = Record<
  string,
  Partial<SpreadsheetCell> | null
>;
export type SpreadsheetSelection = {
  anchor: string;
  focus: string;
  /** Omitted by legacy clients, which always select the original sheet. */
  sheetId?: string;
};
export type SpreadsheetLayout = {
  rowCount: number;
  columnWidths: Record<number, number>;
};

/** Convert an A1 address to zero-based coordinates within the MVP grid. */
export function parseCellAddress(
  address: string
): { row: number; column: number } | undefined {
  const match = /^([A-Z])([1-9]\d*)$/.exec(address);
  if (!match) return;
  const row = Number(match[2]) - 1;
  const column = match[1].charCodeAt(0) - 65;
  if (row >= SPREADSHEET_MAX_ROWS || column >= SPREADSHEET_COLUMNS) return;
  return { row, column };
}

export function spreadsheetSheetKey(key: string, sheetId = DEFAULT_SHEET_ID) {
  return sheetId === DEFAULT_SHEET_ID ? key : `${sheetId}!${key}`;
}

function sheetEntries(doc: LoroDoc, name: string, sheetId: string) {
  const entries = Object.entries(doc.getMap(name).toJSON());
  if (sheetId === DEFAULT_SHEET_ID)
    return entries.filter(([key]) => !key.includes('!'));
  const prefix = `${sheetId}!`;
  return entries
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => [key.slice(prefix.length), value] as const);
}

type SpreadsheetEntryReader = (
  name: string,
  sheetId: string
) => ReadonlyArray<readonly [string, unknown]>;

/** Decode each field map once when reading a whole workbook. */
export function createSpreadsheetEntryReader(
  doc: LoroDoc
): SpreadsheetEntryReader {
  const maps = new Map<string, Map<string, [string, unknown][]>>();
  return (name, sheetId) => {
    let sheets = maps.get(name);
    if (!sheets) {
      sheets = new Map();
      for (const [key, value] of Object.entries(doc.getMap(name).toJSON())) {
        const separator = key.indexOf('!');
        const id =
          separator === -1 ? DEFAULT_SHEET_ID : key.slice(0, separator);
        const address = separator === -1 ? key : key.slice(separator + 1);
        const entries = sheets.get(id) ?? [];
        entries.push([address, value]);
        sheets.set(id, entries);
      }
      maps.set(name, sheets);
    }
    return sheets.get(sheetId) ?? [];
  };
}

export function readSpreadsheetLayout(
  doc: LoroDoc,
  sheetId = DEFAULT_SHEET_ID,
  readEntries: SpreadsheetEntryReader = (name, id) =>
    sheetEntries(doc, name, id)
): SpreadsheetLayout {
  const columnWidths: Record<number, number> = {};
  for (const [key, value] of readEntries('spreadsheetColumnWidths', sheetId)) {
    const column = Number(key);
    if (
      Number.isInteger(column) &&
      column >= 0 &&
      column < SPREADSHEET_COLUMNS &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      columnWidths[column] = Math.max(
        MIN_COLUMN_WIDTH,
        Math.min(MAX_COLUMN_WIDTH, value)
      );
    }
  }
  // Independent append operations merge additively. Appending never shifts A1
  // identities, so concurrent formulas and edits retain their references.
  let rowCount = SPREADSHEET_ROWS;
  for (const [, value] of readEntries('spreadsheetRowAdditions', sheetId)) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0)
      rowCount += Math.min(value, SPREADSHEET_MAX_ROWS);
  }
  // Undoing an append must not hide a collaborator's subsequent cell edits.
  for (const name of [
    'spreadsheetValues',
    ...styleKeys.map((key) => styleFields[key].map),
  ]) {
    for (const [address] of readEntries(name, sheetId)) {
      const position = parseCellAddress(address);
      if (position) rowCount = Math.max(rowCount, position.row + 1);
    }
  }
  return { rowCount: Math.min(rowCount, SPREADSHEET_MAX_ROWS), columnWidths };
}

export function resizeSpreadsheetColumn(
  doc: LoroDoc,
  column: number,
  width: number,
  sheetId = DEFAULT_SHEET_ID,
  commit = true
) {
  if (
    !Number.isInteger(column) ||
    column < 0 ||
    column >= SPREADSHEET_COLUMNS ||
    !Number.isFinite(width)
  )
    return;
  reviveSpreadsheetFallback(doc, sheetId);
  doc
    .getMap('spreadsheetColumnWidths')
    .set(
      spreadsheetSheetKey(String(column), sheetId),
      Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width)))
    );
  retainSpreadsheetSheets(doc, sheetId);
  if (commit) doc.commit({ origin: 'spreadsheet-resize' });
}

export function appendSpreadsheetRows(
  doc: LoroDoc,
  count: number,
  sheetId = DEFAULT_SHEET_ID,
  commit = true
) {
  if (!Number.isInteger(count) || count <= 0) return;
  const current = readSpreadsheetLayout(doc, sheetId).rowCount;
  if (current >= SPREADSHEET_MAX_ROWS) return;
  const allocated = sheetEntries(
    doc,
    'spreadsheetRowAdditions',
    sheetId
  ).reduce<number>(
    (rows, [, value]) =>
      rows +
      (typeof value === 'number' && Number.isInteger(value) && value > 0
        ? Math.min(value, SPREADSHEET_MAX_ROWS)
        : 0),
    SPREADSHEET_ROWS
  );
  // Occupied cells may keep rows visible after an append was undone. Include
  // that gap so the next append still adds rows below the visible sheet.
  const amount = Math.min(SPREADSHEET_MAX_ROWS, current + count) - allocated;
  reviveSpreadsheetFallback(doc, sheetId);
  doc
    .getMap('spreadsheetRowAdditions')
    .set(spreadsheetSheetKey(crypto.randomUUID(), sheetId), amount);
  retainSpreadsheetSheets(doc, sheetId);
  if (commit) doc.commit({ origin: 'spreadsheet-append' });
}

export function formatCellAddress(row: number, column: number): string {
  return `${String.fromCharCode(65 + column)}${row + 1}`;
}

export function isSpreadsheetFormat(
  value: unknown
): value is SpreadsheetFormat {
  return (
    value === 'general' ||
    value === 'number' ||
    value === 'currency' ||
    value === 'percent' ||
    value === 'date' ||
    value === 'time' ||
    value === 'scientific' ||
    value === 'text'
  );
}

/** Validate the wire document rather than trusting arbitrary remote values. */
export function readSpreadsheetCells(
  doc: LoroDoc,
  sheetId = DEFAULT_SHEET_ID,
  readEntries: SpreadsheetEntryReader = (name, id) =>
    sheetEntries(doc, name, id)
): SpreadsheetCells {
  const values = Object.fromEntries(readEntries('spreadsheetValues', sheetId));
  const styles = styleKeys.map((key) => ({
    key,
    values: Object.fromEntries(readEntries(styleFields[key].map, sheetId)),
    valid: styleFields[key].valid,
  }));
  const cells: SpreadsheetCells = {};
  const addresses = new Set([
    ...Object.keys(values),
    ...styles.flatMap((style) => Object.keys(style.values)),
  ]);
  for (const address of addresses) {
    if (!parseCellAddress(address)) continue;
    const value = values[address];
    const cell: SpreadsheetCell = {
      value: typeof value === 'string' ? value : '',
    };
    for (const style of styles) {
      const value = style.values[address];
      if (style.valid(value) && value !== SPREADSHEET_DEFAULT_STYLE[style.key])
        Object.assign(cell, { [style.key]: value });
    }
    cells[address] = cell;
  }
  return cells;
}

/** Apply a user operation as one CRDT commit and therefore one undo step. */
export function validateSpreadsheetCellEdits(
  edits: SpreadsheetCellEdits
): void {
  for (const [address, edit] of Object.entries(edits)) {
    if (!parseCellAddress(address) || edit === null) continue;
    if (
      edit.value !== undefined &&
      edit.value.length > SPREADSHEET_MAX_CELL_LENGTH
    )
      throw new Error(`Cell ${address} exceeds 10,000 characters`);
    if (!isSpreadsheetCellStyle(edit))
      throw new Error(`Cell ${address} has invalid formatting`);
  }
}

export function writeSpreadsheetCells(
  doc: LoroDoc,
  edits: SpreadsheetCellEdits,
  sheetId = DEFAULT_SHEET_ID,
  commit = true
): void {
  validateSpreadsheetCellEdits(edits);
  const hasEdits = Object.entries(edits).some(
    ([address, edit]) =>
      parseCellAddress(address) &&
      (edit === null ||
        edit.value !== undefined ||
        styleKeys.some((key) => edit[key] !== undefined))
  );
  if (hasEdits) reviveSpreadsheetFallback(doc, sheetId);
  const values = doc.getMap('spreadsheetValues');
  const styles = styleKeys.map((key) => ({
    key,
    map: doc.getMap(styleFields[key].map),
  }));
  for (const [address, edit] of Object.entries(edits)) {
    if (!parseCellAddress(address)) continue;
    const key = spreadsheetSheetKey(address, sheetId);
    if (edit === null) {
      values.delete(key);
      for (const { map } of styles) map.delete(key);
      continue;
    }
    if (edit.value !== undefined) {
      if (edit.value) values.set(key, edit.value);
      else values.delete(key);
    }
    for (const { key: styleKey, map } of styles) {
      const value = edit[styleKey];
      if (value === undefined) continue;
      if (value === SPREADSHEET_DEFAULT_STYLE[styleKey]) map.delete(key);
      else map.set(key, value);
    }
  }
  if (hasEdits) {
    const formats = doc.getMap('spreadsheetFormats');
    const formulas = Object.keys(edits).flatMap((address) => {
      const key = spreadsheetSheetKey(address, sheetId);
      const value = values.get(key);
      return typeof value === 'string' &&
        value.startsWith('=') &&
        formats.get(key) !== 'text'
        ? [value]
        : [];
    });
    retainSpreadsheetSheets(doc, sheetId, formulas);
  }
  if (commit) doc.commit({ origin: 'spreadsheet-edit' });
}
