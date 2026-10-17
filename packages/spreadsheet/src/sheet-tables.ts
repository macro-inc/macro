import { cellPlainText } from './cell-mentions';
import { sqrefBounds } from './sheet-rules';
import {
  formatCellAddress,
  parseCellAddress,
  type SpreadsheetCellEdits,
  type SpreadsheetCells,
} from './spreadsheet-document';
import { escapedColumnName, type WorkbookTable } from './structured-references';
import type { WorkbookSheetMetadata } from './workbook-metadata';

export const MAX_SHEET_TABLES = 100;
const MAX_TABLE_NAME_LENGTH = 255;
const MAX_FILTER_VALUES = 10_000;
const MAX_FILTER_VALUE_LENGTH = 1_000;

/** Conditions a column filter can test, as Google Sheets offers them. */
export const TABLE_FILTER_OPERATORS = [
  'empty',
  'notEmpty',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'textEquals',
  'equal',
  'notEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'between',
  'notBetween',
] as const;
export type TableFilterOperator = (typeof TABLE_FILTER_OPERATORS)[number];
export type TableFilterCondition = {
  operator: TableFilterOperator;
  value?: string;
  /** The upper bound of `between` and `notBetween`. */
  value2?: string;
};

/**
 * Which rows a column's filter shows: those whose text is one of `values`
 * (blanks when `blanks`), and those meeting `condition`. With both, a row
 * must pass each; a filter without `values` keeps every value.
 */
export type TableColumnFilter = {
  values?: string[];
  blanks?: boolean;
  condition?: TableFilterCondition;
};

/** What a column holds, as Google Sheets types table columns. */
export const TABLE_COLUMN_TYPES = [
  'text',
  'number',
  'percent',
  'currency',
  'date',
  'datetime',
  'time',
  'checkbox',
  'dropdown',
  'person',
] as const;
export type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number];

/**
 * A named, structured range: a header row naming its columns, data rows and
 * an optional total row. Column names are the header cells' text, so a cell
 * edit renames a column.
 */
export type SheetTable = {
  /** Identifies the table's stored entry; assigned when it is first saved. */
  id?: string;
  /** Unique in the workbook, ignoring case; formulas use it. */
  name: string;
  /** Header row through the last row, the total row included. */
  range: string;
  totalsRow: boolean;
  bandedRows: boolean;
  bandedColumns?: boolean;
  firstColumn?: boolean;
  lastColumn?: boolean;
  /** The Excel table style, such as `TableStyleMedium2`; without one, a
   * table is drawn plain, as in Excel. */
  style?: string;
  /** A #RRGGBB color drawn instead of the style's, which Excel cannot
   * show; export keeps the style. */
  color?: string;
  /** Filters by column position from the table's first column. */
  filters?: Record<string, TableColumnFilter>;
  /** Column types by column position; an untyped column takes any value. */
  columnTypes?: Record<string, TableColumnType>;
};

/** Excel's total row functions and the SUBTOTAL function numbers it writes
 * for them, which leave rows hidden by filters out. */
export const TABLE_TOTALS_FUNCTIONS = {
  sum: 109,
  average: 101,
  count: 103,
  countNums: 102,
  max: 104,
  min: 105,
  stdDev: 107,
  var: 110,
} as const;
export type ExcelTotalsFunction = keyof typeof TABLE_TOTALS_FUNCTIONS;
/** Excel's total row functions and the counts Google Sheets adds, which
 * count every data row, filtered or not. */
export type TableTotalsFunction =
  | ExcelTotalsFunction
  | 'empty'
  | 'unique'
  | 'percentFilled'
  | 'percentEmpty'
  | 'percentUnique';
export const TABLE_TOTALS: TableTotalsFunction[] = [
  'sum',
  'average',
  'min',
  'max',
  'count',
  'countNums',
  'empty',
  'unique',
  'percentFilled',
  'percentEmpty',
  'percentUnique',
  'stdDev',
  'var',
];

export const TABLE_TOTALS_LABELS: Record<TableTotalsFunction, string> = {
  sum: 'Sum',
  average: 'Average',
  min: 'Min',
  max: 'Max',
  count: 'Count',
  countNums: 'Count numbers',
  empty: 'Empty',
  unique: 'Unique',
  percentFilled: 'Percent filled',
  percentEmpty: 'Percent empty',
  percentUnique: 'Percent unique',
  stdDev: 'Standard deviation',
  var: 'Variance',
};

export function excelTotalsFunction(
  aggregate: TableTotalsFunction
): aggregate is ExcelTotalsFunction {
  return aggregate in TABLE_TOTALS_FUNCTIONS;
}

export type TableBounds = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

export function tableBounds(table: Pick<SheetTable, 'range'>): TableBounds {
  const [bounds] = sqrefBounds(table.range);
  return bounds;
}

/** The rows of a table that hold data: not its header or total row. */
export function tableDataRows(table: SheetTable) {
  const { top, bottom } = tableBounds(table);
  return { first: top + 1, last: bottom - (table.totalsRow ? 1 : 0) };
}

/** Excel's naming rules: a letter, `_` or `\` first, then letters, digits,
 * `.` and `_`; never something that reads as a cell reference. */
export function validTableName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_TABLE_NAME_LENGTH &&
    /^[\p{L}_\\][\p{L}\p{N}_.\\]*$/u.test(name) &&
    !/^[A-Z]{1,3}\d+$/i.test(name) &&
    !/^R\d*C\d*$/i.test(name)
  );
}

const filterText = (value: unknown) =>
  typeof value === 'string' && value.length <= MAX_FILTER_VALUE_LENGTH;

function validCondition(value: unknown): value is TableFilterCondition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const condition = value as Record<string, unknown>;
  return (
    Object.keys(condition).every((key) =>
      ['operator', 'value', 'value2'].includes(key)
    ) &&
    TABLE_FILTER_OPERATORS.some(
      (operator) => operator === condition.operator
    ) &&
    (condition.value === undefined || filterText(condition.value)) &&
    (condition.value2 === undefined || filterText(condition.value2))
  );
}

function validFilter(value: unknown): value is TableColumnFilter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const filter = value as Record<string, unknown>;
  return (
    Object.keys(filter).every((key) =>
      ['values', 'blanks', 'condition'].includes(key)
    ) &&
    (filter.values === undefined ||
      (Array.isArray(filter.values) &&
        filter.values.length <= MAX_FILTER_VALUES &&
        filter.values.every(filterText))) &&
    (filter.blanks === undefined || typeof filter.blanks === 'boolean') &&
    (filter.condition === undefined || validCondition(filter.condition)) &&
    (filter.values !== undefined || filter.condition !== undefined)
  );
}

/** A record keyed by column position from a table's first column. */
function validColumnRecord(
  value: unknown,
  width: number,
  valid: (item: unknown) => boolean
) {
  return (
    value === undefined ||
    (!!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([key, item]) => /^\d+$/.test(key) && Number(key) < width && valid(item)
      ))
  );
}

export function validSheetTable(value: unknown): value is SheetTable {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const table = value as Record<string, unknown>;
  if (
    !Object.keys(table).every((key) =>
      [
        'id',
        'name',
        'range',
        'totalsRow',
        'bandedRows',
        'bandedColumns',
        'firstColumn',
        'lastColumn',
        'style',
        'color',
        'filters',
        'columnTypes',
      ].includes(key)
    ) ||
    (table.color !== undefined &&
      (typeof table.color !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(table.color))) ||
    (table.id !== undefined &&
      (typeof table.id !== 'string' || !table.id || table.id.length > 64)) ||
    typeof table.name !== 'string' ||
    !validTableName(table.name) ||
    typeof table.range !== 'string' ||
    typeof table.totalsRow !== 'boolean' ||
    typeof table.bandedRows !== 'boolean' ||
    ['bandedColumns', 'firstColumn', 'lastColumn'].some(
      (key) => table[key] !== undefined && typeof table[key] !== 'boolean'
    ) ||
    (table.style !== undefined &&
      (typeof table.style !== 'string' || table.style.length > 255))
  )
    return false;
  const [first, last, ...rest] = table.range.split(':').map(parseCellAddress);
  if (!first || !last || rest.length) return false;
  // A header row and a data row, and the total row when there is one.
  const rows = last.row - first.row + 1;
  if (last.column < first.column || rows < (table.totalsRow ? 3 : 2))
    return false;
  const width = last.column - first.column + 1;
  return (
    validColumnRecord(table.filters, width, validFilter) &&
    validColumnRecord(table.columnTypes, width, (type) =>
      TABLE_COLUMN_TYPES.some((item) => item === type)
    )
  );
}

/**
 * Column names from the header cells: their text, `Column1` and so on for
 * blank or formula headers, and a number appended to repeated names, as
 * Excel names them.
 */
export function tableColumnNames(
  table: Pick<SheetTable, 'range'>,
  cells: SpreadsheetCells
): string[] {
  const { top, left, right } = tableBounds(table);
  const taken = new Set<string>();
  const names: string[] = [];
  for (let column = left; column <= right; column++) {
    const cell = cells[formatCellAddress(top, column)];
    const text =
      !cell || (cell.value.startsWith('=') && cell.format !== 'text')
        ? ''
        : cellPlainText(cell.value).replace(/^'/, '');
    const base = text.trim() ? text : `Column${column - left + 1}`;
    let name = base;
    for (let suffix = 2; taken.has(name.trim().toLowerCase()); suffix++)
      name = `${base}${suffix}`;
    taken.add(name.trim().toLowerCase());
    names.push(name);
  }
  return names;
}

/** Where a sheet's tables are and their column names, as formulas see them. */
export function sheetTableLayouts(sheet: {
  name: string;
  cells: SpreadsheetCells;
  metadata?: Pick<WorkbookSheetMetadata, 'tables'>;
}): WorkbookTable[] {
  return (sheet.metadata?.tables ?? []).map((table) => ({
    name: table.name,
    sheet: sheet.name,
    ...tableBounds(table),
    headerRows: 1,
    totalsRows: table.totalsRow ? 1 : 0,
    columns: tableColumnNames(table, sheet.cells),
    ...(table.filters && { filtered: true }),
  }));
}

export function tableAt(
  tables: SheetTable[] | undefined,
  row: number,
  column: number
): SheetTable | undefined {
  return tables?.find((table) => {
    const bounds = tableBounds(table);
    return (
      row >= bounds.top &&
      row <= bounds.bottom &&
      column >= bounds.left &&
      column <= bounds.right
    );
  });
}

function overlaps(first: TableBounds, second: TableBounds) {
  return (
    first.top <= second.bottom &&
    first.bottom >= second.top &&
    first.left <= second.right &&
    first.right >= second.left
  );
}

/**
 * The block of filled cells around `bounds`, as Excel's current region and
 * Google Sheets' convert to table find a table's data: the range grows while
 * a cell next to it, diagonals included, holds a value. Rows and columns are
 * `limits` at most.
 */
export function currentRegion(
  cells: SpreadsheetCells,
  bounds: TableBounds,
  limits: { rows: number; columns: number }
): TableBounds {
  const region = { ...bounds };
  const filled = (row: number, column: number) =>
    row >= 0 &&
    column >= 0 &&
    row < limits.rows &&
    column < limits.columns &&
    !isEmpty(cells, row, column);
  const rowFilled = (row: number) => {
    for (let column = region.left - 1; column <= region.right + 1; column++)
      if (filled(row, column)) return true;
    return false;
  };
  const columnFilled = (column: number) => {
    for (let row = region.top - 1; row <= region.bottom + 1; row++)
      if (filled(row, column)) return true;
    return false;
  };
  for (let grown = true; grown; ) {
    grown = false;
    if (region.top > 0 && rowFilled(region.top - 1)) {
      region.top--;
      grown = true;
    }
    if (region.bottom + 1 < limits.rows && rowFilled(region.bottom + 1)) {
      region.bottom++;
      grown = true;
    }
    if (region.left > 0 && columnFilled(region.left - 1)) {
      region.left--;
      grown = true;
    }
    if (region.right + 1 < limits.columns && columnFilled(region.right + 1)) {
      region.right++;
      grown = true;
    }
  }
  return region;
}

/** The first `Table1`, `Table2`… not among `taken`. */
export function nextTableName(taken: Iterable<string>): string {
  const names = new Set([...taken].map((name) => name.toLowerCase()));
  for (let index = 1; ; index++)
    if (!names.has(`table${index}`)) return `Table${index}`;
}

/** A valid name no other table or defined name uses, or an explanation.
 * Spaces become underscores, as Google Sheets writes table names in
 * formulas. */
export function checkTableName(name: string, taken: Iterable<string>): string {
  const trimmed = name.trim().replace(/\s+/g, '_');
  if (!validTableName(trimmed) || /^(?:true|false)$/i.test(trimmed))
    throw new Error(
      `“${trimmed}” is not a valid table name. Start with a letter or underscore and use only letters, numbers, periods and underscores; a name cannot be TRUE or FALSE or look like a cell reference such as A1.`
    );
  const lower = trimmed.toLowerCase();
  if ([...taken].some((existing) => existing.toLowerCase() === lower))
    throw new Error(
      `The workbook already uses the name “${trimmed}”. Choose another table name.`
    );
  return trimmed;
}

/** The total row formula of an aggregate, such as `=SUBTOTAL(109,[Amount])`. */
export function totalsFormula(
  aggregate: TableTotalsFunction,
  column: string
): string {
  const values = `[${escapedColumnName(column)}]`;
  if (excelTotalsFunction(aggregate))
    return `=SUBTOTAL(${TABLE_TOTALS_FUNCTIONS[aggregate]},${values})`;
  const unique = `SUMPRODUCT((${values}<>"")/COUNTIF(${values},${values}&""))`;
  return {
    empty: `=COUNTBLANK(${values})`,
    unique: `=${unique}`,
    percentFilled: `=SUBTOTAL(103,${values})/ROWS(${values})`,
    percentEmpty: `=COUNTBLANK(${values})/ROWS(${values})`,
    percentUnique: `=${unique}/ROWS(${values})`,
  }[aggregate];
}

/** The aggregate a total row formula computes for `column`, if it is one;
 * the formula may name `table`. */
export function totalsFunction(
  formula: string,
  column: string,
  table?: string
): TableTotalsFunction | undefined {
  const own = table && `${table.toLowerCase()}[`;
  const normalize = (text: string) => {
    const compact = text.replace(/\s+/g, '').toLowerCase();
    return own ? compact.replaceAll(own, '[') : compact;
  };
  const target = normalize(formula);
  return TABLE_TOTALS.find(
    (aggregate) => normalize(totalsFormula(aggregate, column)) === target
  );
}

function isEmpty(cells: SpreadsheetCells, row: number, column: number) {
  return !cells[formatCellAddress(row, column)]?.value;
}

/** The total row's starting cells: a label and the last column's total. */
function totalsRowEdits(
  bounds: TableBounds,
  row: number,
  names: string[],
  cells: SpreadsheetCells
): SpreadsheetCellEdits {
  const edits: SpreadsheetCellEdits = {};
  const last = names.length - 1;
  let numeric = false;
  for (let data = bounds.top + 1; data < row && !numeric; data++) {
    const value = cells[formatCellAddress(data, bounds.right)]?.value ?? '';
    numeric =
      value.startsWith('=') ||
      (value.trim() !== '' && Number.isFinite(Number(value)));
  }
  if (last > 0) edits[formatCellAddress(row, bounds.left)] = { value: 'Total' };
  edits[formatCellAddress(row, bounds.right)] = {
    value: totalsFormula(numeric ? 'sum' : 'count', names[last]),
  };
  return edits;
}

export type TableChange = {
  metadata: WorkbookSheetMetadata;
  edits: SpreadsheetCellEdits;
};

/**
 * Convert a range to a table. Its first row becomes the header row: blank,
 * formula and repeated headers are written as the names Excel would give.
 * A one-row range takes the empty row below as its first data row. A
 * filter on the range's cells moves to the table.
 */
export function createTable(options: {
  metadata: WorkbookSheetMetadata | undefined;
  cells: SpreadsheetCells;
  range: string;
  name: string;
  totalsRow?: boolean;
  rowCount: number;
  /** A header formula's displayed text, which becomes its name. */
  display?: (address: string) => string | undefined;
}): TableChange {
  const { metadata, cells } = options;
  const bounds = rangeBounds(options.range);
  if (bounds.top === bounds.bottom) {
    const below = bounds.bottom + 1;
    if (below >= options.rowCount)
      throw new Error('Add a row below the headers, then convert them.');
    for (let column = bounds.left; column <= bounds.right; column++)
      if (!isEmpty(cells, below, column))
        throw new Error(
          'Select the headers and the data below them to convert to a table.'
        );
    bounds.bottom = below;
  }
  if ((metadata?.tables?.length ?? 0) >= MAX_SHEET_TABLES)
    throw new Error(`A sheet can have at most ${MAX_SHEET_TABLES} tables.`);
  checkPlacement(metadata, bounds);
  const edits = headerNameEdits(bounds, cells, options.display);
  const table: SheetTable = {
    name: options.name,
    range: boundsRange(bounds),
    totalsRow: false,
    bandedRows: true,
    style: 'TableStyleMedium2',
  };
  let next: WorkbookSheetMetadata = {
    ...metadata,
    tables: [...(metadata?.tables ?? []), table],
  };
  if (
    metadata?.autoFilter &&
    overlaps(sqrefBounds(metadata.autoFilter)[0], bounds)
  )
    delete next.autoFilter;
  if (options.totalsRow) {
    const change = setTableTotalsRow({
      metadata: next,
      cells: withEdits(cells, edits),
      name: table.name,
      totalsRow: true,
      rowCount: options.rowCount,
    });
    next = change.metadata;
    Object.assign(edits, change.edits);
  }
  return { metadata: next, edits };
}

/** Cells with the values of `edits` written. */
export function withEdits(
  cells: SpreadsheetCells,
  edits: SpreadsheetCellEdits
): SpreadsheetCells {
  const result: SpreadsheetCells = { ...cells };
  for (const [address, edit] of Object.entries(edits))
    if (edit?.value !== undefined)
      result[address] = { ...cells[address], value: edit.value };
  return result;
}

function boundsRange(bounds: TableBounds) {
  return `${formatCellAddress(bounds.top, bounds.left)}:${formatCellAddress(bounds.bottom, bounds.right)}`;
}

/** The cells a range such as `A1:D20` covers. */
function rangeBounds(range: string): TableBounds {
  const [first, last = first] = range
    .split(':')
    .map((address) => parseCellAddress(address.trim().toUpperCase()));
  if (!first || !last || range.split(':').length > 2)
    throw new Error(`Invalid range “${range}”. Select cells such as A1:D20.`);
  return {
    top: Math.min(first.row, last.row),
    left: Math.min(first.column, last.column),
    bottom: Math.max(first.row, last.row),
    right: Math.max(first.column, last.column),
  };
}

/** Throws unless a table fits at `bounds`: clear of other tables, other
 * than `except`, and merged cells. */
function checkPlacement(
  metadata: WorkbookSheetMetadata | undefined,
  bounds: TableBounds,
  except?: string
) {
  if (
    (metadata?.tables ?? []).some(
      (table) => table.name !== except && overlaps(tableBounds(table), bounds)
    )
  )
    throw new Error(
      'Tables cannot overlap. Select cells outside the existing table.'
    );
  if (
    (metadata?.merges ?? []).some((merge) =>
      sqrefBounds(merge).some((area) => overlaps(area, bounds))
    )
  )
    throw new Error('Unmerge the cells before converting them to a table.');
}

/** Header cells written with the names Excel gives blank, formula and
 * repeated headers. */
function headerNameEdits(
  bounds: TableBounds,
  cells: SpreadsheetCells,
  display?: (address: string) => string | undefined
): SpreadsheetCellEdits {
  const edits: SpreadsheetCellEdits = {};
  const headerCells: SpreadsheetCells = { ...cells };
  for (let column = bounds.left; column <= bounds.right; column++) {
    const address = formatCellAddress(bounds.top, column);
    const cell = cells[address];
    if (cell?.value.startsWith('=') && cell.format !== 'text') {
      const text = display?.(address)?.trim() ?? '';
      headerCells[address] = { ...cell, value: text };
    }
  }
  const names = tableColumnNames({ range: boundsRange(bounds) }, headerCells);
  names.forEach((name, offset) => {
    const address = formatCellAddress(bounds.top, bounds.left + offset);
    const cell = cells[address];
    const text =
      cell && !(cell.value.startsWith('=') && cell.format !== 'text')
        ? cellPlainText(cell.value).replace(/^'/, '')
        : undefined;
    if (text !== name)
      edits[address] = { value: name.startsWith('=') ? `'${name}` : name };
  });
  return edits;
}

/** A column record moved to a table whose first column is `left`: entries
 * of columns outside the table's `width` are dropped. */
function movedColumns<T>(
  record: Record<string, T> | undefined,
  shift: number,
  width: number
): Record<string, T> | undefined {
  if (!record) return;
  const moved = Object.fromEntries(
    Object.entries(record).flatMap(([offset, value]) => {
      const next = Number(offset) + shift;
      return next >= 0 && next < width ? [[String(next), value]] : [];
    })
  );
  return Object.keys(moved).length ? moved : undefined;
}

/**
 * Change the cells a table covers. The range's first row becomes the header
 * row, its blank and repeated headers named, and with a total row its last
 * row the total row. Filters and column types follow their columns; columns
 * left out lose theirs.
 */
export function resizeTable(options: {
  metadata: WorkbookSheetMetadata | undefined;
  cells: SpreadsheetCells;
  name: string;
  range: string;
  display?: (address: string) => string | undefined;
}): TableChange {
  const table = findTable(options.metadata, options.name);
  const bounds = rangeBounds(options.range);
  if (bounds.bottom - bounds.top < (table.totalsRow ? 2 : 1))
    throw new Error(
      table.totalsRow
        ? 'A table needs a header row, a data row and its total row.'
        : 'A table needs a header row and at least one data row.'
    );
  checkPlacement(options.metadata, bounds, table.name);
  const width = bounds.right - bounds.left + 1;
  const shift = tableBounds(table).left - bounds.left;
  const filters = movedColumns(table.filters, shift, width);
  const columnTypes = movedColumns(table.columnTypes, shift, width);
  const { filters: _filters, columnTypes: _columnTypes, ...rest } = table;
  const resized: SheetTable = {
    ...rest,
    range: boundsRange(bounds),
    ...(filters && { filters }),
    ...(columnTypes && { columnTypes }),
  };
  return {
    metadata: replaceTable(options.metadata ?? {}, table.name, () => resized),
    edits: headerNameEdits(bounds, options.cells, options.display),
  };
}

export function replaceTable(
  metadata: WorkbookSheetMetadata,
  name: string,
  update: (table: SheetTable) => SheetTable | undefined
): WorkbookSheetMetadata {
  const tables = (metadata.tables ?? []).flatMap((table) => {
    if (table.name !== name) return [table];
    const next = update(table);
    return next ? [next] : [];
  });
  const { tables: _tables, ...rest } = metadata;
  return tables.length ? { ...rest, tables } : rest;
}

export function findTable(
  metadata: WorkbookSheetMetadata | undefined,
  name: string
) {
  const table = metadata?.tables?.find((item) => item.name === name);
  if (!table)
    throw new Error(`There is no table named “${name}” on this sheet.`);
  return table;
}

/**
 * Add a total row below the data, which must be empty, or remove it. A new
 * total row labels the first column and totals the last.
 */
export function setTableTotalsRow(options: {
  metadata: WorkbookSheetMetadata | undefined;
  cells: SpreadsheetCells;
  name: string;
  totalsRow: boolean;
  rowCount: number;
}): TableChange {
  const table = findTable(options.metadata, options.name);
  const metadata = options.metadata ?? {};
  if (table.totalsRow === options.totalsRow) return { metadata, edits: {} };
  const bounds = tableBounds(table);
  const edits: SpreadsheetCellEdits = {};
  if (!options.totalsRow) {
    for (let column = bounds.left; column <= bounds.right; column++)
      if (!isEmpty(options.cells, bounds.bottom, column))
        edits[formatCellAddress(bounds.bottom, column)] = { value: '' };
    return {
      metadata: replaceTable(metadata, table.name, (current) => ({
        ...current,
        totalsRow: false,
        range: `${formatCellAddress(bounds.top, bounds.left)}:${formatCellAddress(bounds.bottom - 1, bounds.right)}`,
      })),
      edits,
    };
  }
  const row = bounds.bottom + 1;
  const blocked =
    row >= options.rowCount ||
    Array.from({ length: bounds.right - bounds.left + 1 }).some(
      (_, offset) => !isEmpty(options.cells, row, bounds.left + offset)
    ) ||
    (metadata.tables ?? []).some(
      (other) =>
        other.name !== table.name &&
        overlaps(tableBounds(other), { ...bounds, top: row, bottom: row })
    );
  if (blocked)
    throw new Error(
      'The row below the table must be empty to add a total row. Clear it or add rows, then try again.'
    );
  Object.assign(
    edits,
    totalsRowEdits(
      bounds,
      row,
      tableColumnNames(table, options.cells),
      options.cells
    )
  );
  return {
    metadata: replaceTable(metadata, table.name, (current) => ({
      ...current,
      totalsRow: true,
      range: `${formatCellAddress(bounds.top, bounds.left)}:${formatCellAddress(row, bounds.right)}`,
    })),
    edits,
  };
}

/**
 * Typing one value directly below a table, or directly right of it, extends
 * the table to include it, as Excel does. A new column's blank header gets
 * a name. Returns undefined when no table grows.
 */
export function expandTables(options: {
  metadata: WorkbookSheetMetadata | undefined;
  cells: SpreadsheetCells;
  edits: SpreadsheetCellEdits;
}): TableChange | undefined {
  const tables = options.metadata?.tables;
  const entries = Object.entries(options.edits);
  if (!tables?.length || entries.length !== 1) return;
  const [address, edit] = entries[0];
  const position = parseCellAddress(address);
  if (
    !position ||
    !edit?.value ||
    tableAt(tables, position.row, position.column)
  )
    return;
  for (const table of tables) {
    const bounds = tableBounds(table);
    const below =
      !table.totalsRow &&
      position.row === bounds.bottom + 1 &&
      position.column >= bounds.left &&
      position.column <= bounds.right;
    const right =
      position.column === bounds.right + 1 &&
      position.row >= bounds.top &&
      position.row <= bounds.bottom;
    if (!below && !right) continue;
    const grown = below
      ? { ...bounds, bottom: bounds.bottom + 1 }
      : { ...bounds, right: bounds.right + 1 };
    if (
      tables.some(
        (other) =>
          other.name !== table.name && overlaps(tableBounds(other), grown)
      )
    )
      return;
    const edits: SpreadsheetCellEdits = {};
    const header = formatCellAddress(bounds.top, position.column);
    if (
      right &&
      position.row !== bounds.top &&
      isEmpty(options.cells, bounds.top, position.column)
    ) {
      const range = `${formatCellAddress(grown.top, grown.left)}:${formatCellAddress(grown.bottom, grown.right)}`;
      edits[header] = {
        value: tableColumnNames({ range }, options.cells).at(-1) ?? '',
      };
    }
    return {
      metadata: replaceTable(options.metadata ?? {}, table.name, (current) => ({
        ...current,
        range: `${formatCellAddress(grown.top, grown.left)}:${formatCellAddress(grown.bottom, grown.right)}`,
      })),
      edits,
    };
  }
}

/**
 * Whether a hidden row stays hidden when table `name` filters, sorts or
 * stops being a table: it is outside the table's data rows, or in the data
 * rows of another filtered table, whose filter may hide it.
 */
export function keepsHiddenRow(
  metadata: WorkbookSheetMetadata | undefined,
  name: string
): (row: number) => boolean {
  const own = tableDataRows(findTable(metadata, name));
  const others = (metadata?.tables ?? [])
    .filter((table) => table.name !== name && table.filters)
    .map(tableDataRows);
  return (row) =>
    row < own.first ||
    row > own.last ||
    others.some(({ first, last }) => row >= first && row <= last);
}
