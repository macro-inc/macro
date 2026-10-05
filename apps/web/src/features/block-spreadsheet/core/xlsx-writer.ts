import {
  cellDateMention,
  cellPlainText,
} from '@macro-inc/spreadsheet/cell-mentions';
import {
  parseChartReference,
  type SheetDrawing,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { parseWorkbookMetadata } from '@macro-inc/spreadsheet/workbook-metadata';
import { strToU8, zipSync } from 'fflate';
import type { CalculatedCell } from './calculation';
import type { ChartValue } from './chart-data';
import {
  DEFAULT_COLUMN_WIDTH,
  formatCellAddress,
  isSpreadsheetCellStyle,
  parseCellAddress,
  SPREADSHEET_MAX_CELL_LENGTH,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
  type SpreadsheetCell,
} from './spreadsheet-document';
import {
  type WorkbookFileData,
  type WorkbookFileExport,
  XLSX_MAX_EXPANDED_BYTES,
  XLSX_MAX_SHEETS,
} from './workbook-file-types';
import { chartPart, drawingPart, imageFile, themePart } from './xlsx-drawings';
import {
  addFunctionPrefixes,
  exportImplicitIntersections,
  markImplicitIntersections,
} from './xlsx-formula';
import { pivotParts, pivotTableName } from './xlsx-pivots';
import {
  conditionalFormattingXml,
  dataValidationsXml,
  differentialXml,
  notesParts,
} from './xlsx-sheet-rules';
import { type XlsxCellStyle, xlsxCellStyle } from './xlsx-styles';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIPS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const KNOWN_ERRORS = new Set([
  '#DIV/0!',
  '#N/A',
  '#NAME?',
  '#NULL!',
  '#NUM!',
  '#REF!',
  '#VALUE!',
]);
/** Macro's default column width in Excel character units. */
const DEFAULT_COLUMN_CHARACTERS =
  Math.round(((DEFAULT_COLUMN_WIDTH - 5) / 7) * 256) / 256;
const BUILTIN_FORMATS: Record<string, number> = {
  General: 0,
  '0': 1,
  '0.00': 2,
  '#,##0': 3,
  '#,##0.00': 4,
  '0%': 9,
  '0.00%': 10,
  '0.00E+00': 11,
  '@': 49,
};

/** Escape text for XML, including characters XML 1.0 cannot carry. */
export function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\r', '&#13;');
}

/** Cell text uses OOXML's `_xHHHH_` escape for control characters. */
function escapeText(value: string) {
  return escapeXml(
    value.replace(/_(x[0-9a-f]{4}_)/gi, '_x005F_$1').replace(
      // Everything XML 1.0 cannot carry: control characters other than tab,
      // line feed and carriage return, and U+FFFE/U+FFFF.
      /[^\t\n\r -\ud7ff\ud800-\udfff\ue000-\ufffd]/g,
      (character) =>
        `_x${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`
    )
  );
}

function text(value: string) {
  return /^\s|\s$/.test(value)
    ? `<t xml:space="preserve">${escapeText(value)}</t>`
    : `<t>${escapeText(value)}</t>`;
}

function numberText(value: number) {
  return Number.isFinite(value) ? String(value) : '0';
}

/** Deduplicate fonts, fills, borders, formats and cell formats. */
class StyleTable {
  private formats = new Map<string, number>();
  private fonts = new Map<string, number>();
  private fills = new Map<string, number>([
    ['<patternFill patternType="none"/>', 0],
    ['<patternFill patternType="gray125"/>', 1],
  ]);
  private borders = new Map<string, number>([['', 0]]);
  private xfs = new Map<string, number>();
  private cache = new Map<string, number>();
  private dxfs = new Map<string, number>();

  /** The `dxfId` of a conditional format's differential format. */
  dxf(style: Parameters<typeof differentialXml>[0]): number {
    const key = differentialXml(
      style,
      style?.numberFormat ? this.format(style.numberFormat) : undefined
    );
    let index = this.dxfs.get(key);
    if (index === undefined) {
      index = this.dxfs.size;
      this.dxfs.set(key, index);
    }
    return index;
  }

  constructor(defaultFont: { name: string; size: number }) {
    this.font({
      ...defaultFont,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
    });
    this.xfs.set('0,0,0,0,', 0);
  }

  /** The `numFmtId` of a number format code. */
  format(code: string): number {
    let format: number | undefined = BUILTIN_FORMATS[code];
    if (format === undefined) {
      format = this.formats.get(code);
      if (format === undefined) {
        format = 164 + this.formats.size;
        this.formats.set(code, format);
      }
    }
    return format;
  }

  private font(font: XlsxCellStyle['font']) {
    const key = [
      font.bold && '<b/>',
      font.italic && '<i/>',
      font.strike && '<strike/>',
      font.underline && '<u/>',
      `<sz val="${numberText(font.size)}"/>`,
      font.color && `<color rgb="FF${font.color}"/>`,
      `<name val="${escapeXml(font.name)}"/>`,
    ]
      .filter(Boolean)
      .join('');
    let index = this.fonts.get(key);
    if (index === undefined) {
      index = this.fonts.size;
      this.fonts.set(key, index);
    }
    return index;
  }

  /** The `s` index for a cell, or 0 for the workbook default. */
  index(
    cell: SpreadsheetCell,
    defaultFont?: { name: string; size: number }
  ): number {
    const key = JSON.stringify([{ ...cell, value: '' }, defaultFont]);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const style = xlsxCellStyle(cell, defaultFont);
    const format = this.format(style.numFmt);
    const font = this.font(style.font);
    let fill = 0;
    if (style.fill) {
      const key = `<patternFill patternType="solid"><fgColor rgb="FF${style.fill}"/><bgColor indexed="64"/></patternFill>`;
      fill = this.fills.get(key) ?? this.fills.size;
      this.fills.set(key, fill);
    }
    const borderKey = (['left', 'right', 'top', 'bottom'] as const)
      .map((edge) => {
        const line = style.border[edge];
        return line
          ? `<${edge} style="${line.style}"><color rgb="FF${line.color}"/></${edge}>`
          : `<${edge}/>`;
      })
      .join('');
    const border = Object.keys(style.border).length
      ? (this.borders.get(borderKey) ?? this.borders.size)
      : 0;
    if (border) this.borders.set(borderKey, border);
    const alignment = [
      style.alignment.horizontal &&
        `horizontal="${style.alignment.horizontal}"`,
      style.alignment.vertical !== 'bottom' &&
        `vertical="${style.alignment.vertical}"`,
      style.alignment.wrapText && 'wrapText="1"',
    ]
      .filter(Boolean)
      .join(' ');
    const xfKey = `${format ?? 0},${font},${fill},${border},${alignment}`;
    let index = this.xfs.get(xfKey);
    if (index === undefined) {
      index = this.xfs.size;
      this.xfs.set(xfKey, index);
    }
    this.cache.set(key, index);
    return index;
  }

  xml(): string {
    const formats = [...this.formats]
      .map(
        ([code, id]) =>
          `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`
      )
      .join('');
    const xfs = [...this.xfs.keys()]
      .map((key) => {
        const [format, font, fill, border, ...rest] = key.split(',');
        const alignment = rest.join(',');
        return `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${format !== '0' ? ' applyNumberFormat="1"' : ''}${font !== '0' ? ' applyFont="1"' : ''}${fill !== '0' ? ' applyFill="1"' : ''}${border !== '0' ? ' applyBorder="1"' : ''}${alignment ? ` applyAlignment="1"><alignment ${alignment}/></xf>` : '/>'}`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN}">${
      this.formats.size
        ? `<numFmts count="${this.formats.size}">${formats}</numFmts>`
        : ''
    }<fonts count="${this.fonts.size}">${[...this.fonts.keys()]
      .map((font) => `<font>${font}</font>`)
      .join('')}</fonts><fills count="${this.fills.size}">${[
      ...this.fills.keys(),
    ]
      .map((fill) => `<fill>${fill}</fill>`)
      .join('')}</fills><borders count="${this.borders.size}">${[
      ...this.borders.keys(),
    ]
      .map(
        (border) =>
          `<border>${border || '<left/><right/><top/><bottom/>'}<diagonal/></border>`
      )
      .join(
        ''
      )}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.size}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${this.dxfs.size}">${[...this.dxfs.keys()].join('')}</dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
  }
}

class SharedStrings {
  private strings = new Map<string, number>();
  private count = 0;

  index(value: string) {
    this.count++;
    let index = this.strings.get(value);
    if (index === undefined) {
      index = this.strings.size;
      this.strings.set(value, index);
    }
    return index;
  }

  xml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${MAIN}" count="${this.count}" uniqueCount="${this.strings.size}">${[
      ...this.strings.keys(),
    ]
      .map((value) => `<si>${text(value)}</si>`)
      .join('')}</sst>`;
  }
}

type WrittenValue =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; value: string }
  | { kind: 'formula'; formula: string; result?: CalculatedCell }
  | { kind: 'empty' };

/** A cell holding one date pill exports as the calculated date serial. */
export function exportedDateMention(
  cell: SpreadsheetCell,
  calculated?: CalculatedCell
) {
  return cell.format !== 'text' &&
    calculated?.number !== undefined &&
    cellDateMention(cell.value)
    ? calculated.number
    : undefined;
}

function writtenValue(
  cell: SpreadsheetCell,
  calculated: CalculatedCell | undefined,
  warnings: Set<string>
): WrittenValue {
  const dateSerial = exportedDateMention(cell, calculated);
  if (dateSerial !== undefined) return { kind: 'number', value: dateSerial };
  if (cellPlainText(cell.value) !== cell.value) {
    warnings.add(
      'Macro mentions are exported as their display text; interactive pills remain in Macro.'
    );
    return { kind: 'string', value: cellPlainText(cell.value) };
  }
  if (!cell.value) return { kind: 'empty' };
  if (cell.format === 'text') return { kind: 'string', value: cell.value };
  if (cell.value.startsWith('='))
    return {
      kind: 'formula',
      formula: cell.value.slice(1),
      result: calculated,
    };
  if (cell.value.startsWith("'"))
    return { kind: 'string', value: cell.value.slice(1) };
  if (/^(?:true|false)$/i.test(cell.value))
    return { kind: 'boolean', value: cell.value.toUpperCase() === 'TRUE' };
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.value.trim()))
    return { kind: 'number', value: Number(cell.value) };
  if (KNOWN_ERRORS.has(cell.value)) return { kind: 'error', value: cell.value };
  if (/^#[A-Z_/]+[!?]?$/.test(cell.value)) {
    warnings.add('Newer Excel error values are exported as text.');
    return { kind: 'string', value: cell.value };
  }
  if (calculated?.number !== undefined)
    return { kind: 'number', value: calculated.number };
  return { kind: 'string', value: cell.value };
}

/** Formulas whose meaning depends on array evaluation must be marked as
 * dynamic arrays, or Excel would apply legacy implicit intersection: array
 * constants, and ranges in positions where legacy Excel reads one value. */
function needsArrayEvaluation(formula: string, rangeNames: Set<string>) {
  if (formula.replace(/"(?:[^"]|"")*"/g, '""').includes('{')) return true;
  return markImplicitIntersections(formula, rangeNames) !== formula;
}

function quoteSheet(name: string) {
  return `'${name.replaceAll("'", "''")}'`;
}

/**
 * What a chart reads from a reference: each cell's displayed text and number,
 * row by row. References without a sheet read `home`.
 */
function chartValues(
  sheets: WorkbookFileData['sheets'],
  home: WorkbookFileData['sheets'][number]
) {
  const byName = new Map(
    sheets.map((sheet) => [sheet.name.toLowerCase(), sheet])
  );
  return (reference: string): ChartValue[] | undefined => {
    const range = parseChartReference(reference);
    const sheet = range?.sheet ? byName.get(range.sheet.toLowerCase()) : home;
    if (!range || !sheet) return;
    const values: ChartValue[] = [];
    for (let row = range.top; row <= range.bottom; row++)
      for (let column = range.left; column <= range.right; column++) {
        if (values.length >= 100_000) return values;
        const address = formatCellAddress(row, column);
        const result = sheet.values?.[address];
        if (result) {
          values.push({
            text: result.display,
            ...(result.number !== undefined && { number: result.number }),
          });
          continue;
        }
        const text = sheet.cells[address]?.value ?? '';
        const number = text.trim() === '' ? Number.NaN : Number(text);
        values.push({
          text,
          ...(Number.isFinite(number) && { number }),
        });
      }
    return values;
  };
}

/** Write Macro sheets as a SpreadsheetML package without an intermediate model. */
export function writeXlsxWorkbook(
  input: Pick<WorkbookFileData, 'sheets' | 'images'>
): WorkbookFileExport {
  if (!input.sheets.length || input.sheets.length > XLSX_MAX_SHEETS)
    throw new Error(`Export a workbook with 1–${XLSX_MAX_SHEETS} sheets.`);
  const warnings = new Set<string>();
  const names = new Set<string>();
  let contentSize = 0;
  const encoder = new TextEncoder();
  for (const sheet of input.sheets) {
    if (
      !sheet.name ||
      sheet.name.length > 31 ||
      /[\\/?*:[\]]/.test(sheet.name) ||
      names.has(sheet.name.toLowerCase())
    )
      throw new Error(
        'Excel sheet names must be unique and up to 31 characters, without \\ / ? * : [ ].'
      );
    names.add(sheet.name.toLowerCase());
    if (
      !Number.isInteger(sheet.rowCount) ||
      sheet.rowCount < 1 ||
      sheet.rowCount > SPREADSHEET_MAX_ROWS
    )
      throw new Error(
        `Sheets must have between 1 and ${SPREADSHEET_MAX_ROWS.toLocaleString('en-US')} rows.`
      );
    if (
      sheet.metadata &&
      !parseWorkbookMetadata(JSON.stringify(sheet.metadata))
    )
      throw new Error('Invalid workbook metadata.');
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (!parseCellAddress(address))
        throw new Error(`Unsupported cell address ${sheet.name}!${address}.`);
      if (!isSpreadsheetCellStyle(cell))
        throw new Error('The workbook contains unsupported cell formatting.');
      if (cell.value.length > SPREADSHEET_MAX_CELL_LENGTH)
        throw new Error(
          `Cell ${sheet.name}!${address} exceeds 10,000 characters.`
        );
      contentSize += encoder.encode(cell.value).byteLength;
      if (contentSize > XLSX_MAX_EXPANDED_BYTES)
        throw new Error('The workbook exceeds the Excel content limit.');
    }
  }
  const workbookFont = input.sheets.find((sheet) => sheet.metadata?.defaultFont)
    ?.metadata?.defaultFont ?? { name: 'Arial', size: 10 };
  const styles = new StyleTable(workbookFont);
  const strings = new SharedStrings();
  const rangeNames = new Set(
    input.sheets.flatMap((sheet) =>
      (sheet.metadata?.definedNames ?? [])
        .filter((entry) => entry.formula.includes(':'))
        .map((entry) => entry.name.toLowerCase())
    )
  );
  let dynamicArrays = false;
  const firstVisible = Math.max(
    0,
    input.sheets.findIndex((sheet) => !sheet.metadata?.hidden)
  );
  const files: Record<string, Uint8Array> = {};
  // Sheets with notes, by 1-based number.
  const noted: number[] = [];
  // Drawing parts by number, chart parts, and images written once each.
  let drawingCount = 0;
  let chartCount = 0;
  const media = new Map<string, string | undefined>();
  const imageExtensions = new Set<string>();
  // Pivot tables, each with its own cache, numbered from 1.
  let pivotCount = 0;
  // Pivot charts stay linked only to pivot tables the download contains.
  const pivotNames = new Set(
    input.sheets.flatMap((sheet) =>
      (sheet.metadata?.pivotTables ?? []).map(
        (pivot) =>
          `${sheet.name.toLowerCase()}!${pivotTableName(pivot)?.toLowerCase()}`
      )
    )
  );
  const pivotExists = (sheet: string, name: string) =>
    pivotNames.has(`${sheet.toLowerCase()}!${name.toLowerCase()}`);
  const writeImage = (key: string) => {
    if (media.has(key)) return media.get(key);
    const url = input.images?.[key];
    const file = url ? imageFile(url) : undefined;
    let path: string | undefined;
    if (file) {
      path = `xl/media/image${media.size + 1}.${file.extension}`;
      files[path] = file.bytes;
      imageExtensions.add(file.extension);
    } else
      warnings.add('Some images were missing and are not in the download.');
    media.set(key, path);
    return path;
  };
  input.sheets.forEach((sheet, sheetIndex) => {
    const metadata = sheet.metadata ?? {};
    const values = sheet.values ?? {};
    const arrays = metadata.arrayFormulas ?? {};
    // Rows of [column, xml], built once and sorted by position.
    const rows = new Map<number, [number, string][]>();
    const add = (row: number, column: number, xml: string) => {
      let cells = rows.get(row);
      if (!cells) {
        cells = [];
        rows.set(row, cells);
      }
      cells.push([column, xml]);
    };
    const occupied = new Set<string>();
    let maxRow = 0;
    let maxColumn = 0;
    const children = new Map<string, CalculatedCell>();
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const position = parseCellAddress(address)!;
      const calculated = values[address];
      const written = writtenValue(cell, calculated, warnings);
      const dateMention = exportedDateMention(cell, calculated) !== undefined;
      const s = styles.index(
        dateMention && (!cell.format || cell.format === 'general')
          ? { ...cell, format: 'date' }
          : cell,
        metadata.defaultFont
      );
      let xml: string | undefined;
      const reference = formatCellAddress(position.row, position.column);
      switch (written.kind) {
        case 'empty':
          if (s) xml = `<c r="${reference}" s="${s}"/>`;
          break;
        case 'number':
          xml = `<c r="${reference}"${s ? ` s="${s}"` : ''}><v>${numberText(written.value)}</v></c>`;
          break;
        case 'boolean':
          xml = `<c r="${reference}"${s ? ` s="${s}"` : ''} t="b"><v>${written.value ? 1 : 0}</v></c>`;
          break;
        case 'error':
          xml = `<c r="${reference}"${s ? ` s="${s}"` : ''} t="e"><v>${escapeXml(written.value)}</v></c>`;
          break;
        case 'string':
          xml = `<c r="${reference}"${s ? ` s="${s}"` : ''} t="s"><v>${strings.index(written.value)}</v></c>`;
          break;
        case 'formula': {
          const result = written.result;
          const legacy = arrays[address];
          const spill = result?.spill;
          const dynamic =
            !legacy &&
            (!!spill || needsArrayEvaluation(written.formula, rangeNames));
          const formula = escapeXml(
            addFunctionPrefixes(
              exportImplicitIntersections(
                written.formula,
                rangeNames,
                !legacy && !dynamic
              )
            )
          );
          let attributes = '';
          let array = '';
          if (legacy) array = ` t="array" ref="${legacy}"`;
          else if (dynamic) {
            dynamicArrays = true;
            attributes = ' cm="1"';
            array = ` t="array" ref="${
              spill
                ? `${reference}:${formatCellAddress(position.row + spill.rows - 1, position.column + spill.columns - 1)}`
                : reference
            }"`;
          }
          if (spill || legacy) {
            const range =
              legacy ??
              `${reference}:${formatCellAddress(position.row + spill!.rows - 1, position.column + spill!.columns - 1)}`;
            const [, last = range] = range.split(':');
            const end = parseCellAddress(last);
            if (end)
              for (let r = position.row; r <= end.row; r++)
                for (let c = position.column; c <= end.column; c++) {
                  const child = formatCellAddress(r, c);
                  if (child !== address && values[child])
                    children.set(child, values[child]);
                }
          }
          let cached = '';
          let type = '';
          if (result?.error) {
            type = ' t="e"';
            cached = `<v>${escapeXml(result.display)}</v>`;
          } else if (result?.type === 'boolean') {
            type = ' t="b"';
            cached = `<v>${result.value ? 1 : 0}</v>`;
          } else if (result?.number !== undefined)
            cached = `<v>${numberText(result.number)}</v>`;
          else if (result) {
            type = ' t="str"';
            cached = `<v>${escapeText(String(result.value ?? result.display))}</v>`;
          }
          xml = `<c r="${reference}"${s ? ` s="${s}"` : ''}${type}${attributes}><f${array}>${formula}</f>${cached}</c>`;
          break;
        }
      }
      if (!xml) continue;
      occupied.add(address);
      add(position.row, position.column, xml);
      maxRow = Math.max(maxRow, position.row);
      maxColumn = Math.max(maxColumn, position.column);
    }
    // Array results: Excel stores each result cell's cached value.
    for (const [address, value] of children) {
      if (occupied.has(address)) continue;
      const position = parseCellAddress(address);
      if (!position) continue;
      const cached = value.error
        ? `t="e"><v>${escapeXml(value.display)}</v>`
        : value.type === 'boolean'
          ? `t="b"><v>${value.value ? 1 : 0}</v>`
          : value.number !== undefined
            ? `><v>${numberText(value.number)}</v>`
            : `t="str"><v>${escapeText(String(value.value ?? value.display))}</v>`;
      add(
        position.row,
        position.column,
        `<c r="${address}" ${cached}</c>`.replace(' >', '>')
      );
      maxRow = Math.max(maxRow, position.row);
      maxColumn = Math.max(maxColumn, position.column);
    }
    const heights = metadata.rowHeights ?? {};
    // Import drops heights equal to the sheet's default, so pick a default
    // that no stored height uses.
    const defaultRowHeight =
      [15, 15.75, 14.25, 16.5].find((candidate) =>
        Object.values(heights).every(
          (height) => Math.abs(height - candidate) > 0.01
        )
      ) ?? 15;
    const hiddenRows = new Set(metadata.hiddenRows ?? []);
    for (const row of [...Object.keys(heights).map(Number), ...hiddenRows])
      if (!rows.has(row) && row < SPREADSHEET_MAX_ROWS) rows.set(row, []);
    const rowXml = [...rows.keys()]
      .sort((a, b) => a - b)
      .map((row) => {
        const cells = rows.get(row)!;
        cells.sort((a, b) => a[0] - b[0]);
        const height = heights[row];
        return `<row r="${row + 1}"${height !== undefined ? ` ht="${numberText(height)}" customHeight="1"` : ''}${hiddenRows.has(row) ? ' hidden="1"' : ''}>${cells.map(([, xml]) => xml).join('')}</row>`;
      })
      .join('');
    if (sheet.rowCount > Math.max(200, maxRow + 1))
      warnings.add(
        'Extra blank rows beyond the used range are not preserved when importing this Excel file back into Macro.'
      );
    const hiddenColumns = new Set(metadata.hiddenColumns ?? []);
    const widthColumns = new Set([
      ...Object.keys(sheet.columnWidths).map(Number),
      ...hiddenColumns,
    ]);
    const cols = [...widthColumns]
      .filter(
        (column) =>
          Number.isInteger(column) &&
          column >= 0 &&
          column < SPREADSHEET_MAX_COLUMNS
      )
      .sort((a, b) => a - b)
      .map((column) => {
        const pixels = sheet.columnWidths[column];
        // Excel adds 5px of padding from one character on; narrower columns
        // scale by 12px per character.
        const width = Number.isFinite(pixels)
          ? Math.round((pixels < 12 ? pixels / 12 : (pixels - 5) / 7) * 256) /
            256
          : 8.43;
        return `<col min="${column + 1}" max="${column + 1}" width="${width}"${Number.isFinite(pixels) ? ' customWidth="1"' : ''}${hiddenColumns.has(column) ? ' hidden="1"' : ''}/>`;
      })
      .join('');
    const merges: string[] = [];
    for (const range of metadata.merges ?? []) {
      const [a, b = a] = range.split(':');
      const first = parseCellAddress(a)!;
      const last = parseCellAddress(b)!;
      let blocked = false;
      for (let r = first.row; r <= last.row && !blocked; r++)
        for (let c = first.column; c <= last.column; c++)
          if (
            (r !== first.row || c !== first.column) &&
            sheet.cells[formatCellAddress(r, c)]?.value
          ) {
            blocked = true;
            break;
          }
      if (blocked)
        warnings.add(
          `Merge ${sheet.name}!${range} was omitted to preserve values entered in its covered cells.`
        );
      else merges.push(`<mergeCell ref="${range}"/>`);
    }
    const freeze = metadata.freeze;
    const pane =
      freeze && (freeze.rows || freeze.columns)
        ? `<pane${freeze.columns ? ` xSplit="${freeze.columns}"` : ''}${freeze.rows ? ` ySplit="${freeze.rows}"` : ''} topLeftCell="${formatCellAddress(freeze.rows, freeze.columns)}" activePane="${freeze.rows && freeze.columns ? 'bottomRight' : freeze.rows ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
        : '';
    const notes = notesParts(metadata.notes, sheetIndex + 1);
    const readValues = chartValues(input.sheets, sheet);
    const width = (column: number) =>
      sheet.columnWidths[column] ?? DEFAULT_COLUMN_WIDTH;
    const height = (row: number) => (heights[row] ?? defaultRowHeight) / 0.75;
    const drawing = metadata.drawings?.length
      ? drawingPart({
          drawings: metadata.drawings,
          image: writeImage,
          chart: (chart) => {
            const path = `xl/charts/chart${++chartCount}.xml`;
            files[path] = strToU8(chartPart(chart, readValues, pivotExists));
            return path;
          },
          size: (value: SheetDrawing) => {
            if (!value.to)
              return { width: value.width ?? 0, height: value.height ?? 0 };
            let horizontal = value.to.x - value.from.x;
            for (
              let column = value.from.column;
              column < value.to.column;
              column++
            )
              horizontal += width(column);
            let vertical = value.to.y - value.from.y;
            for (let row = value.from.row; row < value.to.row; row++)
              vertical += height(row);
            return {
              width: Math.max(1, horizontal),
              height: Math.max(1, vertical),
            };
          },
        })
      : undefined;
    const drawingNumber = drawing ? ++drawingCount : 0;
    // Relationships of the sheet: its drawing, then its notes' parts.
    const sheetRelations: string[] = [];
    const relate = (type: string, target: string) => {
      sheetRelations.push(
        `<Relationship Id="rId${sheetRelations.length + 1}" Type="${RELATIONSHIPS}/${type}" Target="${target}"/>`
      );
      return `rId${sheetRelations.length}`;
    };
    const drawingId = drawing
      ? relate('drawing', `../drawings/drawing${drawingNumber}.xml`)
      : undefined;
    const notesId = notes
      ? relate('vmlDrawing', `../drawings/vmlDrawing${sheetIndex + 1}.vml`)
      : undefined;
    if (notes) relate('comments', `../comments${sheetIndex + 1}.xml`);
    for (const pivot of metadata.pivotTables ?? []) {
      const parts = pivotParts(
        pivot,
        pivotCount + 1,
        (code) => styles.format(code),
        (style) => styles.dxf(style)
      );
      if (!parts) {
        warnings.add(
          'Some pivot tables lost their data and are downloaded as values.'
        );
        continue;
      }
      const number = ++pivotCount;
      files[`xl/pivotTables/pivotTable${number}.xml`] = strToU8(parts.table);
      files[`xl/pivotTables/_rels/pivotTable${number}.xml.rels`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_RELATIONSHIPS}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition${number}.xml"/></Relationships>`
      );
      files[`xl/pivotCache/pivotCacheDefinition${number}.xml`] = strToU8(
        parts.cache
      );
      relate('pivotTable', `../pivotTables/pivotTable${number}.xml`);
    }
    if (drawing) {
      files[`xl/drawings/drawing${drawingNumber}.xml`] = strToU8(drawing.xml);
      files[`xl/drawings/_rels/drawing${drawingNumber}.xml.rels`] = strToU8(
        drawing.rels
      );
    }
    const dimension =
      rows.size && occupied.size
        ? `A1:${formatCellAddress(maxRow, maxColumn)}`
        : 'A1';
    files[`xl/worksheets/sheet${sheetIndex + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}">${
        metadata.tabColor
          ? `<sheetPr><tabColor rgb="FF${metadata.tabColor.slice(1).toUpperCase()}"/></sheetPr>`
          : ''
      }<dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"${sheetIndex === firstVisible ? ' tabSelected="1"' : ''}${metadata.gridlines === false ? ' showGridLines="0"' : ''}${pane ? `>${pane}</sheetView>` : '/>'}</sheetViews><sheetFormatPr defaultColWidth="${DEFAULT_COLUMN_CHARACTERS}" defaultRowHeight="${defaultRowHeight}"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rowXml}</sheetData>${
        metadata.autoFilter ? `<autoFilter ref="${metadata.autoFilter}"/>` : ''
      }${merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}${conditionalFormattingXml(
        metadata.conditionalFormats,
        (style) => styles.dxf(style),
        addFunctionPrefixes
      )}${dataValidationsXml(metadata.validations, addFunctionPrefixes)}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${drawingId ? `<drawing r:id="${drawingId}"/>` : ''}${notesId ? `<legacyDrawing r:id="${notesId}"/>` : ''}</worksheet>`
    );
    if (notes) {
      const number = sheetIndex + 1;
      noted.push(number);
      files[`xl/comments${number}.xml`] = strToU8(notes.comments);
      files[`xl/drawings/vmlDrawing${number}.vml`] = strToU8(notes.drawing);
    }
    if (sheetRelations.length)
      files[`xl/worksheets/_rels/sheet${sheetIndex + 1}.xml.rels`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${sheetRelations.join('')}</Relationships>`
      );
  });
  const definedNames = input.sheets.flatMap((sheet, index) => [
    ...(sheet.metadata?.definedNames ?? []).map(
      (entry) =>
        `<definedName name="${escapeXml(entry.name)}"${entry.local ? ` localSheetId="${index}"` : ''}>${escapeXml(addFunctionPrefixes(entry.formula.replace(/^=/, '')))}</definedName>`
    ),
    ...(sheet.metadata?.autoFilter
      ? [
          `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${escapeXml(`${quoteSheet(sheet.name)}!${sheet.metadata.autoFilter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}`)}</definedName>`,
        ]
      : []),
  ]);
  const sheetEntries = input.sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${sheet.metadata?.hidden && index !== firstVisible ? ' state="hidden"' : ''} r:id="rId${index + 1}"/>`
    )
    .join('');
  const count = input.sheets.length;
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${noted.length ? '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' : ''}${[
      ...imageExtensions,
    ]
      .map(
        (extension) =>
          `<Default Extension="${extension}" ContentType="image/${extension}"/>`
      )
      .join('')}${Array.from(
      { length: drawingCount },
      (_, index) =>
        `<Override PartName="/xl/drawings/drawing${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
    ).join('')}${Array.from(
      { length: chartCount },
      (_, index) =>
        `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`
    ).join('')}${Array.from(
      { length: pivotCount },
      (_, index) =>
        `<Override PartName="/xl/pivotTables/pivotTable${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/><Override PartName="/xl/pivotCache/pivotCacheDefinition${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/>`
    ).join('')}${noted
      .map(
        (number) =>
          `<Override PartName="/xl/comments${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`
      )
      .join(
        ''
      )}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${input.sheets
      .map(
        (_, index) =>
          `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join(
        ''
      )}<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${dynamicArrays ? '<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
  );
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_RELATIONSHIPS}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${RELATIONSHIPS}/extended-properties" Target="docProps/app.xml"/></Relationships>`
  );
  files['docProps/app.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Macro</Application></Properties>`
  );
  files['docProps/core.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Macro</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`
  );
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><workbookPr/><bookViews><workbookView activeTab="${firstVisible}"/></bookViews><sheets>${sheetEntries}</sheets>${
      definedNames.length
        ? `<definedNames>${definedNames.join('')}</definedNames>`
        : ''
    }<calcPr calcId="191029" fullCalcOnLoad="1"/>${
      pivotCount
        ? `<pivotCaches>${Array.from(
            { length: pivotCount },
            (_, index) =>
              `<pivotCache cacheId="${index + 1}" r:id="rId${count + 5 + index}"/>`
          ).join('')}</pivotCaches>`
        : ''
    }</workbook>`
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${input.sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="${RELATIONSHIPS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
      )
      .join(
        ''
      )}<Relationship Id="rId${count + 1}" Type="${RELATIONSHIPS}/styles" Target="styles.xml"/><Relationship Id="rId${count + 2}" Type="${RELATIONSHIPS}/sharedStrings" Target="sharedStrings.xml"/>${dynamicArrays ? `<Relationship Id="rId${count + 3}" Type="${RELATIONSHIPS}/sheetMetadata" Target="metadata.xml"/>` : ''}<Relationship Id="rId${count + 4}" Type="${RELATIONSHIPS}/theme" Target="theme/theme1.xml"/>${Array.from(
      { length: pivotCount },
      (_, index) =>
        `<Relationship Id="rId${count + 5 + index}" Type="${RELATIONSHIPS}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition${index + 1}.xml"/>`
    ).join('')}</Relationships>`
  );
  // Charts without their own colors take them from the theme they came with.
  files['xl/theme/theme1.xml'] = strToU8(
    themePart(
      input.sheets
        .flatMap((sheet) => sheet.metadata?.drawings ?? [])
        .find((drawing) => drawing.type === 'chart')?.chart.colors
    )
  );
  files['xl/styles.xml'] = strToU8(styles.xml());
  files['xl/sharedStrings.xml'] = strToU8(strings.xml());
  if (dynamicArrays)
    files['xl/metadata.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<metadata xmlns="${MAIN}" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>`
    );
  const bytes = zipSync(files, { level: 6 });
  return { bytes, warnings: [...warnings] };
}
