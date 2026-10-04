import { type CompletionContext, getTokens, Model } from '@ironcalc/wasm';
import { format as formatExcelNumber } from 'ssf';
import { cellDateMention, cellPlainText } from './cell-mentions';
import {
  formatCellAddress,
  parseCellAddress,
  SPREADSHEET_DEFAULT_STYLE,
  SPREADSHEET_MAX_ROWS,
  SPREADSHEET_ROWS,
  type SpreadsheetCell,
  type SpreadsheetCellEdits,
  type SpreadsheetCells,
} from './spreadsheet-document';
import type { WorkbookSheetMetadata } from './workbook-metadata';
import { changeWorkbookAxis } from './workbook-structure';

export type CalculatedCell = {
  display: string;
  number?: number;
  error?: string;
  warning?: string;
  /** Included only for callers requesting typed results. */
  type?: 'blank' | 'number' | 'text' | 'boolean' | 'error';
  value?: string | number | boolean | null;
  /** Rows and columns an array formula's result occupies from this anchor. */
  spill?: { rows: number; columns: number };
};

export type SpreadsheetCalculation = Record<string, CalculatedCell>;
export type CalculationSheet = {
  id: string;
  name: string;
  cells: SpreadsheetCells;
  rowCount: number;
  metadata?: WorkbookSheetMetadata;
};
export type WorkbookCalculation = Record<string, SpreadsheetCalculation>;
export type CalculationContext = { sheetNames: string[]; activeSheet: number };
export type CellCopy = {
  from: { row: number; column: number };
  to: { row: number; column: number };
  cell: SpreadsheetCell;
};

export type SpreadsheetCalculator = {
  calculate: (
    cells: SpreadsheetCells,
    rowCount?: number
  ) => SpreadsheetCalculation;
  calculateWorkbook: (
    sheets: CalculationSheet[],
    options?: { includeTypes?: boolean }
  ) => WorkbookCalculation;
  copy: (
    copies: CellCopy[],
    context?: CalculationContext
  ) => SpreadsheetCellEdits;
  complete: (
    text: string,
    cursor: number,
    context?: CalculationContext
  ) => CompletionContext;
  changeAxis: typeof changeWorkbookAxis;
  /** An incremental calculation for a workbook that is edited repeatedly. */
  session: () => WorkbookCalculationSession;
  dispose: () => void;
};

const volatileName = /NOW|TODAY|RAND/i;
const volatileFunctions = new Set([
  'NOW',
  'TODAY',
  'RAND',
  'RANDBETWEEN',
  'RANDARRAY',
]);

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});
const DAY_MILLISECONDS = 86_400_000;
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);
/** 1 January 2000 as an Excel serial number. */
const MIN_FORMULA_DATE_SERIAL = 36_526;
// IronCalc treats this exact extent as a column style, without materializing
// a style cell for every empty row. The editable grid is still bounded to
// SPREADSHEET_MAX_ROWS.
const ENGINE_COLUMN_HEIGHT = 1_048_576;
const ENGINE_COLUMNS = 16_384;
const numericLiteral = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i;

/**
 * Excel serial for the mention's local calendar day. Presets such as
 * "Tomorrow" carry an end-of-day time, so the time of day is dropped to keep
 * date differences whole.
 */
function dateMentionSerial(iso: string): number {
  const date = new Date(iso);
  return (
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      SERIAL_EPOCH) /
    DAY_MILLISECONDS
  );
}

/**
 * IronCalc assigns date and time number formats to typed dates and to formulas
 * that operate on them, as Excel does. Honor those for cells without an
 * explicit Macro format; other inferred formats stay general.
 */
function inferredFormat(numberFormat: string): 'date' | 'time' | undefined {
  const tokens = numberFormat.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  if (/[dy]/i.test(tokens)) return 'date';
  if (/[hs]/i.test(tokens)) return 'time';
}

/**
 * Whether the engine's own number format may decide how a general cell shows.
 * Plain numeric literals never become dates; dates and formulas may.
 */
function canInferFormat(
  cell: SpreadsheetCell,
  value: string,
  isDate: boolean
): boolean {
  return (
    (!cell.format || cell.format === 'general') &&
    !cell.numberFormat &&
    (isDate || !numericLiteral.test(value))
  );
}

function displayNumber(number: number, cell?: SpreadsheetCell): string {
  const format = cell?.format ?? 'general';
  if (format === 'date') {
    // Excel's serial calendar contains a fictitious 29 February 1900. Keep
    // that compatibility day while converting actual dates without a timezone shift.
    const day = Math.floor(number);
    if (day === 60) return '2/29/1900';
    const date = new Date(
      Date.UTC(1899, 11, 31) + (day - (day > 60 ? 1 : 0)) * DAY_MILLISECONDS
    );
    return Number.isFinite(date.getTime())
      ? dateFormatter.format(date)
      : '#NUM!';
  }
  if (format === 'time') {
    const fraction = ((number % 1) + 1) % 1;
    return timeFormatter.format(
      new Date(Math.round(fraction * 86_400) * 1_000)
    );
  }
  const decimals = cell?.decimals ?? -1;
  const key = `${format}:${decimals}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    const options: Intl.NumberFormatOptions = {};
    if (format === 'currency') {
      options.style = 'currency';
      options.currency = 'USD';
    } else if (format === 'percent') options.style = 'percent';
    else if (format === 'scientific') options.notation = 'scientific';
    if (format === 'general' || format === 'text') options.useGrouping = false;
    if (decimals >= 0) {
      options.minimumFractionDigits = decimals;
      options.maximumFractionDigits = decimals;
    } else if (format === 'general' || format === 'text') {
      options.maximumSignificantDigits = 15;
    } else {
      options.minimumFractionDigits = format === 'percent' ? 0 : 2;
      options.maximumFractionDigits = 2;
    }
    formatter = new Intl.NumberFormat('en-US', options);
    numberFormatters.set(key, formatter);
  }
  return formatter.format(number);
}

const errorDescriptions: Record<string, string> = {
  '#DIV/0!': 'This formula divides by zero or an empty cell.',
  '#CIRC!': 'This formula contains a circular reference.',
  '#ERROR!': 'This formula could not be parsed. Check its syntax.',
  '#NAME?': 'This formula contains an unknown function or name.',
  '#REF!': 'This formula refers to a cell or sheet that does not exist.',
  '#VALUE!': 'A value has the wrong type for this formula.',
  '#NUM!': 'This formula produced an invalid number.',
  '#N/A': 'A value needed by this formula is not available.',
  '#SPILL!': 'This array formula needs empty cells for its results.',
};

function unsupportedFunction(value: string): string | undefined {
  if (!value.startsWith('=') || !volatileName.test(value)) return;
  // Use the engine's tokenizer: text such as ="RAND()" is not a function.
  for (const { token } of getTokens(value)) {
    if (typeof token !== 'object' || !('Ident' in token)) continue;
    // IronCalc accepts these Excel compatibility prefixes and removes them
    // during formula parsing, after tokenization.
    const name = token.Ident.toUpperCase().replace(/^_XLFN\.(?:_XLWS\.)?/, '');
    if (volatileFunctions.has(name)) return name;
  }
}

/** Rename through temporary names to avoid collisions with default SheetN names. */
function configureSheets(model: Model, names: string[]) {
  while (model.getWorksheetsProperties().length < names.length)
    model.newSheet();
  const reserved = new Set(names.map((name) => name.toLowerCase()));
  let prefix = '__macro_tmp_';
  while (names.some((_, index) => reserved.has(`${prefix}${index}`)))
    prefix += '_';
  for (let index = 0; index < names.length; index++)
    model.renameSheet(index, `${prefix}${index}`);
  for (let index = 0; index < names.length; index++)
    model.renameSheet(index, names[index]);
}

/** Fifteen significant digits, as Excel keeps. IronCalc truncates a sixteenth
 * digit instead of rounding it, which read 979 as 978.999999999999. */
const SCIENTIFIC_FORMAT = '0.##############E+00';
/** Output of SCIENTIFIC_FORMAT; other numeric displays carry an engine format. */
const scientificDisplay = /^-?\d(?:\.\d*)?E[+-]\d+$/;
const constantDefinition =
  /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|TRUE|FALSE|"(?:[^"\r\n]|"")*")$/i;

type DefinedNames = {
  /** `${sheet index | 'global'}:${lowercase name}` */
  keys: Set<string>;
  constants: Map<string, string>;
  /** Definitions IronCalc cannot register, expanded wherever they are used. */
  formulas: Map<string, string>;
  invalid: Set<string>;
  definitions: Map<string, string>;
};

/** Longest formula text that name expansion may produce. */
const MAX_EXPANDED_FORMULA = 32_768;

function hasRelativeReference(formula: string) {
  return getTokens(formula).some(({ token }) => {
    if (typeof token !== 'object') return false;
    if ('Reference' in token)
      return !token.Reference.absolute_row || !token.Reference.absolute_column;
    if (!('Range' in token)) return false;
    const { left, right } = token.Range;
    return [left, right].some(
      (bound) => !bound.absolute_row || !bound.absolute_column
    );
  });
}

function legalTokens(formula: string) {
  return getTokens(formula).every(
    ({ token }) =>
      token !== 'Illegal' && !(typeof token === 'object' && 'Illegal' in token)
  );
}

function defineNames(model: Model, sheets: CalculationSheet[]): DefinedNames {
  const names: DefinedNames = {
    keys: new Set(),
    constants: new Map(),
    formulas: new Map(),
    invalid: new Set(),
    definitions: new Map(),
  };
  for (const [sheetIndex, sheet] of sheets.entries()) {
    for (const entry of sheet.metadata?.definedNames ?? []) {
      const key = `${entry.local ? sheetIndex : 'global'}:${entry.name.toLowerCase()}`;
      if (names.keys.has(key))
        throw new Error(`Duplicate Excel name: ${entry.name}`);
      names.keys.add(key);
      const formula = entry.formula.replace(/^=/, '');
      names.definitions.set(key, formula);
      // IronCalc's named-range API only accepts references. Named constants
      // remain authoritative definitions; substitute tokens for calculation.
      if (constantDefinition.test(formula)) names.constants.set(key, formula);
      // IronCalc would pin relative references to the cells they name from A1.
      else if (hasRelativeReference(formula)) names.formulas.set(key, formula);
      else {
        try {
          model.newDefinedName(
            entry.name,
            entry.local ? sheetIndex : undefined,
            formula
          );
        } catch {
          // Excel keeps names whose references were deleted as #REF!.
          if (legalTokens(formula)) names.formulas.set(key, formula);
          else if (formula.includes('#REF!')) names.constants.set(key, '#REF!');
          else names.invalid.add(key);
        }
      }
    }
  }
  return names;
}

/** Tokens omit `sheet` for unqualified references. */
function quotedSheetPrefix(sheet: string | null | undefined) {
  return sheet ? `'${sheet.replaceAll("'", "''")}'!` : '';
}

type EngineReference = {
  row: number;
  column: number;
  absolute_row: boolean;
  absolute_column: boolean;
};

/**
 * Excel stores a name's relative references as offsets from A1, so the same
 * name refers to different cells from each formula. Shift them to the cell
 * using the name, wrapping at the sheet edges as Excel does.
 */
function shiftDefinition(definition: string, row: number, column: number) {
  if (!row && !column) return definition;
  const shift = (reference: EngineReference) => ({
    ...reference,
    row: reference.absolute_row
      ? reference.row
      : ((reference.row - 1 + row) % ENGINE_COLUMN_HEIGHT) + 1,
    column: reference.absolute_column
      ? reference.column
      : ((reference.column - 1 + column) % ENGINE_COLUMNS) + 1,
  });
  const cell = (reference: EngineReference) =>
    `${reference.absolute_column ? '$' : ''}${columnLabel(reference.column)}${reference.absolute_row ? '$' : ''}${reference.row}`;
  const characters = Array.from(definition);
  let changed = false;
  const tokens = getTokens(definition);
  for (let index = tokens.length - 1; index >= 0; index--) {
    const { token, start, end } = tokens[index];
    if (typeof token !== 'object') continue;
    let text: string | undefined;
    if ('Reference' in token) {
      const reference = token.Reference;
      if (reference.absolute_row && reference.absolute_column) continue;
      text = `${quotedSheetPrefix(reference.sheet)}${cell(shift(reference))}`;
    } else if ('Range' in token) {
      const { sheet, left, right } = token.Range;
      if (
        left.absolute_row &&
        left.absolute_column &&
        right.absolute_row &&
        right.absolute_column
      )
        continue;
      const [first, last] = [shift(left), shift(right)];
      const rows = left.column === 1 && right.column === ENGINE_COLUMNS;
      const columns = left.row === 1 && right.row === ENGINE_COLUMN_HEIGHT;
      const bound = (reference: EngineReference) =>
        rows
          ? `${reference.absolute_row ? '$' : ''}${reference.row}`
          : columns
            ? `${reference.absolute_column ? '$' : ''}${columnLabel(reference.column)}`
            : cell(reference);
      text = `${quotedSheetPrefix(sheet)}${bound(first)}:${bound(last)}`;
    }
    if (text === undefined) continue;
    const leading = characters.slice(start, end).join('').match(/^\s*/)?.[0];
    characters.splice(start, end - start, ...Array.from(`${leading}${text}`));
    changed = true;
  }
  return changed ? characters.join('') : definition;
}

function columnLabel(column: number) {
  return formatCellAddress(0, column - 1).replace(/\d+$/, '');
}

/**
 * IronCalc has no HYPERLINK. Its result is the text Excel shows: the friendly
 * name, or the link location when there is none.
 */
function hyperlinkText(formula: string) {
  let text = formula;
  // One call per pass, last first, so nested calls see current positions.
  for (let pass = 0; pass < 20 && /HYPERLINK\s*\(/i.test(text); pass++) {
    const tokens = getTokens(text);
    const index = tokens.findLastIndex(
      ({ token }, at) =>
        typeof token === 'object' &&
        'Ident' in token &&
        token.Ident.toUpperCase().replace(/^_XLFN\./, '') === 'HYPERLINK' &&
        tokens[at + 1]?.token === 'LeftParenthesis'
    );
    if (index < 0) break;
    // Split the call's top-level arguments.
    const commas: number[] = [];
    let depth = 0;
    let close = -1;
    for (let at = index + 1; at < tokens.length && close < 0; at++) {
      const current = tokens[at].token;
      if (current === 'LeftParenthesis' || current === 'LeftBrace') depth++;
      else if (current === 'RightParenthesis' || current === 'RightBrace') {
        if (--depth === 0) close = at;
      } else if (current === 'Comma' && depth === 1) commas.push(at);
    }
    if (close < 0 || commas.length > 1) break;
    const characters = Array.from(text);
    const from = commas.length ? tokens[commas[0]].end : tokens[index + 1].end;
    const argument = characters.slice(from, tokens[close].start).join('');
    characters.splice(
      tokens[index].start,
      tokens[close].end - tokens[index].start,
      `(${argument})`
    );
    text = characters.join('');
  }
  return text;
}

/** Arguments that IronCalc reads cell by cell, including every empty row of
 * a whole column, where empty rows cannot change the result. -1 is any. */
const SCANNED_ARGUMENTS: Record<string, number> = {
  VLOOKUP: 1,
  MATCH: 1,
  COUNTA: -1,
};
const scannedLookup = /(?:VLOOKUP|MATCH|COUNTA)\s*\(/i;

/**
 * Whole-column lookup tables such as `VLOOKUP(x,Data!A:D,2,FALSE)` make
 * IronCalc scan all 1,048,576 rows for every lookup, and approximate MATCH
 * returns the last row. Rows past a sheet's grid are always empty, so look
 * up within the grid instead.
 */
function boundWholeColumnLookups(
  formula: string,
  sheetName: string,
  rowCounts: Map<string, number>
) {
  if (!formula.includes(':') || !scannedLookup.test(formula)) return formula;
  const tokens = getTokens(formula);
  const characters = Array.from(formula);
  const frames: { name?: string; argument: number }[] = [];
  const replacements: { start: number; end: number; text: string }[] = [];
  let braces = 0;
  for (const [index, { token, start, end }] of tokens.entries()) {
    if (token === 'LeftBrace') braces++;
    else if (token === 'RightBrace') braces--;
    else if (token === 'LeftParenthesis') {
      const previous = tokens[index - 1]?.token;
      frames.push({
        argument: 0,
        ...(typeof previous === 'object' &&
          'Ident' in previous && { name: previous.Ident.toUpperCase() }),
      });
    } else if (token === 'RightParenthesis') frames.pop();
    else if (token === 'Comma' && !braces && frames.length)
      frames[frames.length - 1].argument++;
    else if (typeof token === 'object' && 'Range' in token) {
      const { sheet, left, right } = token.Range;
      const frame = frames.at(-1);
      const scanned =
        frame?.name && SCANNED_ARGUMENTS[frame.name.replace(/^_XLFN\./, '')];
      if (
        left.row !== 1 ||
        right.row !== ENGINE_COLUMN_HEIGHT ||
        scanned === undefined ||
        (scanned !== -1 && scanned !== frame?.argument)
      )
        continue;
      const rows = rowCounts.get((sheet || sheetName).toLowerCase());
      if (!rows) continue;
      const leading = characters.slice(start, end).join('').match(/^\s*/)?.[0];
      replacements.push({
        start,
        end,
        text: `${leading}${quotedSheetPrefix(sheet)}${left.absolute_column ? '$' : ''}${columnLabel(left.column)}$1:${right.absolute_column ? '$' : ''}${columnLabel(right.column)}$${rows}`,
      });
    }
  }
  for (const { start, end, text } of replacements.reverse())
    characters.splice(start, end - start, text);
  return replacements.length ? characters.join('') : formula;
}

/**
 * IronCalc returns #VALUE! for `@` on a range in another sheet. Read the cell
 * in the formula's row or column through INDEX instead, which is what
 * Excel's implicit intersection returns.
 */
function crossSheetIntersections(formula: string, sheetName: string) {
  if (!formula.includes('@')) return formula;
  const tokens = getTokens(formula);
  const characters = Array.from(formula);
  let changed = false;
  for (let index = tokens.length - 1; index > 0; index--) {
    const { token, end } = tokens[index];
    const at = tokens[index - 1];
    // The published token type predates the `@` operator.
    if ((at.token as unknown) !== 'At' || typeof token !== 'object') continue;
    if (
      'Reference' in token &&
      token.Reference.sheet &&
      token.Reference.sheet.toLowerCase() !== sheetName.toLowerCase()
    ) {
      // One cell intersects to itself.
      characters.splice(at.start, at.end - at.start);
      changed = true;
      continue;
    }
    if (
      !('Range' in token) ||
      !token.Range.sheet ||
      token.Range.sheet.toLowerCase() === sheetName.toLowerCase()
    )
      continue;
    const { sheet, left, right } = token.Range;
    const range = `${quotedSheetPrefix(sheet)}$${columnLabel(left.column)}$${left.row}:$${columnLabel(right.column)}$${right.row}`;
    const row = `ROW()-${left.row - 1}`;
    const column = `COLUMN()-${left.column - 1}`;
    const guards = [
      ...(left.row > 1 && left.row !== right.row ? [`ROW()<${left.row}`] : []),
      ...(left.column > 1 && left.column !== right.column
        ? [`COLUMN()<${left.column}`]
        : []),
    ];
    const read =
      left.column === right.column
        ? `INDEX(${range},${row})`
        : left.row === right.row
          ? `INDEX(${range},1,${column})`
          : `INDEX(${range},${row},${column})`;
    const text = guards.length
      ? `IF(OR(${guards.join(',')}),#VALUE!,${read})`
      : read;
    characters.splice(at.start, end - at.start, text);
    changed = true;
  }
  return changed ? characters.join('') : formula;
}

/** The engine input for a formula, with names IronCalc cannot read resolved. */
function resolveNames(
  value: string,
  sheetIndex: number,
  row: number,
  column: number,
  sheets: CalculationSheet[],
  names: DefinedNames,
  unsupported: (reason: string) => void
): string {
  if (!names.keys.size) return value;
  const expanding = new Set<string>();
  /** A local name's own sheet, or undefined for workbook-level definitions. */
  const lookup = (scope: number | undefined, name: string) => {
    const local = `${scope}:${name.toLowerCase()}`;
    return scope !== undefined && names.keys.has(local)
      ? local
      : `global:${name.toLowerCase()}`;
  };
  const replacement = (key: string, name: string): string | undefined => {
    if (names.invalid.has(key))
      unsupported(
        `The Excel name ${name} uses a definition this calculation engine does not support.`
      );
    const constant = names.constants.get(key);
    if (constant !== undefined) return `(${constant})`;
    const formula = names.formulas.get(key);
    if (formula === undefined) return;
    if (expanding.has(key)) {
      unsupported(`The Excel name ${name} refers to itself.`);
      return '(#REF!)';
    }
    expanding.add(key);
    const scope = key.startsWith('global:')
      ? undefined
      : Number(key.slice(0, key.indexOf(':')));
    const text = expand(shiftDefinition(formula, row, column), scope);
    expanding.delete(key);
    return `(${text})`;
  };
  const expand = (text: string, scope: number | undefined): string => {
    // Excel permits Sheet!LocalName, which IronCalc does not tokenize.
    // Skip double-quoted literals and resolve only known definitions;
    // ordinary sheet-qualified cell references stay unchanged.
    const qualified = !text.includes('!')
      ? text
      : text.replace(
          // A name never continues into a reference such as Sheet!B$23 or
          // Sheet!B:C, even when a workbook defines a name `B`.
          /"(?:[^"]|"")*"|'((?:[^']|'')+)'!([\p{L}_\\][\p{L}\p{N}_.\\]*)(?![$:(\p{L}\p{N}_.\\])|([\p{L}_\\][\p{L}\p{N}_.\\]*)!([\p{L}_\\][\p{L}\p{N}_.\\]*)(?![$:(\p{L}\p{N}_.\\])/gu,
          (
            match,
            quoted: string | undefined,
            quotedName: string | undefined,
            plain: string | undefined,
            plainName: string | undefined
          ) => {
            if (match.startsWith('"')) return match;
            const target = sheets.findIndex(
              (sheet) =>
                sheet.name.toLowerCase() ===
                (quoted?.replaceAll("''", "'") ?? plain ?? '').toLowerCase()
            );
            if (target < 0) return match;
            const name = quotedName ?? plainName ?? '';
            const key = lookup(target, name);
            const definition = names.definitions.get(key);
            if (definition === undefined) return match;
            return replacement(key, name) ?? `(${definition})`;
          }
        );
    if (!names.constants.size && !names.formulas.size && !names.invalid.size)
      return qualified;
    const characters = Array.from(qualified);
    const tokens = getTokens(qualified);
    for (let index = tokens.length - 1; index >= 0; index--) {
      const { token, start, end } = tokens[index];
      if (
        typeof token !== 'object' ||
        !('Ident' in token) ||
        tokens[index + 1]?.token === 'LeftParenthesis'
      )
        continue;
      const text = replacement(lookup(scope, token.Ident), token.Ident);
      if (text !== undefined) characters.splice(start, end - start, text);
    }
    return characters.join('');
  };
  const expanded = expand(value, sheetIndex);
  if (expanded.length > MAX_EXPANDED_FORMULA) {
    unsupported(
      'This formula uses Excel names whose definitions are too long to calculate.'
    );
    return '=NA()';
  }
  return expanded;
}

type EnteredSheet = {
  /** Every cell given to the engine. */
  entered: Map<string, { row: number; column: number }>;
  /** Formula cells, whose results any recalculation may change. */
  formulas: Map<string, { row: number; column: number }>;
  unsupported: Map<string, string>;
  /** Cells whose engine-inferred date or time format may decide their display. */
  inferable: Set<string>;
  /** Columns from A that carry the full-precision column style. */
  width: number;
  arrays: Map<string, { width: number; height: number }>;
  /** Each array formula's result cells beyond its anchor. */
  spills: Map<string, string[]>;
};

/** An engine model with every sheet entered, kept for incremental updates. */
type EngineWorkbook = {
  model: Model;
  sheets: CalculationSheet[];
  names: DefinedNames;
  rowCounts: Map<string, number>;
  entered: EnteredSheet[];
};

/** New cells inherit this column format, so full-precision results can be
 * read without restyling every populated cell after evaluation. */
function styleColumns(
  model: Model,
  sheetIndex: number,
  entered: EnteredSheet,
  width: number
) {
  if (width <= entered.width) return;
  model.updateRangeStyle(
    {
      sheet: sheetIndex,
      row: 1,
      column: entered.width + 1,
      width: width - entered.width,
      height: ENGINE_COLUMN_HEIGHT,
    },
    'num_fmt',
    SCIENTIFIC_FORMAT
  );
  entered.width = width;
}

/** Style a sheet's columns and order its cells for entry. */
function prepareSheet(
  model: Model,
  sheet: CalculationSheet,
  sheetIndex: number
) {
  const entered: EnteredSheet = {
    entered: new Map(),
    formulas: new Map(),
    unsupported: new Map(),
    inferable: new Set(),
    width: 0,
    arrays: new Map(),
    spills: new Map(),
  };
  const literals: { address: string; row: number; column: number }[] = [];
  const formulas: typeof literals = [];
  let width = 1;
  for (const [address, cell] of Object.entries(sheet.cells)) {
    if (cell.value === '') continue;
    const position = parseCellAddress(address);
    if (!position || position.row >= sheet.rowCount) continue;
    width = Math.max(width, position.column + 1);
    (cell.value.startsWith('=') && cell.format !== 'text'
      ? formulas
      : literals
    ).push({ address, ...position });
  }
  for (const [anchor, range] of Object.entries(
    sheet.metadata?.arrayFormulas ?? {}
  )) {
    const [first, last = first] = range.split(':').map(parseCellAddress);
    if (!first || !last) continue;
    entered.arrays.set(anchor, {
      width: last.column - first.column + 1,
      height: last.row - first.row + 1,
    });
    width = Math.max(width, last.column + 1);
  }
  styleColumns(model, sheetIndex, entered, width);
  // IronCalc infers a formula's date format from the cells it references when
  // the formula is entered, so plain values go first and formulas follow in
  // grid order, which chained schedules usually read in.
  formulas.sort((a, b) => a.row - b.row || a.column - b.column);
  return { entered, order: [...literals, ...formulas] };
}

/**
 * Give one cell's source to the engine. `replace` first clears what an
 * earlier entry left: its content and any format the engine inferred.
 */
function enterCell(
  workbook: EngineWorkbook,
  sheetIndex: number,
  address: string,
  row: number,
  column: number,
  replace = false
) {
  const { model, sheets, names, rowCounts } = workbook;
  const sheet = sheets[sheetIndex];
  const entered = workbook.entered[sheetIndex];
  const area = {
    sheet: sheetIndex,
    row: row + 1,
    column: column + 1,
    width: 1,
    height: 1,
  };
  if (replace) {
    entered.entered.delete(address);
    entered.formulas.delete(address);
    entered.unsupported.delete(address);
    entered.inferable.delete(address);
    model.rangeClearContents(
      sheetIndex,
      row + 1,
      column + 1,
      row + 1,
      column + 1
    );
    model.updateRangeStyle(area, 'num_fmt', SCIENTIFIC_FORMAT);
  }
  const cell = sheet.cells[address];
  if (!cell || cell.value === '' || row >= sheet.rowCount) return;
  const dateMention =
    cell.format === 'text' ? undefined : cellDateMention(cell.value);
  const value = dateMention
    ? String(dateMentionSerial(dateMention.date))
    : cellPlainText(cell.value);
  const literal =
    !dateMention && (cell.format === 'text' || value !== cell.value);
  if (value === '') return;
  entered.entered.set(address, { row, column });
  if (!literal && canInferFormat(cell, value, dateMention !== undefined))
    entered.inferable.add(address);
  const unsupported = (reason: string) => {
    entered.unsupported.set(address, reason);
  };
  const fn = literal ? undefined : unsupportedFunction(value);
  if (fn)
    unsupported(
      `${fn} is not supported yet because collaborators need the same calculation clock and random seed.`
    );
  let input = fn ? '=NA()' : literal ? `'${value}` : value;
  if (!fn && !literal && value.startsWith('=')) {
    entered.formulas.set(address, { row, column });
    input = resolveNames(
      value,
      sheetIndex,
      row,
      column,
      sheets,
      names,
      unsupported
    );
    // An expanded name may itself use a clock or random function.
    const expandedFn = input === value ? undefined : unsupportedFunction(input);
    if (expandedFn)
      unsupported(
        `${expandedFn} is not supported yet because collaborators need the same calculation clock and random seed.`
      );
    if (entered.unsupported.has(address)) input = '=NA()';
    else
      input = boundWholeColumnLookups(
        crossSheetIntersections(hyperlinkText(input), sheet.name),
        sheet.name,
        rowCounts
      );
  }
  const array = entered.arrays.get(address);
  let enteredArray = false;
  if (array && input.startsWith('=') && !entered.unsupported.has(address)) {
    try {
      model.setUserArrayFormula(
        sheetIndex,
        row + 1,
        column + 1,
        array.width,
        array.height,
        input
      );
      enteredArray = true;
    } catch {
      // A conflicting range calculates as a dynamic formula instead.
    }
  }
  if (!enteredArray) model.setUserInput(sheetIndex, row + 1, column + 1, input);
  // A date pill is a date value: formulas referencing it inherit the format.
  if (dateMention) model.updateRangeStyle(area, 'num_fmt', 'm/d/yyyy');
  // Typed exponents get a 3-digit scientific format that formulas would
  // inherit; numeric literals never need an inferred display format.
  else if (!literal && /e/i.test(value) && numericLiteral.test(value))
    model.updateRangeStyle(area, 'num_fmt', SCIENTIFIC_FORMAT);
}

/** One cell's current result, or undefined for an empty cell. */
function readCell(
  workbook: EngineWorkbook,
  sheetIndex: number,
  address: string,
  row: number,
  column: number,
  includeTypes: boolean
): CalculatedCell | undefined {
  const { model } = workbook;
  const entered = workbook.entered[sheetIndex];
  let display = model.getFormattedCellValue(sheetIndex, row + 1, column + 1);
  const cell = workbook.sheets[sheetIndex].cells[address] as
    | SpreadsheetCell
    | undefined;
  if (display === '')
    return cell?.value
      ? {
          display: '',
          ...(includeTypes && { type: 'text' as const, value: '' }),
        }
      : undefined;
  const cellType = model.getCellType(sheetIndex, row + 1, column + 1);
  if (cellType === 16)
    return {
      display,
      error:
        entered.unsupported.get(address) ??
        errorDescriptions[display] ??
        `Formula error: ${display}`,
      ...(includeTypes && { type: 'error' as const, value: null }),
    };
  if (cellType !== 1)
    return {
      display,
      ...(includeTypes && {
        type: cellType === 4 ? ('boolean' as const) : ('text' as const),
        value: cellType === 4 ? display.toUpperCase() === 'TRUE' : display,
      }),
    };
  let engineFormat: 'date' | 'time' | undefined;
  if (!scientificDisplay.test(display) || !Number.isFinite(Number(display))) {
    // The engine inferred a display format (a typed date, percentage or
    // currency, or a formula referencing one). Record it, read the
    // full-precision value, then restore it: formulas entered later infer
    // their own formats from it.
    const format = model.getCellStyle(sheetIndex, row + 1, column + 1).style
      .num_fmt;
    if (entered.inferable.has(address)) engineFormat = inferredFormat(format);
    const area = {
      sheet: sheetIndex,
      row: row + 1,
      column: column + 1,
      width: 1,
      height: 1,
    };
    model.updateRangeStyle(area, 'num_fmt', SCIENTIFIC_FORMAT);
    display = model.getFormattedCellValue(sheetIndex, row + 1, column + 1);
    model.updateRangeStyle(area, 'num_fmt', format);
  }
  const number = Number(display);
  // IronCalc also formats a difference of two dates as a date, so
  // formula results only count as dates from 2000 onwards; a day
  // count or a negative number stays a plain number.
  const dateLike =
    engineFormat !== 'date' ||
    !cell?.value.startsWith('=') ||
    number >= MIN_FORMULA_DATE_SERIAL;
  let formatted = displayNumber(
    number,
    engineFormat && dateLike ? { ...cell!, format: engineFormat } : cell
  );
  let warning: string | undefined;
  if (cell?.numberFormat) {
    try {
      formatted = formatExcelNumber(cell.numberFormat, number);
    } catch {
      warning =
        'This Excel number format cannot be displayed in Macro. Its value and original format are retained for export.';
    }
  }
  return {
    display: formatted,
    ...(warning && { warning }),
    number,
    ...(includeTypes && { type: 'number' as const, value: number }),
  };
}

/** Write or remove one result. */
type ResultWriter = (
  address: string,
  value: CalculatedCell | undefined
) => void;

/** Read array results, which have no persisted source cell beyond their
 * anchor, replacing the cells each anchor spilled into before. */
function readSpills(
  workbook: EngineWorkbook,
  sheetIndex: number,
  results: SpreadsheetCalculation,
  write: ResultWriter,
  includeTypes: boolean
) {
  const { model } = workbook;
  const sheet = workbook.sheets[sheetIndex];
  const entered = workbook.entered[sheetIndex];
  for (const children of entered.spills.values())
    for (const address of children)
      if (!entered.entered.has(address)) write(address, undefined);
  entered.spills.clear();
  for (const [anchorAddress, { row, column }] of entered.formulas) {
    const structure = model.getCellArrayStructure(
      sheetIndex,
      row + 1,
      column + 1
    );
    if (typeof structure !== 'object') continue;
    const size =
      'DynamicAnchor' in structure
        ? structure.DynamicAnchor
        : 'ArrayAnchor' in structure
          ? structure.ArrayAnchor
          : undefined;
    if (!size) continue;
    const [width, height] = size;
    const anchor = results[anchorAddress];
    if (anchor && (width > 1 || height > 1))
      write(anchorAddress, {
        ...anchor,
        spill: { rows: height, columns: width },
      });
    const children: string[] = [];
    for (let r = row; r < Math.min(sheet.rowCount, row + height); r++)
      for (let c = column; c < column + width; c++) {
        if (r === row && c === column) continue;
        const address = formatCellAddress(r, c);
        if (entered.entered.has(address)) continue;
        children.push(address);
        write(
          address,
          readCell(workbook, sheetIndex, address, r, c, includeTypes)
        );
      }
    if (children.length) entered.spills.set(anchorAddress, children);
  }
}

function buildWorkbook(sheets: CalculationSheet[]): EngineWorkbook {
  const model = new Model('Macro spreadsheet', 'en', 'UTC', 'en');
  try {
    const bounded = sheets.map((sheet) => ({
      ...sheet,
      rowCount: Math.min(
        SPREADSHEET_MAX_ROWS,
        Math.max(SPREADSHEET_ROWS, sheet.rowCount)
      ),
    }));
    model.pauseEvaluation();
    configureSheets(
      model,
      bounded.map((sheet) => sheet.name)
    );
    const workbook: EngineWorkbook = {
      model,
      sheets: bounded,
      names: defineNames(model, bounded),
      rowCounts: new Map(
        bounded.map((sheet) => [sheet.name.toLowerCase(), sheet.rowCount])
      ),
      entered: [],
    };
    for (const [sheetIndex, sheet] of bounded.entries()) {
      const { entered, order } = prepareSheet(model, sheet, sheetIndex);
      workbook.entered.push(entered);
      for (const { address, row, column } of order)
        enterCell(workbook, sheetIndex, address, row, column);
    }
    model.resumeEvaluation();
    model.evaluate();
    return workbook;
  } catch (error) {
    freeModel(model);
    throw error;
  }
}

function writer(results: SpreadsheetCalculation): ResultWriter {
  return (address, value) => {
    if (value) results[address] = value;
    else delete results[address];
  };
}

function readWorkbook(
  workbook: EngineWorkbook,
  includeTypes: boolean
): WorkbookCalculation {
  const results: WorkbookCalculation = {};
  for (const [sheetIndex, sheet] of workbook.sheets.entries()) {
    const values: SpreadsheetCalculation = {};
    const write = writer(values);
    for (const [address, { row, column }] of workbook.entered[sheetIndex]
      .entered)
      write(
        address,
        readCell(workbook, sheetIndex, address, row, column, includeTypes)
      );
    readSpills(workbook, sheetIndex, values, write, includeTypes);
    results[sheet.id] = values;
  }
  return results;
}

function sameCalculatedCell(left: CalculatedCell, right: CalculatedCell) {
  return (
    left.display === right.display &&
    left.number === right.number &&
    left.error === right.error &&
    left.warning === right.warning &&
    left.type === right.type &&
    left.value === right.value &&
    left.spill?.rows === right.spill?.rows &&
    left.spill?.columns === right.spill?.columns
  );
}

/** A workbook calculation that keeps its engine model, so an edit enters
 * only the changed cells instead of rebuilding a large workbook. */
export type WorkbookCalculationSession = {
  /** Calculate a whole workbook, replacing any loaded one. The returned
   * results stay current: updates change them in place. */
  load: (
    sheets: CalculationSheet[],
    options?: { includeTypes?: boolean }
  ) => WorkbookCalculation;
  /**
   * Apply changed cells (null clears a cell) to the loaded workbook,
   * recalculate, and return the results that changed (null for removed
   * ones). Sheets, names, row counts and array formulas must be unchanged
   * since `load`; after a failure, load the workbook again.
   */
  update: (
    changes: Record<string, Record<string, SpreadsheetCell | null>>,
    options?: { includeTypes?: boolean }
  ) => Record<string, Record<string, CalculatedCell | null>>;
  dispose: () => void;
};

function createWorkbookCalculationSession(): WorkbookCalculationSession {
  let workbook: EngineWorkbook | undefined;
  let results: WorkbookCalculation = {};
  const dispose = () => {
    if (workbook) freeModel(workbook.model);
    workbook = undefined;
    results = {};
  };
  return {
    load(sheets, options) {
      dispose();
      // Own the cell maps: updates change them in place.
      workbook = buildWorkbook(
        sheets.map((sheet) => ({ ...sheet, cells: { ...sheet.cells } }))
      );
      results = readWorkbook(workbook, options?.includeTypes ?? false);
      return results;
    },
    update(changes, options) {
      if (!workbook) throw new Error('No workbook is loaded.');
      const current = workbook;
      const includeTypes = options?.includeTypes ?? false;
      try {
        const literals: [number, string, number, number][] = [];
        const formulas: typeof literals = [];
        current.model.pauseEvaluation();
        for (const [id, cells] of Object.entries(changes)) {
          const sheetIndex = current.sheets.findIndex(
            (sheet) => sheet.id === id
          );
          if (sheetIndex < 0) throw new Error(`Unknown sheet ${id}.`);
          const sheet = current.sheets[sheetIndex];
          for (const [address, cell] of Object.entries(cells)) {
            const position = parseCellAddress(address);
            if (!position) continue;
            if (cell) sheet.cells[address] = cell;
            else delete sheet.cells[address];
            styleColumns(
              current.model,
              sheetIndex,
              current.entered[sheetIndex],
              position.column + 1
            );
            (cell?.value.startsWith('=') && cell.format !== 'text'
              ? formulas
              : literals
            ).push([sheetIndex, address, position.row, position.column]);
          }
        }
        formulas.sort((a, b) => a[2] - b[2] || a[3] - b[3]);
        for (const [sheetIndex, address, row, column] of [
          ...literals,
          ...formulas,
        ])
          enterCell(current, sheetIndex, address, row, column, true);
        current.model.resumeEvaluation();
        current.model.evaluate();
        const delta: Record<string, Record<string, CalculatedCell | null>> = {};
        for (const [sheetIndex, sheet] of current.sheets.entries()) {
          results[sheet.id] ??= {};
          const values = results[sheet.id];
          const before = new Map<string, CalculatedCell | undefined>();
          const write: ResultWriter = (address, value) => {
            if (!before.has(address)) before.set(address, values[address]);
            if (value) values[address] = value;
            else delete values[address];
          };
          const read = (address: string, row: number, column: number) =>
            write(
              address,
              readCell(current, sheetIndex, address, row, column, includeTypes)
            );
          // Literal results depend only on their own source; recalculation
          // can change any formula and array result.
          const entered = current.entered[sheetIndex];
          for (const address of Object.keys(changes[sheet.id] ?? {})) {
            const position = entered.entered.get(address);
            if (position) read(address, position.row, position.column);
            else write(address, undefined);
          }
          for (const [address, { row, column }] of entered.formulas)
            read(address, row, column);
          readSpills(current, sheetIndex, values, write, includeTypes);
          const changed: Record<string, CalculatedCell | null> = {};
          for (const [address, old] of before) {
            const now = values[address];
            if (!now) {
              if (old) changed[address] = null;
            } else if (!old || !sameCalculatedCell(old, now))
              changed[address] = now;
          }
          if (Object.keys(changed).length) delta[sheet.id] = changed;
        }
        return delta;
      } catch (error) {
        dispose();
        throw error;
      }
    },
    dispose,
  };
}

/** A failed engine call can leave the model borrowed; never let releasing it
 * replace the original error. */
function freeModel(model: Model) {
  try {
    model.free();
  } catch {
    // The original failure is already propagating.
  }
}

/**
 * Load the calculation engine only when a spreadsheet mounts. Source text is
 * authoritative; results are derived locally and never written to the CRDT.
 */
export function createInitializedSpreadsheetCalculator(): SpreadsheetCalculator {
  let disposed = false;

  function calculateWorkbook(
    sheets: CalculationSheet[],
    options?: { includeTypes?: boolean }
  ): WorkbookCalculation {
    if (disposed) throw new Error('The spreadsheet calculator is disposed.');
    // Rebuild from authoritative input so deletion and remote edit order
    // cannot leave stale engine state. All sheets share one dependency graph.
    const workbook = buildWorkbook(sheets);
    try {
      return readWorkbook(workbook, options?.includeTypes ?? false);
    } finally {
      freeModel(workbook.model);
    }
  }

  return {
    changeAxis: changeWorkbookAxis,
    session() {
      if (disposed) throw new Error('The spreadsheet calculator is disposed.');
      return createWorkbookCalculationSession();
    },
    complete(text, cursor, context) {
      if (disposed) throw new Error('The spreadsheet calculator is disposed.');
      const model = new Model('Formula help', 'en', 'UTC', 'en');
      try {
        if (context) configureSheets(model, context.sheetNames);
        return model.getFormulaCompletion(
          context?.activeSheet ?? 0,
          1,
          1,
          text,
          Array.from(text.slice(0, cursor)).length
        );
      } finally {
        model.free();
      }
    },
    calculate(cells, rowCount = SPREADSHEET_ROWS) {
      return calculateWorkbook([
        { id: 'sheet1', name: 'Sheet1', cells, rowCount },
      ]).sheet1;
    },
    calculateWorkbook,
    copy(copies, context) {
      if (disposed) throw new Error('The spreadsheet calculator is disposed.');
      const model = new Model('Macro copy', 'en', 'UTC', 'en');
      const edits: SpreadsheetCellEdits = {};
      const sheet = context?.activeSheet ?? 0;
      try {
        model.pauseEvaluation();
        if (context) configureSheets(model, context.sheetNames);
        model.setSelectedSheet(sheet);
        for (const { from, to, cell } of copies) {
          let value = cell.value;
          if (value.startsWith('=') && cell.format !== 'text') {
            // Use IronCalc's parser and displacement rules, including mixed
            // references, quoted strings, ranges, and sheet-qualified names.
            model.setUserInput(sheet, from.row + 1, from.column + 1, value);
            model.setSelectedCell(from.row + 1, from.column + 1);
            const clipboard = model.copyToClipboard();
            model.setSelectedCell(to.row + 1, to.column + 1);
            model.pasteFromClipboard(
              sheet,
              clipboard.range,
              clipboard.data,
              false
            );
            value = model.getCellContent(sheet, to.row + 1, to.column + 1);
          }
          edits[formatCellAddress(to.row, to.column)] = {
            ...SPREADSHEET_DEFAULT_STYLE,
            ...cell,
            value,
          };
        }
        return edits;
      } finally {
        model.free();
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
