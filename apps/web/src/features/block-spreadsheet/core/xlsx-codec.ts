import type { Cell, CellValue, Workbook, Worksheet } from 'exceljs';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import {
  formatCellAddress,
  isSpreadsheetCellStyle,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseCellAddress,
  SPREADSHEET_COLUMNS,
  SPREADSHEET_MAX_CELL_LENGTH,
  SPREADSHEET_MAX_ROWS,
  SPREADSHEET_ROWS,
  type SpreadsheetCell,
  type SpreadsheetCells,
} from './spreadsheet-document';
import {
  type WorkbookFileData,
  type WorkbookFileExport,
  type WorkbookFileSheet,
  XLSX_MAX_BYTES,
  XLSX_MAX_EXPANDED_BYTES,
  XLSX_MAX_SHEETS,
} from './workbook-file-types';
import { inspectXlsxArchive, xlsxFeatureWarnings } from './xlsx-archive';
import { readXlsxStyle, readXlsxTheme, writeXlsxStyle } from './xlsx-styles';

async function newWorkbook(): Promise<Workbook> {
  const excel = await import('exceljs');
  return new (excel.default?.Workbook ?? excel.Workbook)();
}
function boundedSheet(name: string, row: number, column: number) {
  if (row > SPREADSHEET_MAX_ROWS || column > SPREADSHEET_COLUMNS)
    throw new Error(
      `“${name}” exceeds the supported 1,000 rows or 26 columns. No sheets were imported.`
    );
}
function readCellValue(cell: Cell, warnings: Set<string>): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date)
    return String(value.getTime() / 86_400_000 + 25569);
  if (typeof value === 'string') {
    // Preserve the stored string type even if it resembles a number/formula/date.
    return cell.numFmt === '@' ? value : `'${value}`;
  }
  if ('formula' in value || 'sharedFormula' in value) {
    return `=${cell.formula}`;
  }
  if ('richText' in value) {
    warnings.add(
      'Rich text is imported as plain text with the cell’s formatting.'
    );
    const text = value.richText.map((part) => part.text).join('');
    return cell.numFmt === '@' ? text : `'${text}`;
  }
  if ('hyperlink' in value) {
    warnings.add(
      'Hyperlinks are imported as display text; link targets are not retained.'
    );
    return cell.numFmt === '@' ? value.text : `'${value.text}`;
  }
  warnings.add('Stored error cells are imported as literal error text.');
  return `'${value.error}`;
}
// These functions natively return dynamic arrays. Traditional CSE formulas can
// require implicit intersection, repetition or fixed-size truncation, none of
// which the current document model stores. Reject those rather than changing them.
const spillFunctions = new Set([
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
function arrayFormulaChildren(
  sheet: Worksheet,
  warnings: Set<string>
): Set<string> {
  const children = new Set<string>();
  const occupied = new Set<string>();
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      const value = cell.value;
      if (
        !value ||
        typeof value !== 'object' ||
        !('shareType' in value) ||
        value.shareType !== 'array'
      )
        return;
      const functionName = /^\s*(?:_xlfn\.)?(?:_xlws\.)?([A-Z]+)\s*\(/i
        .exec(cell.formula)?.[1]
        .toUpperCase();
      if (!functionName || !spillFunctions.has(functionName))
        throw new Error(
          `Legacy fixed-range array formula at ${sheet.name}!${cell.address} is not supported. Convert it to a dynamic spill formula or values before importing. No sheets were imported.`
        );
      const ref =
        'ref' in value && typeof value.ref === 'string' ? value.ref : '';
      const parts = ref.replaceAll('$', '').split(':');
      const first = parts.length <= 2 ? parseCellAddress(parts[0]) : undefined;
      const last = parseCellAddress(parts[1] ?? parts[0]);
      if (
        !first ||
        !last ||
        first.row > last.row ||
        first.column > last.column ||
        formatCellAddress(first.row, first.column) !== cell.address
      )
        throw new Error(
          `Invalid or oversized array formula range at ${sheet.name}!${cell.address}. No sheets were imported.`
        );
      for (let row = first.row; row <= last.row; row++) {
        for (let column = first.column; column <= last.column; column++) {
          const address = formatCellAddress(row, column);
          if (occupied.has(address))
            throw new Error(
              `Overlapping array formula ranges in ${sheet.name}. No sheets were imported.`
            );
          occupied.add(address);
          if (address === cell.address) continue;
          const child = sheet.getCell(address);
          if (child.formula || child.isMerged)
            throw new Error(
              `Conflicting formula or merged cell in array range ${sheet.name}!${ref}. No sheets were imported.`
            );
          children.add(address);
        }
      }
      warnings.add(
        'Dynamic array formulas are recalculated by Macro; cached spill values are discarded and their cell formatting is retained.'
      );
    })
  );
  return children;
}
function stringLikeValue(value: CellValue): boolean {
  return (
    typeof value === 'string' ||
    (!!value &&
      typeof value === 'object' &&
      ('richText' in value || 'hyperlink' in value))
  );
}

function readSheet(
  sheet: Worksheet,
  theme: (string | undefined)[],
  warnings: Set<string>
): WorkbookFileSheet {
  boundedSheet(sheet.name, sheet.rowCount, sheet.columnCount);
  const cells: SpreadsheetCells = {};
  const arrayChildren = arrayFormulaChildren(sheet, warnings);
  if (sheet.state !== 'visible')
    warnings.add('Hidden sheets are imported as visible tabs.');
  if (sheet.model.merges?.length)
    warnings.add(
      'Merged cells are unmerged; their value stays in the top-left cell.'
    );
  if (
    (sheet.views ?? []).some(
      (view) => view.state === 'frozen' || view.state === 'split'
    )
  )
    warnings.add('Frozen panes and split views are not imported.');
  if (sheet.autoFilter)
    warnings.add('Excel filters are not imported; all rows remain visible.');
  sheet.eachRow({ includeEmpty: true }, (row) => {
    if (row.height !== undefined)
      warnings.add('Custom row heights are reset to the editor’s row sizes.');
    if (row.hidden)
      warnings.add('Hidden rows and columns are imported as visible.');
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const value = arrayChildren.has(cell.address)
        ? ''
        : readCellValue(cell, warnings);
      if (value.length > SPREADSHEET_MAX_CELL_LENGTH)
        throw new Error(
          `Cell ${sheet.name}!${cell.address} exceeds 10,000 characters. No sheets were imported.`
        );
      const style = readXlsxStyle(cell, theme, warnings);
      if (
        style.format === 'text' &&
        cell.value !== null &&
        cell.value !== undefined &&
        !arrayChildren.has(cell.address) &&
        !stringLikeValue(cell.value)
      ) {
        delete style.format;
        warnings.add(
          'Text number formats on numeric, boolean, date or formula cells are reset to preserve the original value types.'
        );
      }
      if (cell.note) warnings.add('Cell comments and notes are not imported.');
      if (value || Object.keys(style).length)
        cells[cell.address] = { value, ...style };
    });
  });
  const columnWidths: Record<number, number> = {};
  for (let index = 1; index <= SPREADSHEET_COLUMNS; index++) {
    const column = sheet.getColumn(index);
    if (column.hidden)
      warnings.add('Hidden rows and columns are imported as visible.');
    if (column.width !== undefined) {
      const pixels = Math.round(column.width * 7 + 5);
      columnWidths[index - 1] = Math.max(
        MIN_COLUMN_WIDTH,
        Math.min(MAX_COLUMN_WIDTH, pixels)
      );
      if (pixels !== columnWidths[index - 1])
        warnings.add('Column widths are limited to 64–640 pixels.');
    }
  }
  return {
    name: sheet.name,
    cells,
    rowCount: Math.max(SPREADSHEET_ROWS, sheet.rowCount),
    columnWidths,
  };
}

/** Validate the same XML attribute values ExcelJS reads, before it expands ranges.
 * Unsupported range metadata is removed so even whole-sheet rules stay cheap. */
function prepareWorkbookXml(name: string, text: string, worksheet: boolean) {
  const parser = new SaxesParser();
  const fragments: string[] = [];
  let copiedThrough = 0;
  let skippedDepth = 0;
  let skipStart = 0;
  let rows = 0;
  let cells = 0;
  const sheetIds = new Set<number>();
  const replace = (start: number, end: number, replacement = '') => {
    fragments.push(text.slice(copiedThrough, start), replacement);
    copiedThrough = end;
  };
  const positiveInteger = (value: string | undefined) =>
    value && /^\d+$/.test(value) ? Number(value) : NaN;
  const address = (value: string) => {
    const match = /^([A-Z]+)([1-9]\d*)$/.exec(value.replaceAll('$', ''));
    if (!match) throw new Error(`Invalid cell reference in ${name}.`);
    let column = 0;
    for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
    boundedSheet(name, Number(match[2]), column);
  };
  parser.on('doctype', () => {
    throw new Error(`Unsupported XML document type in ${name}.`);
  });
  parser.on('error', () => {
    throw new Error(`Invalid XML in ${name}.`);
  });
  parser.on('opentag', (node) => {
    if (skippedDepth) {
      skippedDepth++;
      return;
    }
    const tag = node.name.split(':').at(-1);
    if (tag === 'definedNames' || tag === 'dataValidations') {
      // Literal '<' is forbidden in attributes, so this is the current tag start.
      skipStart = text.lastIndexOf('<', parser.position - 1);
      skippedDepth = 1;
      return;
    }
    const attributes = node.attributes;
    if (!worksheet) {
      if (tag !== 'sheet') return;
      const id = positiveInteger(attributes.sheetId);
      if (
        !Number.isInteger(id) ||
        id < 1 ||
        id > 0xffffffff ||
        sheetIds.has(id)
      )
        throw new Error(`Invalid sheet identifier in ${name}.`);
      sheetIds.add(id);
      if (sheetIds.size > XLSX_MAX_SHEETS)
        throw new Error(
          'Import up to 10 sheets at a time. No sheets were imported.'
        );
      // ExcelJS indexes an array by sheetId; IDs in valid files can be very sparse.
      // Formulas use sheet names and relationships use r:id, so dense IDs are safe.
      const escaped = (value: string) =>
        value
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('"', '&quot;')
          .replaceAll('\t', '&#9;')
          .replaceAll('\n', '&#10;')
          .replaceAll('\r', '&#13;');
      const normalized = Object.entries({
        ...attributes,
        sheetId: String(sheetIds.size),
      })
        .map(([key, value]) => ` ${key}="${escaped(value)}"`)
        .join('');
      replace(
        text.lastIndexOf('<', parser.position - 1),
        parser.position,
        `<${node.name}${normalized}${node.isSelfClosing ? '/' : ''}>`
      );
      return;
    }
    if (tag === 'row') {
      const row = positiveInteger(attributes.r);
      if (!Number.isInteger(row) || row < 1)
        throw new Error(`Invalid row in ${name}.`);
      boundedSheet(name, row, 0);
      boundedSheet(name, ++rows, 0);
    } else if (tag === 'c') {
      address(attributes.r ?? '');
      if (++cells > SPREADSHEET_MAX_ROWS * SPREADSHEET_COLUMNS)
        throw new Error(`Too many cells in ${name}. No sheets were imported.`);
    } else if (tag === 'col') {
      const first = positiveInteger(attributes.min);
      const last = positiveInteger(attributes.max);
      if (
        !Number.isInteger(first) ||
        !Number.isInteger(last) ||
        first < 1 ||
        first > last
      )
        throw new Error(`Invalid column in ${name}.`);
      boundedSheet(name, 0, last);
    } else if (tag === 'mergeCell' || (tag === 'f' && attributes.t === 'array'))
      for (const part of (attributes.ref ?? '').split(':')) address(part);
  });
  parser.on('closetag', () => {
    if (skippedDepth && --skippedDepth === 0)
      replace(skipStart, parser.position);
  });
  parser.write(text).close();
  return fragments.length
    ? fragments.join('') + text.slice(copiedThrough)
    : text;
}

/** Parse entirely off-document; nothing is persisted until the caller confirms. */
export async function decodeXlsx(bytes: Uint8Array): Promise<WorkbookFileData> {
  const archive = inspectXlsxArchive(bytes);
  const warnings = new Set(xlsxFeatureWarnings(archive.files));
  // ExcelJS uses an unanchored worksheet-path match. Reject aliases it would
  // parse outside the canonical entries covered by the preflight checks below.
  for (const name of Object.keys(archive.files))
    if (
      /xl\/worksheets\/sheet\d+\.xml/.test(name) &&
      !/^xl\/worksheets\/sheet\d+\.xml$/.test(name)
    )
      throw new Error('This workbook contains an invalid worksheet path.');
  const worksheets = Object.entries(archive.files).filter(([name]) =>
    /^xl\/worksheets\/[^/]+\.xml$/.test(name)
  );
  if (worksheets.length > XLSX_MAX_SHEETS)
    throw new Error(
      'Import up to 10 sheets at a time. No sheets were imported.'
    );
  for (const [name, bytes] of worksheets)
    archive.files[name] = strToU8(
      prepareWorkbookXml(name, strFromU8(bytes), true)
    );
  archive.files['xl/workbook.xml'] = strToU8(
    prepareWorkbookXml(
      'xl/workbook.xml',
      strFromU8(archive.files['xl/workbook.xml']),
      false
    )
  );
  const workbook = await newWorkbook();
  try {
    // Only the bounded, sanitized entries reach ExcelJS and its ZIP reader.
    await workbook.xlsx.load(
      zipSync(archive.files, { level: 0 }).slice().buffer
    );
  } catch {
    throw new Error(
      'This Excel workbook could not be read. Choose an unencrypted .xlsx file.'
    );
  }
  if (
    !workbook.worksheets.length ||
    workbook.worksheets.length > XLSX_MAX_SHEETS
  )
    throw new Error('Import a workbook with 1–10 sheets.');
  const theme = readXlsxTheme(archive.files);
  return {
    sheets: workbook.worksheets.map((sheet) =>
      readSheet(sheet, theme, warnings)
    ),
    warnings: [...warnings],
  };
}
function exportValue(
  cell: SpreadsheetCell,
  calculated?: { display: string; number?: number; error?: string }
): CellValue {
  if (cell.format === 'text') return cell.value;
  if (cell.value.startsWith('='))
    return {
      formula: cell.value.slice(1),
      ...(calculated &&
        !calculated.error && {
          result: calculated.number ?? calculated.display,
        }),
    };
  if (cell.value.startsWith("'")) return cell.value.slice(1);
  if (/^(?:true|false)$/i.test(cell.value))
    return cell.value.toUpperCase() === 'TRUE';
  if (calculated?.number !== undefined) return calculated.number;
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.value.trim()))
    return Number(cell.value);
  return cell.value || null;
}

export async function encodeXlsx(
  input: Pick<WorkbookFileData, 'sheets'>
): Promise<WorkbookFileExport> {
  if (!input.sheets.length || input.sheets.length > XLSX_MAX_SHEETS)
    throw new Error('Export a workbook with 1–10 sheets.');
  let contentSize = 0;
  const encoder = new TextEncoder();
  for (const sheet of input.sheets) {
    if (
      !Number.isInteger(sheet.rowCount) ||
      sheet.rowCount < 1 ||
      sheet.rowCount > SPREADSHEET_MAX_ROWS
    )
      throw new Error('Sheets must have between 1 and 1,000 rows.');
    for (const cell of Object.values(sheet.cells)) {
      if (!isSpreadsheetCellStyle(cell))
        throw new Error('The workbook contains unsupported cell formatting.');
      contentSize += encoder.encode(cell.value).byteLength;
      if (contentSize > XLSX_MAX_EXPANDED_BYTES)
        throw new Error('The workbook exceeds the 20 MB content limit.');
    }
  }
  const workbook = await newWorkbook();
  workbook.creator = 'Macro';
  workbook.calcProperties.fullCalcOnLoad = true;
  const names = new Set<string>();
  const warnings = new Set<string>();
  for (const source of input.sheets) {
    if (
      !source.name ||
      source.name.length > 31 ||
      /[\\/?*:[\]]/.test(source.name) ||
      names.has(source.name.toLowerCase())
    )
      throw new Error(
        'Excel sheet names must be unique and up to 31 characters, without \\ / ? * : [ ].'
      );
    names.add(source.name.toLowerCase());
    boundedSheet(source.name, source.rowCount, SPREADSHEET_COLUMNS);
    const usedRows = Math.max(
      SPREADSHEET_ROWS,
      ...Object.keys(source.cells).map(
        (address) => (parseCellAddress(address)?.row ?? -1) + 1
      )
    );
    if (source.rowCount > usedRows)
      warnings.add(
        'Extra blank rows beyond the used range are not preserved when importing this Excel file back into Macro.'
      );
    const sheet = workbook.addWorksheet(source.name);
    for (const [address, cell] of Object.entries(source.cells)) {
      if (!parseCellAddress(address))
        throw new Error(`Unsupported cell address ${source.name}!${address}.`);
      if (cell.value.length > SPREADSHEET_MAX_CELL_LENGTH)
        throw new Error(
          `Cell ${source.name}!${address} exceeds 10,000 characters.`
        );
      const target = sheet.getCell(address);
      target.value = exportValue(cell, source.values?.[address]);
      target.style = writeXlsxStyle(cell);
    }
    for (const [column, pixels] of Object.entries(source.columnWidths)) {
      const index = Number(column);
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index < SPREADSHEET_COLUMNS &&
        Number.isFinite(pixels)
      )
        sheet.getColumn(index + 1).width = Math.max(1, (pixels - 5) / 7);
    }
  }
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  if (bytes.length > XLSX_MAX_BYTES)
    throw new Error(
      'The exported workbook exceeds the 5 MB file limit. Export a smaller workbook.'
    );
  // Ensure our exports obey the same archive bounds as files we can reopen.
  inspectXlsxArchive(bytes);
  return { bytes, warnings: [...warnings] };
}
