import type { WorkbookSheetMetadata } from '@macro-inc/spreadsheet/workbook-metadata';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import {
  DEFAULT_COLUMN_WIDTH,
  formatCellAddress,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseCellAddress,
  SPREADSHEET_COLUMNS,
  SPREADSHEET_MAX_CELL_LENGTH,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
  SPREADSHEET_ROWS,
  type SpreadsheetCell,
  type SpreadsheetCellStyle,
  type SpreadsheetCells,
} from './spreadsheet-document';
import {
  type WorkbookFileData,
  type WorkbookFileSheet,
  XLSX_MAX_CELLS,
  XLSX_MAX_SHEETS,
} from './workbook-file-types';
import type { XlsxArchive } from './xlsx-archive';
import {
  expandSheetRanges,
  formulaFunctionNames,
  hasExternalReference,
  importSingleFunction,
  markImplicitIntersections,
  normalizeReferences,
  resolveStructuredReferences,
  stripFunctionPrefixes,
  translateFormula,
  type WorkbookTable,
} from './xlsx-formula';
import {
  readXlsxStylesheet,
  readXlsxTheme,
  type XlsxStylesheet,
} from './xlsx-stylesheet';

const MAIN_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  // Some generators omit the namespace entirely.
  '',
  // ISO/IEC 29500 Strict uses different URIs for the same vocabulary.
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
]);
const EXCEL_MAX_ROWS = 1_048_576;
/** A sheet-qualified range, capturing its two corners. */
const MULTI_CELL_REFERENCE =
  /^(?:'(?:[^']|'')+'|[^'!:]+)!(\$?[A-Z]{0,3}\$?\d*):(\$?[A-Z]{0,3}\$?\d*)$/i;
const KNOWN_ERRORS = new Set([
  '#DIV/0!',
  '#N/A',
  '#NAME?',
  '#NULL!',
  '#NUM!',
  '#REF!',
  '#VALUE!',
]);
/** Functions that return dynamic arrays when an older writer omits metadata. */
const SPILL_FUNCTIONS = new Set([
  'CHOOSECOLS',
  'CHOOSEROWS',
  'DROP',
  'EXPAND',
  'FILTER',
  'HSTACK',
  'SEQUENCE',
  'SORT',
  'SORTBY',
  'TAKE',
  'TOCOL',
  'TOROW',
  'UNIQUE',
  'VSTACK',
  'WRAPCOLS',
  'WRAPROWS',
]);

type Attributes = Record<string, string>;
function attributes(node: SaxesTagNS): Attributes {
  const result: Attributes = {};
  for (const attribute of Object.values(node.attributes))
    result[attribute.local] = attribute.value;
  return result;
}

/** Feed UTF-8 bytes to a parser in chunks so huge sheets never become one string. */
function parse(
  bytes: Uint8Array,
  name: string,
  setup: (parser: SaxesParser<{ xmlns: true }>) => void
) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    throw new Error(`Unsupported XML document type in ${name}.`);
  });
  parser.on('error', () => {
    throw new Error(`Invalid XML in ${name}.`);
  });
  setup(parser);
  // Some writers leave optional parts (styles, shared strings) empty.
  if (!bytes.some((byte) => byte > 32)) return;
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false });
  const chunk = 1 << 20;
  for (let offset = 0; offset < bytes.length; offset += chunk)
    parser.write(
      decoder.decode(bytes.subarray(offset, offset + chunk), { stream: true })
    );
  parser.write(decoder.decode());
  parser.close();
}

/** OOXML escapes control characters in text as `_xHHHH_`. */
function unescapeText(text: string) {
  return text.includes('_x')
    ? text.replace(/_x([0-9a-f]{4})_/gi, (_, code: string) =>
        String.fromCharCode(Number.parseInt(code, 16))
      )
    : text;
}

/** Resolve a relationship target relative to its source part. */
function resolvePath(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function relationships(archive: XlsxArchive, part: string) {
  const path = resolvePath(part, `_rels/${part.split('/').at(-1)}.rels`);
  const bytes = archive.read(path);
  const result = new Map<
    string,
    { target: string; type: string; external: boolean }
  >();
  if (!bytes) return result;
  parse(bytes, path, (parser) => {
    parser.on('opentag', (node) => {
      if (node.local !== 'Relationship') return;
      const value = attributes(node);
      const external = value.TargetMode === 'External';
      result.set(value.Id, {
        target: external ? value.Target : resolvePath(part, value.Target ?? ''),
        type: value.Type?.split('/').at(-1) ?? '',
        external,
      });
    });
  });
  return result;
}

/** Text that the cell parser would otherwise read as a number, date or formula. */
function needsLiteralPrefix(text: string) {
  if (!/^\p{L}/u.test(text)) return true;
  if (/^\s*(?:true|false)\s*$/i.test(text)) return true;
  // Excel and IronCalc read "Jan 2024" or "Mar-24" as dates.
  return /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s\-/,]*\d/i.test(
    text
  );
}

function isDateFormat(code: string) {
  // Keep elapsed-time markers such as [h]; drop colors, locales and conditions.
  const tokens = code
    .replace(/"[^"]*"|\\.|\[(?![hms]+\])[^\]]*\]/gi, '')
    .split(';')[0];
  return /[dy]/i.test(tokens) || (/m/i.test(tokens) && !/[hs]/i.test(tokens));
}

function rangeBounds(reference: string) {
  const [first, last = first] = reference.replaceAll('$', '').split(':');
  const start = parseExcelAddress(first);
  const end = parseExcelAddress(last);
  if (!start || !end || start.row > end.row || start.column > end.column)
    return;
  return {
    top: start.row,
    left: start.column,
    bottom: end.row,
    right: end.column,
  };
}

/** Any valid Excel address, including rows Macro cannot hold. */
function parseExcelAddress(address: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/i.exec(address);
  if (!match) return;
  let column = 0;
  for (const character of match[1].toUpperCase())
    column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column > SPREADSHEET_MAX_COLUMNS || row > EXCEL_MAX_ROWS) return;
  return { row: row - 1, column: column - 1 };
}

type SheetEntry = {
  name: string;
  path: string;
  hidden: boolean;
  kind: string;
};

type WorkbookContext = {
  archive: XlsxArchive;
  sharedStrings: { text: string; rich: boolean }[];
  styles: XlsxStylesheet;
  date1904: boolean;
  dynamicArrays: boolean;
  tables: WorkbookTable[];
  sheetNames: string[];
  /** Lowercase names defined as multi-cell references. */
  rangeNames: ReadonlySet<string>;
  warnings: Set<string>;
  unsupportedFunctions: Set<string>;
  supportedFunctions?: ReadonlySet<string>;
};

type PendingShared = {
  row: number;
  column: number;
  si: string;
  style: SpreadsheetCellStyle;
};

/**
 * A cell formula as Macro stores it, or undefined when a table reference
 * cannot be converted. `intersect` applies the implicit intersection Excel
 * uses for formulas saved without dynamic-array or array evaluation.
 */
function importFormula(
  source: string,
  context: WorkbookContext,
  sheet: string,
  row: number,
  column: number,
  intersect: boolean
): string | undefined {
  const stripped = normalizeReferences(
    stripFunctionPrefixes(importSingleFunction(source))
  );
  const resolved = resolveStructuredReferences(
    stripped,
    context.tables,
    sheet,
    row,
    column
  );
  if (resolved === undefined) return;
  if (resolved !== stripped)
    context.warnings.add(
      'Excel table references are converted to cell ranges; tables are imported as ordinary cells.'
    );
  let formula = expandSheetRanges(resolved, context.sheetNames);
  if (formula !== resolved)
    context.warnings.add(
      'References spanning several sheets are expanded to list each sheet.'
    );
  if (intersect)
    formula = markImplicitIntersections(formula, context.rangeNames);
  if (context.supportedFunctions)
    for (const name of formulaFunctionNames(formula))
      if (!context.supportedFunctions.has(name))
        context.unsupportedFunctions.add(name);
  return formula;
}

/** Read one worksheet part with a single streaming pass. */
function readWorksheet(
  entry: SheetEntry,
  context: WorkbookContext
): WorkbookFileSheet {
  const { styles, warnings, sharedStrings } = context;
  const bytes = context.archive.read(entry.path);
  if (!bytes) throw new Error(`The sheet “${entry.name}” is missing.`);
  const cells: SpreadsheetCells = {};
  const metadata: WorkbookSheetMetadata = {};
  const rowHeights: Record<number, number> = {};
  const hiddenRows: number[] = [];
  const columns: {
    min: number;
    max: number;
    width?: number;
    hidden: boolean;
  }[] = [];
  const merges: string[] = [];
  const shared = new Map<
    string,
    { formula: string; row: number; column: number }
  >();
  const pendingShared: PendingShared[] = [];
  const skipped = new Set<string>();
  const dataTableRanges: ReturnType<typeof rangeBounds>[] = [];
  const arrayFormulas: Record<string, string> = {};
  let maxRow = -1;
  let maxColumn = -1;
  let defaultWidth = 64;
  let defaultHeight = 15;
  let droppedRows = false;

  let rowIndex = -1;
  let columnIndex = -1;
  let rowStyle: { hidden: boolean; height?: number } | undefined;
  let cell:
    | {
        row: number;
        column: number;
        style: number;
        type: string;
        dynamic: boolean;
        formula?: Attributes;
        formulaText: string;
        value: string;
        inline: string;
      }
    | undefined;
  let text: 'formula' | 'value' | 'inline' | undefined;
  let inInline = false;
  let inPhonetic = false;
  let inSheetData = false;
  let elements = 0;

  const place = (row: number, column: number, placed: SpreadsheetCell) => {
    if (row >= SPREADSHEET_MAX_ROWS) {
      if (placed.value)
        throw new Error(
          `“${entry.name}” has data beyond row ${SPREADSHEET_MAX_ROWS.toLocaleString('en-US')}, the most Macro supports. No sheets were imported.`
        );
      droppedRows = true;
      return;
    }
    const long = placed.value.length > SPREADSHEET_MAX_CELL_LENGTH;
    if (long && placed.value.startsWith('='))
      throw new Error(
        `Cell ${entry.name}!${formatCellAddress(row, column)} exceeds 10,000 characters. No sheets were imported.`
      );
    // Excel allows 32,767 characters; keep the workbook and shorten long notes.
    if (long)
      warnings.add(
        'Text longer than 10,000 characters was shortened to fit Macro cells.'
      );
    cells[formatCellAddress(row, column)] = long
      ? { ...placed, value: placed.value.slice(0, SPREADSHEET_MAX_CELL_LENGTH) }
      : placed;
    maxRow = Math.max(maxRow, row);
    maxColumn = Math.max(maxColumn, column);
  };

  const literalText = (raw: string, style: SpreadsheetCellStyle) =>
    style.format === 'text' || !needsLiteralPrefix(raw) ? raw : `'${raw}`;

  const finishCell = () => {
    if (!cell) return;
    const current = cell;
    cell = undefined;
    const address = formatCellAddress(current.row, current.column);
    const style: SpreadsheetCellStyle = { ...styles.cellStyle(current.style) };
    if (skipped.has(address)) {
      // Array results and merged areas keep formatting, not cached values.
      if (Object.keys(style).length)
        place(current.row, current.column, { value: '', ...style });
      return;
    }
    let value = '';
    let calculated = false;
    const formula = current.formula;
    const cached = (): string => {
      if (current.type === 's')
        return sharedStrings[Number(current.value)]?.text ?? '';
      if (current.type === 'str' || current.type === 'inlineStr')
        return current.type === 'inlineStr' ? current.inline : current.value;
      return current.value;
    };
    const literal = (): string => {
      const raw = cached();
      switch (current.type) {
        case 's':
        case 'str':
        case 'inlineStr': {
          if (
            current.type === 's' &&
            sharedStrings[Number(current.value)]?.rich
          )
            warnings.add(
              'Rich text is imported as plain text with the cell’s formatting.'
            );
          return raw === '' ? '' : literalText(raw, style);
        }
        case 'b':
          return raw === '1' || raw.toLowerCase() === 'true' ? 'TRUE' : 'FALSE';
        case 'e':
          if (KNOWN_ERRORS.has(raw)) return raw;
          warnings.add('Some newer Excel errors are imported as text.');
          return `'${raw}`;
        case 'd': {
          const time = Date.parse(raw);
          if (!Number.isFinite(time)) return raw ? `'${raw}` : '';
          return String(time / 86_400_000 + 25_569);
        }
        default: {
          if (raw.trim() === '') return '';
          const number = Number(raw);
          if (!Number.isFinite(number)) return `'${raw}`;
          if (
            context.date1904 &&
            isDateFormat(styles.numberFormat(current.style))
          )
            return String(number + 1462);
          // Excel writes 17 significant digits (32475.200000000001); the
          // shortest text for the same double is what Excel itself displays.
          return String(number);
        }
      }
    };
    if (formula && formula.t === 'dataTable') {
      dataTableRanges.push(rangeBounds(formula.ref ?? address));
      warnings.add(
        'What-if data tables are imported as their last calculated values.'
      );
      value = literal();
    } else if (
      dataTableRanges.some(
        (range) =>
          range &&
          current.row >= range.top &&
          current.row <= range.bottom &&
          current.column >= range.left &&
          current.column <= range.right
      )
    ) {
      value = literal();
    } else if (formula) {
      let source = current.formulaText;
      if (formula.t === 'shared' && formula.si !== undefined) {
        if (source)
          shared.set(formula.si, {
            formula: source,
            row: current.row,
            column: current.column,
          });
        else {
          const master = shared.get(formula.si);
          if (!master) {
            pendingShared.push({
              row: current.row,
              column: current.column,
              si: formula.si,
              style,
            });
            return;
          }
          source = translateFormula(
            master.formula,
            current.row - master.row,
            current.column - master.column
          );
        }
      }
      if (formula.t === 'array' && source) {
        const range = rangeBounds(formula.ref ?? address);
        const leading = /^\s*(?:_xlfn\.)?(?:_xlws\.)?([A-Z][A-Z0-9.]*)\s*\(/i
          .exec(source)?.[1]
          .toUpperCase();
        const dynamic =
          current.dynamic ||
          (leading !== undefined && SPILL_FUNCTIONS.has(leading));
        if (
          range &&
          (range.top !== current.row || range.left !== current.column)
        )
          warnings.add(
            'Some array formulas with invalid ranges were imported as single-cell formulas.'
          );
        else if (range) {
          for (let row = range.top; row <= range.bottom; row++)
            for (let column = range.left; column <= range.right; column++)
              if (row !== current.row || column !== current.column)
                skipped.add(formatCellAddress(row, column));
          if (dynamic)
            warnings.add(
              'Dynamic array formulas are recalculated by Macro; cached spill values are discarded and their cell formatting is retained.'
            );
          else {
            arrayFormulas[address] =
              range.top === range.bottom && range.left === range.right
                ? address
                : `${address}:${formatCellAddress(range.bottom, range.right)}`;
          }
        }
      }
      if (!source) value = literal();
      else if (hasExternalReference(source)) {
        warnings.add(
          'Formulas that reference other workbooks are imported as their last calculated values.'
        );
        value = literal();
      } else if (formulaFunctionNames(source).includes('GETPIVOTDATA')) {
        // Pivot tables are not imported, so these lookups could never calculate.
        warnings.add(
          'Pivot table lookups (GETPIVOTDATA) are imported as their last calculated values.'
        );
        value = literal();
      } else {
        const resolved = importFormula(
          source,
          context,
          entry.name,
          current.row,
          current.column,
          formula.t !== 'array' && !current.dynamic
        );
        if (resolved === undefined) {
          warnings.add(
            'Some table references could not be converted; those formulas show their last calculated values.'
          );
          value = literal();
        } else {
          value = `=${resolved}`;
          calculated = true;
        }
      }
    } else value = literal();
    // A text format would show a formula as its source, whatever its result.
    if (
      style.format === 'text' &&
      value &&
      !/^'/.test(value) &&
      (calculated ||
        (current.type !== 's' &&
          current.type !== 'str' &&
          current.type !== 'inlineStr'))
    ) {
      delete style.format;
      warnings.add(
        'Text number formats on numeric, boolean, date or formula cells are reset to preserve the original value types.'
      );
    }
    if (value || Object.keys(style).length)
      place(current.row, current.column, { value, ...style });
  };

  parse(bytes, entry.path, (parser) => {
    parser.on('opentag', (node) => {
      if (!MAIN_NAMESPACES.has(node.uri)) return;
      const value = attributes(node);
      switch (node.local) {
        case 'sheetData':
          inSheetData = true;
          return;
        case 'sheetFormatPr': {
          const width = Number(value.defaultColWidth);
          if (Number.isFinite(width) && width > 0)
            defaultWidth = Math.round(width * 7 + 5);
          const height = Number(value.defaultRowHeight);
          if (Number.isFinite(height) && height > 0) defaultHeight = height;
          return;
        }
        case 'sheetView':
          if (value.showGridLines === '0' || value.showGridLines === 'false')
            metadata.gridlines = false;
          return;
        case 'pane':
          if (value.state === 'frozen' || value.state === 'frozenSplit') {
            const rows = Math.min(
              SPREADSHEET_MAX_ROWS,
              Math.max(0, Math.round(Number(value.ySplit ?? 0)))
            );
            const columnsFrozen = Math.min(
              SPREADSHEET_MAX_COLUMNS,
              Math.max(0, Math.round(Number(value.xSplit ?? 0)))
            );
            if (
              (rows || columnsFrozen) &&
              Number.isFinite(rows) &&
              Number.isFinite(columnsFrozen)
            )
              metadata.freeze = { rows, columns: columnsFrozen };
          }
          return;
        case 'tabColor':
          if (/^[0-9a-f]{8}$/i.test(value.rgb ?? ''))
            metadata.tabColor = `#${value.rgb.slice(2).toUpperCase()}`;
          return;
        case 'col': {
          const min = Number(value.min);
          const max = Number(value.max);
          if (
            !Number.isInteger(min) ||
            !Number.isInteger(max) ||
            min < 1 ||
            min > max ||
            max > SPREADSHEET_MAX_COLUMNS
          )
            throw new Error(`Invalid column in ${entry.path}.`);
          const width = Number(value.width);
          columns.push({
            min: min - 1,
            max: max - 1,
            width: Number.isFinite(width) && width >= 0 ? width : undefined,
            hidden: value.hidden === '1' || value.hidden === 'true',
          });
          return;
        }
        case 'row': {
          finishCell();
          const row =
            value.r === undefined ? rowIndex + 1 : Number(value.r) - 1;
          if (!Number.isInteger(row) || row < 0 || row >= EXCEL_MAX_ROWS)
            throw new Error(`Invalid row in ${entry.path}.`);
          rowIndex = row;
          columnIndex = -1;
          const height = Number(value.ht);
          rowStyle = {
            hidden: value.hidden === '1' || value.hidden === 'true',
            height:
              (value.customHeight === '1' || value.customHeight === 'true') &&
              Number.isFinite(height) &&
              height >= 0 &&
              height <= 409.5
                ? height
                : undefined,
          };
          if (row < SPREADSHEET_MAX_ROWS) {
            if (rowStyle.hidden) hiddenRows.push(row);
            if (rowStyle.height !== undefined)
              rowHeights[row] = rowStyle.height;
          }
          return;
        }
        case 'c': {
          finishCell();
          if (!inSheetData) return;
          let row = rowIndex;
          let column = columnIndex + 1;
          if (value.r) {
            const position = parseExcelAddress(value.r);
            if (!position) {
              // Cells past Excel's own limits cannot be addressed; skip them.
              warnings.add('Cells outside Excel’s grid limits were skipped.');
              return;
            }
            ({ row, column } = position);
          }
          if (row < 0) row = 0;
          rowIndex = row;
          columnIndex = column;
          if (++elements > XLSX_MAX_CELLS * 2)
            throw new Error(
              `Too many cells in ${entry.name}. No sheets were imported.`
            );
          cell = {
            row,
            column,
            style: Number(value.s ?? 0) || 0,
            type: value.t ?? 'n',
            dynamic: value.cm !== undefined && context.dynamicArrays,
            formulaText: '',
            value: '',
            inline: '',
          };
          if (value.vm !== undefined)
            warnings.add(
              'Linked data types and pictures in cells are imported as their displayed values.'
            );
          return;
        }
        case 'f':
          if (cell) {
            cell.formula = value;
            text = 'formula';
          }
          return;
        case 'v':
          if (cell) text = 'value';
          return;
        case 'is':
          inInline = !!cell;
          return;
        case 't':
          if (inInline && !inPhonetic) text = 'inline';
          return;
        case 'rPh':
          inPhonetic = true;
          return;
        case 'mergeCell': {
          const range = rangeBounds(value.ref ?? '');
          if (!range) {
            warnings.add('Invalid merged ranges were ignored.');
            return;
          }
          if (range.top >= SPREADSHEET_MAX_ROWS) return;
          const bottom = Math.min(range.bottom, SPREADSHEET_MAX_ROWS - 1);
          if (range.top === bottom && range.left === range.right) return;
          merges.push(
            `${formatCellAddress(range.top, range.left)}:${formatCellAddress(bottom, range.right)}`
          );
          return;
        }
        case 'autoFilter': {
          const range = rangeBounds(value.ref ?? '');
          if (range && range.bottom < SPREADSHEET_MAX_ROWS)
            metadata.autoFilter = `${formatCellAddress(range.top, range.left)}:${formatCellAddress(range.bottom, range.right)}`;
          return;
        }
        case 'conditionalFormatting':
          warnings.add('Conditional formatting rules are not imported.');
          return;
        case 'dataValidation':
          warnings.add('Data validation and dropdown rules are not imported.');
          return;
        case 'hyperlink':
          warnings.add(
            'Hyperlinks are imported as display text; link targets are not retained.'
          );
          return;
        case 'sheetProtection':
          warnings.add(
            'Excel sheet protection is not imported; Macro sharing controls determine edit access.'
          );
          return;
      }
    });
    parser.on('text', (chunk) => {
      if (!cell || !text || inPhonetic) return;
      if (text === 'formula') cell.formulaText += chunk;
      else if (text === 'value') cell.value += chunk;
      else cell.inline += unescapeText(chunk);
    });
    parser.on('closetag', (node) => {
      if (!MAIN_NAMESPACES.has(node.uri)) return;
      if (node.local === 'rPh') inPhonetic = false;
      else if (node.local === 'f' || node.local === 'v' || node.local === 't')
        text = undefined;
      else if (node.local === 'is') inInline = false;
      else if (node.local === 'c') finishCell();
      else if (node.local === 'sheetData') {
        finishCell();
        inSheetData = false;
      }
    });
  });
  for (const pending of pendingShared) {
    const master = shared.get(pending.si);
    const address = formatCellAddress(pending.row, pending.column);
    const value = master
      ? `=${
          importFormula(
            translateFormula(
              master.formula,
              pending.row - master.row,
              pending.column - master.column
            ),
            context,
            entry.name,
            pending.row,
            pending.column,
            true
          ) ?? '#REF!'
        }`
      : '';
    if (!master)
      warnings.add('Some shared formulas were missing their source formula.');
    if (!cells[address] && (value || Object.keys(pending.style).length))
      place(pending.row, pending.column, { value, ...pending.style });
  }
  // Only a merge's top-left cell keeps a value; covered cells keep borders.
  for (const merge of merges) {
    const range = rangeBounds(merge)!;
    const clear = (address: string) => {
      const covered = cells[address];
      if (!covered?.value) return;
      const { value: _value, ...style } = covered;
      if (Object.keys(style).length) cells[address] = { value: '', ...style };
      else delete cells[address];
    };
    const area =
      (range.bottom - range.top + 1) * (range.right - range.left + 1);
    if (area <= 10_000) {
      for (let r = range.top; r <= range.bottom; r++)
        for (let c = range.left; c <= range.right; c++)
          if (r !== range.top || c !== range.left)
            clear(formatCellAddress(r, c));
    } else
      for (const address of Object.keys(cells)) {
        const position = parseCellAddress(address)!;
        if (
          position.row >= range.top &&
          position.row <= range.bottom &&
          position.column >= range.left &&
          position.column <= range.right &&
          (position.row !== range.top || position.column !== range.left)
        )
          clear(address);
      }
  }
  if (droppedRows)
    warnings.add(
      `Formatting below row ${SPREADSHEET_MAX_ROWS.toLocaleString('en-US')} is not imported.`
    );
  const rowCount = Math.max(SPREADSHEET_ROWS, maxRow + 1);
  // Hidden or styled columns often extend to XFD; only the used area matters.
  let columnCount = Math.max(SPREADSHEET_COLUMNS, maxColumn + 1);
  for (const merge of merges) {
    const range = rangeBounds(merge);
    if (range) columnCount = Math.max(columnCount, range.right + 1);
  }
  const columnWidths: Record<number, number> = {};
  const hiddenColumns: number[] = [];
  for (let column = 0; column < columnCount; column++) {
    const definition = columns.findLast(
      (item) => column >= item.min && column <= item.max
    );
    const pixels = Math.max(
      MIN_COLUMN_WIDTH,
      Math.min(
        MAX_COLUMN_WIDTH,
        definition?.width !== undefined
          ? Math.round(
              definition.width < 1
                ? definition.width * 12
                : definition.width * 7 + 5
            )
          : defaultWidth
      )
    );
    // Excel's default is 64px; Macro's own default needs no stored width.
    if (pixels !== DEFAULT_COLUMN_WIDTH) columnWidths[column] = pixels;
    if (definition?.hidden) hiddenColumns.push(column);
  }
  if (hiddenColumns.length >= columnCount) hiddenColumns.length = 0;
  if (merges.length) metadata.merges = merges;
  if (hiddenRows.length && hiddenRows.length < rowCount)
    metadata.hiddenRows = hiddenRows.filter((row) => row < rowCount);
  if (hiddenColumns.length) metadata.hiddenColumns = hiddenColumns;
  // Rows at the sheet's default height already look the same in Macro.
  const heights = Object.entries(rowHeights).filter(
    ([, height]) => Math.abs(height - defaultHeight) > 0.01
  );
  if (heights.length) metadata.rowHeights = Object.fromEntries(heights);
  if (Object.keys(arrayFormulas).length) metadata.arrayFormulas = arrayFormulas;
  if (entry.hidden) {
    metadata.hidden = true;
    warnings.add(
      'Hidden sheets are shown in Macro; their visibility is retained in Excel downloads.'
    );
  }
  if (styles.defaultFont) metadata.defaultFont = styles.defaultFont;
  if (merges.length)
    warnings.add(
      'Merged ranges are shown as individual cells in Macro and restored on Excel export when their covered cells remain empty.'
    );
  if (metadata.freeze)
    warnings.add(
      'Frozen panes are retained for Excel export; Macro uses its own scrolling view.'
    );
  if (metadata.autoFilter)
    warnings.add(
      'Excel filters are retained for export; Macro displays all rows.'
    );
  // Tall rows show Excel's bottom alignment; ordinary rows look the same either
  // way. Measure against Excel's standard 15pt row so a round trip agrees.
  if (metadata.rowHeights)
    for (const [address, value] of Object.entries(cells)) {
      if (value.verticalAlign) continue;
      const row = parseCellAddress(address)?.row;
      const height = row === undefined ? undefined : metadata.rowHeights[row];
      if (height !== undefined && height > 22.5) value.verticalAlign = 'bottom';
    }
  return {
    name: entry.name,
    cells,
    rowCount,
    columnCount,
    columnWidths,
    metadata,
  };
}

function readSharedStrings(archive: XlsxArchive, path: string | undefined) {
  const strings: { text: string; rich: boolean }[] = [];
  const bytes = path ? archive.read(path) : undefined;
  if (!bytes) return strings;
  let current: { text: string; rich: boolean } | undefined;
  let inText = false;
  let inPhonetic = false;
  parse(bytes, path!, (parser) => {
    parser.on('opentag', (node) => {
      if (node.local === 'si') current = { text: '', rich: false };
      else if (node.local === 'rPh') inPhonetic = true;
      else if (node.local === 'r' && current) current.rich = true;
      else if (node.local === 't') inText = !inPhonetic;
    });
    parser.on('text', (text) => {
      if (current && inText) current.text += text;
    });
    parser.on('closetag', (node) => {
      if (node.local === 't') inText = false;
      else if (node.local === 'rPh') inPhonetic = false;
      else if (node.local === 'si' && current) {
        strings.push({ text: unescapeText(current.text), rich: current.rich });
        current = undefined;
      }
    });
  });
  return strings;
}

function readTables(
  archive: XlsxArchive,
  sheets: SheetEntry[]
): WorkbookTable[] {
  const tables: WorkbookTable[] = [];
  for (const sheet of sheets) {
    for (const relation of relationships(archive, sheet.path).values()) {
      if (relation.type !== 'table' || relation.external) continue;
      const bytes = archive.read(relation.target);
      if (!bytes) continue;
      let table: WorkbookTable | undefined;
      parse(bytes, relation.target, (parser) => {
        parser.on('opentag', (node) => {
          const value = attributes(node);
          if (node.local === 'table') {
            const range = rangeBounds(value.ref ?? '');
            if (!range || !(value.displayName ?? value.name)) return;
            table = {
              name: value.displayName ?? value.name,
              sheet: sheet.name,
              ...range,
              headerRows: value.headerRowCount === '0' ? 0 : 1,
              totalsRows: Number(value.totalsRowCount ?? 0) > 0 ? 1 : 0,
              columns: [],
            };
          } else if (node.local === 'tableColumn' && table)
            table.columns.push(unescapeText(value.name ?? ''));
        });
      });
      if (table) tables.push(table);
    }
  }
  return tables;
}

/** Decode a validated XLSX package into Macro sheets, without ExcelJS. */
export function readXlsxWorkbook(
  archive: XlsxArchive,
  options: { supportedFunctions?: ReadonlySet<string> } = {}
): WorkbookFileData {
  const warnings = new Set<string>();
  const workbookPath = 'xl/workbook.xml';
  const workbookBytes = archive.read(workbookPath)!;
  const rels = relationships(archive, workbookPath);
  const sheets: SheetEntry[] = [];
  const names: {
    name: string;
    formula: string;
    sheet?: number;
    hidden: boolean;
  }[] = [];
  let date1904 = false;
  let currentName: (typeof names)[number] | undefined;
  parse(workbookBytes, workbookPath, (parser) => {
    parser.on('opentag', (node) => {
      const value = attributes(node);
      if (node.local === 'sheet') {
        const relation = rels.get(value.id ?? '');
        sheets.push({
          name: value.name ?? '',
          path: relation?.target ?? '',
          hidden: value.state === 'hidden' || value.state === 'veryHidden',
          kind: relation?.type ?? '',
        });
      } else if (node.local === 'workbookPr')
        date1904 = value.date1904 === '1' || value.date1904 === 'true';
      else if (node.local === 'definedName')
        currentName = {
          name: value.name ?? '',
          formula: '',
          hidden: value.hidden === '1',
          ...(value.localSheetId !== undefined && {
            sheet: Number(value.localSheetId),
          }),
        };
    });
    parser.on('text', (text) => {
      if (currentName) currentName.formula += text;
    });
    parser.on('closetag', (node) => {
      if (node.local === 'definedName' && currentName) {
        names.push(currentName);
        currentName = undefined;
      }
    });
  });
  const worksheets = sheets.filter(
    (sheet) => sheet.kind === 'worksheet' && sheet.path
  );
  if (worksheets.length < sheets.length)
    warnings.add('Chart sheets and other non-grid sheets are not imported.');
  if (!worksheets.length)
    throw new Error('This workbook has no worksheets to import.');
  if (worksheets.length > XLSX_MAX_SHEETS)
    throw new Error(
      `Import up to ${XLSX_MAX_SHEETS} sheets at a time. No sheets were imported.`
    );
  const sharedPath = [...rels.values()].find(
    (item) => item.type === 'sharedStrings'
  )?.target;
  const stylesPath = [...rels.values()].find(
    (item) => item.type === 'styles'
  )?.target;
  const themePath = [...rels.values()].find(
    (item) => item.type === 'theme'
  )?.target;
  const metadataBytes = archive.read('xl/metadata.xml');
  const theme = readXlsxTheme(
    themePath
      ? { [themePath]: archive.read(themePath) ?? new Uint8Array() }
      : {},
    themePath
  );
  const stylesBytes = stylesPath ? archive.read(stylesPath) : undefined;
  const tables = readTables(archive, worksheets);
  const rangeNames = new Set<string>();
  for (const entry of names) {
    const formula = resolveStructuredReferences(
      stripFunctionPrefixes(entry.formula),
      tables,
      worksheets[0].name,
      0,
      0
    );
    const range = formula && MULTI_CELL_REFERENCE.exec(formula);
    if (range && range[1].replaceAll('$', '') !== range[2].replaceAll('$', ''))
      rangeNames.add(entry.name.toLowerCase());
  }
  const context: WorkbookContext = {
    archive,
    sharedStrings: readSharedStrings(archive, sharedPath),
    styles: readXlsxStylesheet(
      stylesBytes ? new TextDecoder().decode(stylesBytes) : '',
      theme,
      warnings
    ),
    date1904,
    dynamicArrays:
      !!metadataBytes &&
      new TextDecoder().decode(metadataBytes).includes('XLDAPR'),
    tables,
    sheetNames: worksheets.map((sheet) => sheet.name),
    rangeNames,
    warnings,
    unsupportedFunctions: new Set(),
    supportedFunctions: options.supportedFunctions,
  };
  const result = worksheets.map((sheet) => readWorksheet(sheet, context));
  const total = result.reduce(
    (sum, sheet) =>
      sum + Object.values(sheet.cells).filter((cell) => cell.value).length,
    0
  );
  if (total > XLSX_MAX_CELLS)
    throw new Error(
      `This workbook has ${total.toLocaleString('en-US')} filled cells; Macro imports up to ${XLSX_MAX_CELLS.toLocaleString('en-US')}. No sheets were imported.`
    );
  const sheetIndex = new Map(
    sheets.map((sheet, index) => [index, worksheets.indexOf(sheet)])
  );
  let importedNames = 0;
  for (const entry of names) {
    if (!entry.name || /^_xl(?:nm|fn)\./i.test(entry.name)) continue;
    const target = entry.sheet === undefined ? 0 : sheetIndex.get(entry.sheet);
    if (target === undefined || target < 0) continue;
    if (hasExternalReference(entry.formula)) {
      warnings.add('Names that refer to other workbooks are not imported.');
      continue;
    }
    if (++importedNames > 10_000)
      throw new Error('Import up to 10,000 Excel name definitions.');
    const formula =
      resolveStructuredReferences(
        stripFunctionPrefixes(entry.formula),
        context.tables,
        worksheets[target].name,
        0,
        0
      ) ?? entry.formula;
    const sheet = result[target];
    sheet.metadata ??= {};
    sheet.metadata.definedNames ??= [];
    sheet.metadata.definedNames.push({
      name: entry.name,
      formula,
      ...(entry.sheet !== undefined && { local: true }),
    });
  }
  if (context.unsupportedFunctions.size)
    warnings.add(
      `Macro cannot calculate these Excel functions yet, so their formulas show errors: ${[...context.unsupportedFunctions].sort().join(', ')}.`
    );
  for (const sheet of result)
    if (sheet.metadata && !Object.keys(sheet.metadata).length)
      delete sheet.metadata;
  return { sheets: result, warnings: [...warnings] };
}
