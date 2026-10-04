import type { LoroDoc } from 'loro-crdt';
import {
  DEFAULT_SHEET_ID,
  retainSpreadsheetSheets,
  reviveSpreadsheetFallback,
} from './spreadsheet-sheet-registry';

export { DEFAULT_SHEET_ID } from './spreadsheet-sheet-registry';

/** Rows and columns a new sheet starts with. */
export const SPREADSHEET_ROWS = 200;
export const SPREADSHEET_COLUMNS = 26;
/** Imported and appended rows can grow a sheet to this size. */
export const SPREADSHEET_MAX_ROWS = 100_000;
/** Excel's own column limit, XFD. */
export const SPREADSHEET_MAX_COLUMNS = 16_384;
export const DEFAULT_COLUMN_WIDTH = 100;
/** Excel spacer columns are often narrower than a typed value. */
export const MIN_COLUMN_WIDTH = 8;
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
  /** Excel number format, preserved verbatim for display and export. */
  numberFormat?: string;
  fontName?: string;
  borderTopStyle?: string;
  borderTopColor?: string;
  borderRightStyle?: string;
  borderRightColor?: string;
  borderBottomStyle?: string;
  borderBottomColor?: string;
  borderLeftStyle?: string;
  borderLeftColor?: string;
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
  numberFormat: '',
  fontName: '',
  borderTopStyle: '',
  borderTopColor: '',
  borderRightStyle: '',
  borderRightColor: '',
  borderBottomStyle: '',
  borderBottomColor: '',
  borderLeftStyle: '',
  borderLeftColor: '',
};

const booleanStyle = (value: unknown): value is boolean =>
  typeof value === 'boolean';
const borderStyle = (value: unknown): value is string =>
  typeof value === 'string' &&
  [
    '',
    'thin',
    'medium',
    'thick',
    'double',
    'dotted',
    'dashed',
    'dashDot',
    'dashDotDot',
    'slantDashDot',
    'hair',
    'mediumDashed',
    'mediumDashDot',
    'mediumDashDotDot',
  ].includes(value);

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
  fontName: {
    map: 'spreadsheetFontNames',
    valid: (value): value is string =>
      typeof value === 'string' &&
      value.length <= 128 &&
      Array.from(value).every((character) => character.charCodeAt(0) >= 32),
  },
  borderTopStyle: { map: 'spreadsheetBorderTopStyles', valid: borderStyle },
  borderTopColor: { map: 'spreadsheetBorderTopColors', valid: colorStyle },
  borderRightStyle: { map: 'spreadsheetBorderRightStyles', valid: borderStyle },
  borderRightColor: { map: 'spreadsheetBorderRightColors', valid: colorStyle },
  borderBottomStyle: {
    map: 'spreadsheetBorderBottomStyles',
    valid: borderStyle,
  },
  borderBottomColor: {
    map: 'spreadsheetBorderBottomColors',
    valid: colorStyle,
  },
  borderLeftStyle: { map: 'spreadsheetBorderLeftStyles', valid: borderStyle },
  borderLeftColor: { map: 'spreadsheetBorderLeftColors', valid: colorStyle },
  numberFormat: {
    map: 'spreadsheetNumberFormats',
    valid: (value): value is string =>
      typeof value === 'string' &&
      value.length <= 512 &&
      Array.from(value).every((character) => character.charCodeAt(0) >= 32),
  },
};
const styleKeys = Object.keys(styleFields) as (keyof SpreadsheetCellStyle)[];
const styleFieldsByMap = new Map(
  Object.values(styleFields).map((field) => [field.map, field])
);

/** Validate a persisted style using the same rules as local cell edits. */
export function isSpreadsheetStyleEntry(map: string, value: unknown): boolean {
  return styleFieldsByMap.get(map)?.valid(value) ?? false;
}

const styleKeysByMap = new Map(
  (Object.keys(styleFields) as (keyof SpreadsheetCellStyle)[]).map((key) => [
    styleFields[key].map,
    key,
  ])
);

/** Apply one changed property map entry to a cell, as `readSpreadsheetCells`
 * would read it. Returns undefined once the cell has no value or style. */
export function applySpreadsheetCellEntry(
  cell: SpreadsheetCell | undefined,
  map: string,
  value: unknown
): SpreadsheetCell | undefined {
  const next: SpreadsheetCell = { value: '', ...cell };
  if (map === 'spreadsheetValues')
    next.value = typeof value === 'string' ? value : '';
  else {
    const key = styleKeysByMap.get(map);
    if (!key) return cell;
    if (
      styleFields[key].valid(value) &&
      value !== SPREADSHEET_DEFAULT_STYLE[key]
    )
      Object.assign(next, { [key]: value });
    else delete next[key];
  }
  return next.value || Object.keys(next).length > 1 ? next : undefined;
}

/** The sheet and A1 address a persisted cell key refers to. */
export function splitSpreadsheetSheetKey(key: string): {
  sheetId: string;
  field: string;
} {
  const separator = key.indexOf('!');
  return separator === -1
    ? { sheetId: DEFAULT_SHEET_ID, field: key }
    : { sheetId: key.slice(0, separator), field: key.slice(separator + 1) };
}

/** Clipboard styles and local patches use the same validation as remote data. */
export function isSpreadsheetCellStyle(
  value: unknown
): value is SpreadsheetCellStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  // Visit the properties a cell has (usually a few), not every style field.
  for (const key in value) {
    if (!Object.hasOwn(styleFields, key)) continue;
    if (
      !styleFields[key as keyof SpreadsheetCellStyle].valid(
        Reflect.get(value, key)
      )
    )
      return false;
  }
  return true;
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
  columnCount: number;
  columnWidths: Record<number, number>;
};

/** Zero-based column index for Excel letters (A → 0, AA → 26), if supported. */
export function parseColumnName(name: string): number | undefined {
  if (!/^[A-Z]{1,3}$/.test(name)) return;
  let column = 0;
  for (let index = 0; index < name.length; index++)
    column = column * 26 + name.charCodeAt(index) - 64;
  return column <= SPREADSHEET_MAX_COLUMNS ? column - 1 : undefined;
}

const columnNames: string[] = [];
/** Excel letters for a zero-based column index. */
export function columnName(column: number): string {
  let name = columnNames[column];
  if (name !== undefined) return name;
  name = '';
  for (let index = column + 1; index > 0; index = Math.floor((index - 1) / 26))
    name = String.fromCharCode(65 + ((index - 1) % 26)) + name;
  if (column >= 0 && column < SPREADSHEET_MAX_COLUMNS)
    columnNames[column] = name;
  return name;
}

/** Convert an A1 address to zero-based coordinates within the supported grid.
 * Parsed by character: this runs for every cell of large workbooks. */
export function parseCellAddress(
  address: string
): { row: number; column: number } | undefined {
  let index = 0;
  let column = 0;
  for (; index < address.length && index < 4; index++) {
    const code = address.charCodeAt(index);
    if (code < 65 || code > 90) break;
    column = column * 26 + code - 64;
  }
  // One to three letters, then 1-7 digits without a leading zero.
  if (index === 0 || index > 3 || address.length - index > 7) return;
  let row = 0;
  for (let digit = index; digit < address.length; digit++) {
    const code = address.charCodeAt(digit);
    if (code < 48 || code > 57 || (digit === index && code === 48)) return;
    row = row * 10 + code - 48;
  }
  if (
    row === 0 ||
    column > SPREADSHEET_MAX_COLUMNS ||
    row > SPREADSHEET_MAX_ROWS
  )
    return;
  return { row: row - 1, column: column - 1 };
}

export function spreadsheetSheetKey(key: string, sheetId = DEFAULT_SHEET_ID) {
  return sheetId === DEFAULT_SHEET_ID ? key : `${sheetId}!${key}`;
}

function rootMapValues(doc: LoroDoc, name: string): Record<string, unknown> {
  return doc.getMap(name).toJSON();
}

function sheetEntries(doc: LoroDoc, name: string, sheetId: string) {
  const entries = Object.entries(rootMapValues(doc, name));
  if (sheetId === DEFAULT_SHEET_ID)
    return entries.filter(([key]) => !key.includes('!'));
  const prefix = `${sheetId}!`;
  return entries
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => [key.slice(prefix.length), value] as const);
}

export type SpreadsheetEntryReader = (
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
      const values = rootMapValues(doc, name);
      let current: [string, unknown][] | undefined;
      let currentId: string | undefined;
      for (const key in values) {
        const separator = key.indexOf('!');
        const id =
          separator === -1 ? DEFAULT_SHEET_ID : key.slice(0, separator);
        // Keys of one sheet are usually adjacent; skip the lookup for them.
        if (id !== currentId) {
          currentId = id;
          current = sheets.get(id);
          if (!current) {
            current = [];
            sheets.set(id, current);
          }
        }
        current!.push([
          separator === -1 ? key : key.slice(separator + 1),
          values[key],
        ]);
      }
      maps.set(name, sheets);
    }
    return sheets.get(sheetId) ?? [];
  };
}

/** Every persisted cell property map, for layout and change tracking. */
export const SPREADSHEET_CELL_MAPS = [
  'spreadsheetValues',
  ...styleKeys.map((key) => styleFields[key].map),
];

const additions = {
  row: {
    map: 'spreadsheetRowAdditions',
    initial: SPREADSHEET_ROWS,
    limit: SPREADSHEET_MAX_ROWS,
  },
  column: {
    map: 'spreadsheetColumnAdditions',
    initial: SPREADSHEET_COLUMNS,
    limit: SPREADSHEET_MAX_COLUMNS,
  },
} as const;

/** Allocated rows or columns before occupied cells extend the sheet. */
function allocated(
  entries: ReadonlyArray<readonly [string, unknown]>,
  axis: 'row' | 'column'
) {
  let count = additions[axis].initial;
  for (const [, value] of entries)
    if (typeof value === 'number' && Number.isInteger(value) && value > 0)
      count += Math.min(value, additions[axis].limit);
  return count;
}

export function readSpreadsheetLayout(
  doc: LoroDoc,
  sheetId = DEFAULT_SHEET_ID,
  readEntries: SpreadsheetEntryReader = (name, id) =>
    sheetEntries(doc, name, id)
): SpreadsheetLayout {
  const columnWidths: Record<number, number> = {};
  // Independent append operations merge additively. Appending never shifts A1
  // identities, so concurrent formulas and edits retain their references.
  let rowCount = allocated(readEntries(additions.row.map, sheetId), 'row');
  let columnCount = allocated(
    readEntries(additions.column.map, sheetId),
    'column'
  );
  for (const [key, value] of readEntries('spreadsheetColumnWidths', sheetId)) {
    const column = Number(key);
    if (
      Number.isInteger(column) &&
      column >= 0 &&
      column < SPREADSHEET_MAX_COLUMNS &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      columnWidths[column] = Math.max(
        MIN_COLUMN_WIDTH,
        Math.min(MAX_COLUMN_WIDTH, value)
      );
    }
  }
  // Undoing an append must not hide a collaborator's subsequent cell edits.
  for (const name of SPREADSHEET_CELL_MAPS) {
    for (const [address] of readEntries(name, sheetId)) {
      const position = parseCellAddress(address);
      if (!position) continue;
      if (position.row >= rowCount) rowCount = position.row + 1;
      if (position.column >= columnCount) columnCount = position.column + 1;
    }
  }
  return {
    rowCount: Math.min(rowCount, SPREADSHEET_MAX_ROWS),
    columnCount: Math.min(columnCount, SPREADSHEET_MAX_COLUMNS),
    columnWidths,
  };
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
    column >= SPREADSHEET_MAX_COLUMNS ||
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

/** Grow a sheet's rows or columns without shifting any A1 identity. */
export function appendSpreadsheetAxis(
  doc: LoroDoc,
  axis: 'row' | 'column',
  count: number,
  sheetId = DEFAULT_SHEET_ID,
  commit = true
) {
  if (!Number.isInteger(count) || count <= 0) return;
  const { map, limit } = additions[axis];
  const layout = readSpreadsheetLayout(doc, sheetId);
  const current = axis === 'row' ? layout.rowCount : layout.columnCount;
  if (current >= limit) return;
  // Occupied cells may keep rows visible after an append was undone. Include
  // that gap so the next append still adds rows below the visible sheet.
  const amount =
    Math.min(limit, current + count) -
    allocated(sheetEntries(doc, map, sheetId), axis);
  reviveSpreadsheetFallback(doc, sheetId);
  doc
    .getMap(map)
    .set(spreadsheetSheetKey(crypto.randomUUID(), sheetId), amount);
  retainSpreadsheetSheets(doc, sheetId);
  if (commit) doc.commit({ origin: 'spreadsheet-append' });
}

export function appendSpreadsheetRows(
  doc: LoroDoc,
  count: number,
  sheetId = DEFAULT_SHEET_ID,
  commit = true
) {
  appendSpreadsheetAxis(doc, 'row', count, sheetId, commit);
}

export function formatCellAddress(row: number, column: number): string {
  return `${columnName(column)}${row + 1}`;
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
  // Visit only the entries each map holds: most cells set few properties.
  const cells: SpreadsheetCells = {};
  for (const [address, value] of readEntries('spreadsheetValues', sheetId)) {
    if (!parseCellAddress(address)) continue;
    cells[address] = { value: typeof value === 'string' ? value : '' };
  }
  for (const key of styleKeys) {
    const { map, valid } = styleFields[key];
    for (const [address, value] of readEntries(map, sheetId)) {
      let cell = cells[address];
      if (!cell) {
        if (!parseCellAddress(address)) continue;
        cells[address] = cell = { value: '' };
      }
      if (valid(value) && value !== SPREADSHEET_DEFAULT_STYLE[key])
        Object.assign(cell, { [key]: value });
    }
  }
  return cells;
}

/** What `readSpreadsheetCells` returns for a sheet that `writeSpreadsheetCells`
 * just created from these validated edits, without decoding every cell back
 * out of the document. */
export function freshSpreadsheetCells(
  edits: SpreadsheetCellEdits
): SpreadsheetCells {
  const cells: SpreadsheetCells = {};
  for (const address in edits) {
    const edit = edits[address];
    if (!edit || !parseCellAddress(address)) continue;
    let cell: SpreadsheetCell | undefined = edit.value
      ? { value: edit.value }
      : undefined;
    for (const key of styleKeys) {
      const value = edit[key];
      if (value === undefined || value === SPREADSHEET_DEFAULT_STYLE[key])
        continue;
      cell ??= { value: '' };
      Object.assign(cell, { [key]: value });
    }
    if (cell) cells[address] = cell;
  }
  return cells;
}

/** Apply a user operation as one CRDT commit and therefore one undo step. */
export function validateSpreadsheetCellEdits(
  edits: SpreadsheetCellEdits
): void {
  for (const address in edits) {
    const edit = edits[address];
    if (edit === null || !parseCellAddress(address)) continue;
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
  commit = true,
  /** The sheet was created in this transaction and its cells validated, so
   * there is nothing to clear and no earlier value to read. */
  fresh = false
): void {
  if (!fresh) validateSpreadsheetCellEdits(edits);
  const hasEdits = Object.entries(edits).some(
    ([address, edit]) =>
      parseCellAddress(address) &&
      (edit === null ||
        edit.value !== undefined ||
        styleKeys.some((key) => edit[key] !== undefined))
  );
  if (hasEdits) reviveSpreadsheetFallback(doc, sheetId);
  const values = doc.getMap('spreadsheetValues');
  const formats = doc.getMap('spreadsheetFormats');
  const fontNames = doc.getMap('spreadsheetFontNames');
  const numberFormats = doc.getMap('spreadsheetNumberFormats');
  const styles = styleKeys.map((key) => ({
    key,
    map: doc.getMap(styleFields[key].map),
  }));
  const formulas: string[] = [];
  for (const address in edits) {
    const edit = edits[address];
    if (!parseCellAddress(address)) continue;
    const key = spreadsheetSheetKey(address, sheetId);
    if (edit === null) {
      values.delete(key);
      for (const { map } of styles) map.delete(key);
      continue;
    }
    if (edit.value !== undefined) {
      if (edit.value) values.set(key, edit.value);
      else if (!fresh) values.delete(key);
    }
    if (!fresh) {
      // Choosing a built-in format/precision explicitly replaces the imported format.
      if (edit.fontFamily !== undefined && edit.fontName === undefined)
        fontNames.delete(key);
      if (
        edit.numberFormat === undefined &&
        (edit.format !== undefined || edit.decimals !== undefined)
      )
        numberFormats.delete(key);
    }
    for (const { key: styleKey, map } of styles) {
      const value = edit[styleKey];
      if (value === undefined) continue;
      if (value !== SPREADSHEET_DEFAULT_STYLE[styleKey]) map.set(key, value);
      else if (!fresh) map.delete(key);
    }
    if (!hasEdits) continue;
    // Sheets this formula names stay retained for collaborators.
    const value = edit.value ?? (fresh ? undefined : values.get(key));
    if (typeof value !== 'string' || !value.startsWith('=')) continue;
    const format = edit.format ?? (fresh ? undefined : formats.get(key));
    if (format !== 'text') formulas.push(value);
  }
  if (hasEdits) retainSpreadsheetSheets(doc, sheetId, formulas);
  if (commit) doc.commit({ origin: 'spreadsheet-edit' });
}
