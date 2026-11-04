import { cellDateMention, cellPlainText, cellTextParts } from './cell-mentions';
import { checkboxChecked } from './checkboxes';
import {
  DROPDOWN_CHOICE_COLORS,
  dropdownRule,
  literalListItems,
  MAX_LIST_FORMULA_LENGTH,
  replaceValidations,
} from './data-validation';
import {
  boundsSqref,
  type CellBounds,
  type DataValidation,
  sqrefBounds,
  sqrefContains,
} from './sheet-rules';
import {
  createTable,
  findTable,
  replaceTable,
  type SheetTable,
  type TableChange,
  type TableColumnType,
  tableBounds,
  tableColumnNames,
  tableDataRows,
  withEdits,
} from './sheet-tables';
import {
  formatCellAddress,
  parseCellAddress,
  type SpreadsheetCell,
  type SpreadsheetCellEdits,
  type SpreadsheetCellStyle,
  type SpreadsheetCells,
} from './spreadsheet-document';
import { hasThisRowReference } from './structured-references';
import type { WorkbookSheetMetadata } from './workbook-metadata';

export const TABLE_COLUMN_TYPE_LABELS: Record<TableColumnType, string> = {
  text: 'Text',
  number: 'Number',
  percent: 'Percent',
  currency: 'Currency',
  date: 'Date',
  datetime: 'Date time',
  time: 'Time',
  checkbox: 'Checkbox',
  dropdown: 'Dropdown',
  person: 'People',
};

const PLAIN: SpreadsheetCellStyle = {
  format: 'general',
  numberFormat: '',
  checkbox: false,
};

/** The number format, or checkbox, a column type gives its cells. */
export function columnTypeStyle(type: TableColumnType): SpreadsheetCellStyle {
  switch (type) {
    case 'text':
      return { ...PLAIN, format: 'text' };
    case 'number':
    case 'percent':
    case 'currency':
    case 'date':
    case 'time':
      return { ...PLAIN, format: type };
    case 'datetime':
      return { ...PLAIN, format: 'date', numberFormat: 'm/d/yyyy h:mm' };
    case 'checkbox':
      return { ...PLAIN, checkbox: true };
    case 'dropdown':
    case 'person':
      return PLAIN;
  }
}

/** A cell's value as a type check reads it: its shown text, and its number
 * when it calculates to one. */
export type TableCellValue = {
  display: string;
  number?: number;
  error?: string;
};

/**
 * Why a cell's value does not fit its column's type, or undefined when it
 * fits. Blank cells and errors fit every type. `choices` are a dropdown
 * column's options.
 */
export function columnTypeMismatch(
  type: TableColumnType | undefined,
  cell: SpreadsheetCell | undefined,
  value: TableCellValue | undefined,
  choices?: string[]
): string | undefined {
  const source = cell?.value ?? '';
  if (!type || !source.trim() || value?.error) return;
  const display = (value?.display ?? source).trim();
  const number =
    value?.number ??
    (!source.startsWith('=') && Number.isFinite(Number(source))
      ? Number(source)
      : undefined);
  switch (type) {
    case 'number':
    case 'percent':
    case 'currency':
      return number === undefined ? 'Expected a number' : undefined;
    case 'date':
    case 'datetime':
      return number === undefined && !cellDateMention(source)
        ? 'Expected a date'
        : undefined;
    case 'time':
      return number === undefined ? 'Expected a time' : undefined;
    case 'checkbox':
      return checkboxChecked(display) === undefined
        ? 'Expected a checkbox: TRUE or FALSE'
        : undefined;
    case 'dropdown':
      return choices &&
        !choices.some(
          (choice) => choice.toLowerCase() === display.toLowerCase()
        )
        ? 'Expected one of the dropdown’s options'
        : undefined;
    case 'person':
      return cellTextParts(source).every((part) =>
        part.mention ? part.mention.type === 'user' : /^[\s,]*$/.test(part.text)
      ) && cellTextParts(source).some((part) => part.mention)
        ? undefined
        : 'Expected a person: type @ to mention someone';
    case 'text':
      return;
  }
}

/** Choices for a column becoming a dropdown: its distinct values, as many
 * as a typed list holds, or two placeholders. */
function dropdownChoices(values: string[]): string[] {
  const choices: string[] = [];
  const seen = new Set<string>();
  let length = 2;
  for (const value of values) {
    const choice = value.trim();
    const key = choice.toLowerCase();
    if (!choice || choice.includes(',') || seen.has(key)) continue;
    const next =
      length + choice.replace(/"/g, '""').length + (choices.length ? 1 : 0);
    if (next > MAX_LIST_FORMULA_LENGTH) break;
    choices.push(choice);
    seen.add(key);
    length = next;
  }
  return choices.length ? choices : ['Option 1', 'Option 2'];
}

/** A list rule covering every cell of `area`. */
function listRuleCovering(
  validations: DataValidation[] | undefined,
  area: CellBounds
) {
  return validations?.find(
    (rule) =>
      rule.type === 'list' &&
      Array.from({ length: area.bottom - area.top + 1 }).every((_, offset) =>
        sqrefContains(rule.range, area.top + offset, area.left)
      )
  );
}

/** The options of a dropdown column, when its list is typed. */
export function columnChoices(
  validations: DataValidation[] | undefined,
  table: SheetTable,
  column: number
): string[] | undefined {
  const { first, last } = tableDataRows(table);
  const rule = listRuleCovering(validations, {
    top: first,
    bottom: last,
    left: column,
    right: column,
  });
  const source = rule?.formulas?.[0];
  return source === undefined ? undefined : literalListItems(source);
}

/**
 * Give a table column a type, or none. The column's data cells take the
 * type's number format; a checkbox column shows its blank cells unchecked,
 * as FALSE, and a dropdown column offers its values, colored, as choices.
 * Leaving the checkbox or dropdown type removes its checkboxes or list.
 */
export function setTableColumnType(options: {
  metadata: WorkbookSheetMetadata | undefined;
  cells: SpreadsheetCells;
  name: string;
  column: number;
  type: TableColumnType | undefined;
  /** What a cell shows, for a new dropdown's choices. */
  display: (row: number, column: number) => string;
}): TableChange {
  const { cells, column, type } = options;
  const table = findTable(options.metadata, options.name);
  const bounds = tableBounds(table);
  if (column < bounds.left || column > bounds.right)
    throw new Error('Choose a column of the table.');
  const offset = String(column - bounds.left);
  const previous = table.columnTypes?.[offset];
  const { first, last } = tableDataRows(table);
  const area = { top: first, bottom: last, left: column, right: column };
  const edits: SpreadsheetCellEdits = {};
  for (let row = first; row <= last; row++) {
    const address = formatCellAddress(row, column);
    const cell = cells[address];
    if (type) edits[address] = columnTypeStyle(type);
    else if (previous === 'checkbox' && cell?.checkbox)
      edits[address] = { checkbox: false };
    if (type === 'checkbox' && !cell?.value)
      edits[address] = { ...edits[address], value: 'FALSE' };
  }
  let validations = options.metadata?.validations;
  const range = boundsSqref([area]);
  if (type === 'dropdown' && !listRuleCovering(validations, area)) {
    const values: string[] = [];
    for (let row = first; row <= last; row++)
      values.push(options.display(row, column));
    const choices = dropdownChoices(values);
    validations = replaceValidations(
      validations,
      range,
      dropdownRule({
        items: choices,
        rejectInvalid: false,
        colors: choices.map((item, index) => ({
          item,
          color:
            DROPDOWN_CHOICE_COLORS[index % DROPDOWN_CHOICE_COLORS.length].value,
        })),
      })
    );
  } else if (previous === 'dropdown' && type !== 'dropdown')
    validations = replaceValidations(validations, range);
  const metadata = replaceTable(
    options.metadata ?? {},
    table.name,
    (current) => {
      const columnTypes = { ...current.columnTypes };
      if (type) columnTypes[offset] = type;
      else delete columnTypes[offset];
      const { columnTypes: _types, ...rest } = current;
      return Object.keys(columnTypes).length ? { ...rest, columnTypes } : rest;
    }
  );
  const { validations: _validations, ...rest } = metadata;
  return {
    metadata: validations?.length ? { ...rest, validations } : rest,
    edits,
  };
}

/**
 * Column types a new table's data suggests, by column position: a type
 * every value of a column fits, from its formats, checkboxes, list rules and
 * values; text takes any other literal values. Columns with formulas or
 * TRUE/FALSE among other values, or with no values, stay untyped.
 */
export function detectColumnTypes(
  table: SheetTable,
  cells: SpreadsheetCells,
  validations?: DataValidation[]
): Record<string, TableColumnType> {
  const bounds = tableBounds(table);
  const { first, last } = tableDataRows(table);
  const types: Record<string, TableColumnType> = {};
  for (let column = bounds.left; column <= bounds.right; column++) {
    const filled: SpreadsheetCell[] = [];
    for (let row = first; row <= last; row++) {
      const cell = cells[formatCellAddress(row, column)];
      if (cell?.value.trim()) filled.push(cell);
    }
    const listed = !!listRuleCovering(validations, {
      top: first,
      bottom: last,
      left: column,
      right: column,
    });
    const type = filled.length ? suggestedType(filled, listed) : undefined;
    if (type) types[String(column - bounds.left)] = type;
  }
  return types;
}

/** The type every one of a column's filled cells fits, if there is one. */
function suggestedType(
  filled: SpreadsheetCell[],
  listed: boolean
): TableColumnType | undefined {
  const every = (test: (cell: SpreadsheetCell) => boolean) =>
    filled.every(test);
  const numeric = (cell: SpreadsheetCell) =>
    !cell.value.startsWith('=') && Number.isFinite(Number(cell.value));
  const formatted = (...formats: SpreadsheetCell['format'][]) =>
    every((cell) => formats.includes(cell.format) && numeric(cell));
  if (every((cell) => !!cell.checkbox)) return 'checkbox';
  if (listed) return 'dropdown';
  if (every((cell) => !columnTypeMismatch('person', cell, undefined)))
    return 'person';
  if (formatted('percent')) return 'percent';
  if (formatted('currency', 'accounting')) return 'currency';
  if (
    every(
      (cell) =>
        (cell.format === 'date' && numeric(cell)) ||
        !!cellDateMention(cell.value)
    )
  )
    return filled.some((cell) => /h/i.test(cell.numberFormat ?? ''))
      ? 'datetime'
      : 'date';
  if (formatted('time')) return 'time';
  if (every(numeric)) return 'number';
  if (
    every(
      (cell) =>
        !cell.value.startsWith('=') && checkboxChecked(cell.value) === undefined
    )
  )
    return 'text';
}

/** The style of a cell, without its value. */
function cellStyle(cell: SpreadsheetCell | undefined): SpreadsheetCellStyle {
  if (!cell) return {};
  const { value: _value, ...style } = cell;
  return style;
}

/** The formula every data cell of a column holds, if they share one. */
function calculatedFormula(
  table: SheetTable,
  cells: SpreadsheetCells,
  column: number
): string | undefined {
  const { first, last } = tableDataRows(table);
  let formula: string | undefined;
  for (let row = first; row <= last; row++) {
    const cell = cells[formatCellAddress(row, column)];
    if (!cell?.value.startsWith('=') || cell.format === 'text') return;
    if (formula !== undefined && cell.value !== formula) return;
    formula = cell.value;
  }
  return formula;
}

/** `rule` with the cell at `row` and `column` added to its range. */
function extendedRule(
  rule: DataValidation,
  row: number,
  column: number
): DataValidation {
  const areas = [
    ...sqrefBounds(rule.range),
    { top: row, bottom: row, left: column, right: column },
  ].sort((a, b) => a.left - b.left || a.right - b.right || a.top - b.top);
  const merged: CellBounds[] = [];
  for (const area of areas) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.left === area.left &&
      previous.right === area.right &&
      area.top <= previous.bottom + 1
    )
      previous.bottom = Math.max(previous.bottom, area.bottom);
    else merged.push({ ...area });
  }
  return { ...rule, range: boundsSqref(merged) };
}

/**
 * Cells and rules a row added to the bottom of a table takes from the row
 * above, as Excel and Google Sheets fill a table's new row: each cell's
 * formatting and list, and the formula of a calculated column, whose data
 * cells all hold one formula. `edits` are the cells being written to the
 * new row, which keep their own values.
 */
export function newTableRow(options: {
  metadata: WorkbookSheetMetadata;
  table: SheetTable;
  cells: SpreadsheetCells;
  row: number;
  edits: SpreadsheetCellEdits;
}): { edits: SpreadsheetCellEdits; validations?: DataValidation[] } {
  const { table, cells, row } = options;
  const bounds = tableBounds(table);
  const edits: SpreadsheetCellEdits = {};
  let validations = options.metadata.validations;
  let rulesChanged = false;
  for (let column = bounds.left; column <= bounds.right; column++) {
    const address = formatCellAddress(row, column);
    const above = cells[formatCellAddress(row - 1, column)];
    const edit = options.edits[address];
    const style = cells[address] ? {} : cellStyle(above);
    const formula =
      edit?.value === undefined &&
      !cells[address]?.value &&
      calculatedFormula(
        {
          ...table,
          range: `${formatCellAddress(bounds.top, bounds.left)}:${formatCellAddress(row - 1, bounds.right)}`,
        },
        cells,
        column
      );
    const next = { ...style, ...(formula && { value: formula }), ...edit };
    if (Object.keys(next).length) edits[address] = next;
    const rule = validations?.find((item) =>
      sqrefContains(item.range, row - 1, column)
    );
    if (
      rule &&
      !validations?.some((item) => sqrefContains(item.range, row, column))
    ) {
      validations = validations?.map((item) =>
        item === rule ? extendedRule(item, row, column) : item
      );
      rulesChanged = true;
    }
  }
  return { edits, ...(rulesChanged && { validations }) };
}

/**
 * Typing a formula that refers to its own row, such as `=[@Qty]*[@Price]`,
 * into an empty column of a table fills the column with it, as Excel's
 * calculated columns do. Returns the edits for the column's other cells.
 */
export function calculatedColumnEdits(
  tables: SheetTable[] | undefined,
  cells: SpreadsheetCells,
  edits: SpreadsheetCellEdits
): SpreadsheetCellEdits | undefined {
  const entries = Object.entries(edits);
  if (!tables?.length || entries.length !== 1) return;
  const [address, edit] = entries[0];
  const value = edit?.value;
  if (!value?.startsWith('=') || !hasThisRowReference(value)) return;
  const position = parseCellAddress(address);
  if (!position) return;
  const table = tables.find((item) => {
    const bounds = tableBounds(item);
    const { first, last } = tableDataRows(item);
    return (
      position.row >= first &&
      position.row <= last &&
      position.column >= bounds.left &&
      position.column <= bounds.right
    );
  });
  if (!table) return;
  const { first, last } = tableDataRows(table);
  if (first === last) return;
  for (let row = first; row <= last; row++)
    if (
      row !== position.row &&
      cells[formatCellAddress(row, position.column)]?.value
    )
      return;
  const fill: SpreadsheetCellEdits = {};
  for (let row = first; row <= last; row++)
    if (row !== position.row)
      fill[formatCellAddress(row, position.column)] = { value };
  return fill;
}

/** Edits with `more` written over them, cell by cell. */
function mergedEdits(
  edits: SpreadsheetCellEdits,
  more: SpreadsheetCellEdits
): SpreadsheetCellEdits {
  const result = { ...edits };
  for (const [address, edit] of Object.entries(more))
    result[address] = edit && { ...result[address], ...edit };
  return result;
}

/**
 * Convert a range to a table whose columns take the types their values
 * suggest, or the `columnTypes` given by column name.
 */
export function createTypedTable(
  options: Parameters<typeof createTable>[0] & {
    columnTypes?: Record<string, TableColumnType>;
  }
): TableChange {
  const change = createTable(options);
  let edits = change.edits;
  const cells = () => withEdits(options.cells, edits);
  const table = findTable(change.metadata, options.name);
  const detected = detectColumnTypes(
    table,
    cells(),
    change.metadata.validations
  );
  let metadata = Object.keys(detected).length
    ? replaceTable(change.metadata, table.name, (current) => ({
        ...current,
        columnTypes: detected,
      }))
    : change.metadata;
  const names = tableColumnNames(table, cells());
  const { left } = tableBounds(table);
  for (const [column, type] of Object.entries(options.columnTypes ?? {})) {
    const offset = names.findIndex(
      (name) => name.trim().toLowerCase() === column.trim().toLowerCase()
    );
    if (offset < 0)
      throw new Error(
        `The table has no column “${column}”. Its columns are ${names.join(', ')}.`
      );
    const current = cells();
    const typed = setTableColumnType({
      metadata,
      cells: current,
      name: table.name,
      column: left + offset,
      type,
      display: (row, at) => {
        const address = formatCellAddress(row, at);
        return (
          options.display?.(address) ??
          cellPlainText(current[address]?.value ?? '')
        );
      },
    });
    metadata = typed.metadata;
    edits = mergedEdits(edits, typed.edits);
  }
  return { metadata, edits };
}
