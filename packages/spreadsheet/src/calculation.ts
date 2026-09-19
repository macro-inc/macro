import { type CompletionContext, getTokens, Model } from '@ironcalc/wasm';
import { format as formatExcelNumber } from 'ssf';
import { cellPlainText } from './cell-mentions';
import {
  formatCellAddress,
  parseCellAddress,
  SPREADSHEET_COLUMNS,
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
  dispose: () => void;
};

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
// IronCalc treats this exact extent as a column style, without materializing
// a style cell for every empty row. The editable grid is still bounded to 1,000.
const ENGINE_COLUMN_HEIGHT = 1_048_576;

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
  if (!value.startsWith('=')) return;
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
    const model = new Model('Macro spreadsheet', 'en', 'UTC', 'en');
    const workbook: WorkbookCalculation = {};
    const unsupportedBySheet: Record<string, Record<string, string>> = {};
    const bounded = sheets.map((sheet) => ({
      ...sheet,
      rowCount: Math.min(
        SPREADSHEET_MAX_ROWS,
        Math.max(SPREADSHEET_ROWS, sheet.rowCount)
      ),
    }));
    try {
      model.pauseEvaluation();
      configureSheets(
        model,
        bounded.map((sheet) => sheet.name)
      );
      const definedNames = new Set<string>();
      const constants = new Map<string, string>();
      const invalidNames = new Set<string>();
      const definitions = new Map<string, string>();
      for (const [sheetIndex, sheet] of bounded.entries()) {
        for (const entry of sheet.metadata?.definedNames ?? []) {
          const key = `${entry.local ? sheetIndex : 'global'}:${entry.name.toLowerCase()}`;
          if (definedNames.has(key))
            throw new Error(`Duplicate Excel name: ${entry.name}`);
          definedNames.add(key);
          const formula = entry.formula.replace(/^=/, '');
          definitions.set(key, formula);
          // IronCalc's named-range API only accepts references. Named constants
          // remain authoritative definitions; substitute tokens for calculation.
          if (
            /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|TRUE|FALSE|"(?:[^"\r\n]|"")*")$/i.test(
              formula
            )
          )
            constants.set(key, formula);
          else {
            try {
              model.newDefinedName(
                entry.name,
                entry.local ? sheetIndex : undefined,
                formula
              );
            } catch {
              invalidNames.add(key);
            }
          }
        }
      }
      for (const [sheetIndex, { id, cells, rowCount }] of bounded.entries()) {
        const unsupported: Record<string, string> = {};
        unsupportedBySheet[id] = unsupported;
        for (const address of Object.keys(cells).sort()) {
          const position = parseCellAddress(address);
          const cell = cells[address];
          const value = cellPlainText(cell.value);
          const literal = cell.format === 'text' || value !== cell.value;
          if (!position || position.row >= rowCount || value === '') continue;
          const fn = literal ? undefined : unsupportedFunction(value);
          if (fn) {
            unsupported[address] =
              `${fn} is not supported yet because collaborators need the same calculation clock and random seed.`;
          }
          let input = fn ? '=NA()' : literal ? `'${value}` : value;
          if (!fn && !literal && value.startsWith('=')) {
            // Excel permits Sheet!LocalName, which IronCalc does not tokenize.
            // Skip double-quoted literals and resolve only known definitions;
            // ordinary sheet-qualified cell references stay unchanged.
            const qualified = value.replace(
              /"(?:[^"]|"")*"|'((?:[^']|'')+)'!([\p{L}_\\][\p{L}\p{N}_.\\]*)|([\p{L}_\\][\p{L}\p{N}_.\\]*)!([\p{L}_\\][\p{L}\p{N}_.\\]*)/gu,
              (
                match,
                quoted: string | undefined,
                quotedName: string | undefined,
                plain: string | undefined,
                plainName: string | undefined
              ) => {
                if (match.startsWith('"')) return match;
                const target = bounded.findIndex(
                  (sheet) =>
                    sheet.name.toLowerCase() ===
                    (quoted?.replaceAll("''", "'") ?? plain ?? '').toLowerCase()
                );
                if (target < 0) return match;
                const name = (quotedName ?? plainName ?? '').toLowerCase();
                const local = `${target}:${name}`;
                const key = definedNames.has(local) ? local : `global:${name}`;
                if (invalidNames.has(key))
                  unsupported[address] =
                    `The Excel name ${name} uses a definition this calculation engine does not support.`;
                const definition = definitions.get(key);
                return definition === undefined ? match : `(${definition})`;
              }
            );
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
              const name = token.Ident.toLowerCase();
              const localKey = `${sheetIndex}:${name}`;
              const key = definedNames.has(localKey)
                ? localKey
                : `global:${name}`;
              if (invalidNames.has(key))
                unsupported[address] =
                  `The Excel name ${token.Ident} uses a definition this calculation engine does not support.`;
              const constant = constants.get(key);
              if (constant !== undefined)
                characters.splice(start, end - start, `(${constant})`);
            }
            input = unsupported[address] ? '=NA()' : characters.join('');
          }
          model.setUserInput(
            sheetIndex,
            position.row + 1,
            position.column + 1,
            input
          );
        }
        // The WASM binding exposes numeric values through its formatter. Read
        // sufficient significant digits in a fixed locale, before display
        // formatting, so sums and percentages do not use rounded UI strings.
        model.updateRangeStyle(
          {
            sheet: sheetIndex,
            row: 1,
            column: 1,
            width: SPREADSHEET_COLUMNS,
            height: ENGINE_COLUMN_HEIGHT,
          },
          'num_fmt',
          '0.###############E+00'
        );
      }
      model.resumeEvaluation();
      model.evaluate();
      for (const [sheetIndex, { id, cells, rowCount }] of bounded.entries()) {
        const unsupported = unsupportedBySheet[id];
        const results: SpreadsheetCalculation = {};
        // Include array spill results, which have no persisted source cell.
        for (let row = 0; row < rowCount; row++) {
          for (let column = 0; column < SPREADSHEET_COLUMNS; column++) {
            const display = model.getFormattedCellValue(
              sheetIndex,
              row + 1,
              column + 1
            );
            const address = formatCellAddress(row, column);
            if (display === '') {
              if (cells[address]?.value)
                results[address] = {
                  display: '',
                  ...(options?.includeTypes && {
                    type: 'text' as const,
                    value: '',
                  }),
                };
              continue;
            }
            const cellType = model.getCellType(sheetIndex, row + 1, column + 1);
            if (cellType === 16) {
              results[address] = {
                display,
                error:
                  unsupported[address] ??
                  errorDescriptions[display] ??
                  `Formula error: ${display}`,
                ...(options?.includeTypes && {
                  type: 'error' as const,
                  value: null,
                }),
              };
            } else if (cellType === 1) {
              const number = Number(display);
              const customFormat = cells[address]?.numberFormat;

              let formatted = displayNumber(number, cells[address]);
              let warning: string | undefined;
              if (customFormat) {
                try {
                  formatted = formatExcelNumber(customFormat, number);
                } catch {
                  warning =
                    'This Excel number format cannot be displayed in Macro. Its value and original format are retained for export.';
                }
              }
              results[address] = {
                display: formatted,
                ...(warning && { warning }),
                number,
                ...(options?.includeTypes && {
                  type: 'number' as const,
                  value: number,
                }),
              };
            } else {
              results[address] = {
                display,
                ...(options?.includeTypes && {
                  type:
                    cellType === 4 ? ('boolean' as const) : ('text' as const),
                  value:
                    cellType === 4 ? display.toUpperCase() === 'TRUE' : display,
                }),
              };
            }
          }
        }
        workbook[id] = results;
      }
      return workbook;
    } finally {
      model.free();
    }
  }

  return {
    changeAxis: changeWorkbookAxis,
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
