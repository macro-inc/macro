import { type SheetDrawing, validDrawings } from './sheet-drawings';
import {
  type ConditionalFormat,
  type DataValidation,
  MAX_SHEET_RULES,
  validConditionalFormat,
  validDataValidation,
  validNotes,
} from './sheet-rules';
import {
  parseCellAddress,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
} from './spreadsheet-document';

/** Excel layout and definitions retained independently from editable cell maps. */
export type WorkbookSheetMetadata = {
  merges?: string[];
  rowHeights?: Record<number, number>;
  hiddenRows?: number[];
  hiddenColumns?: number[];
  hidden?: boolean;
  freeze?: { rows: number; columns: number };
  autoFilter?: string;
  definedNames?: { name: string; formula: string; local?: boolean }[];
  /** Legacy (Ctrl+Shift+Enter) array formulas: anchor address → fixed range. */
  arrayFormulas?: Record<string, string>;
  /** False when Excel hid this sheet's gridlines. */
  gridlines?: boolean;
  /** Sheet tab color as #RRGGBB. */
  tabColor?: string;
  /** The imported workbook's default font, for cells without their own. */
  defaultFont?: { name: string; size: number };
  /** Excel notes by cell address. */
  notes?: Record<string, string>;
  /** Excel data validation rules. */
  validations?: DataValidation[];
  /** Excel conditional formatting rules, highest priority first. */
  conditionalFormats?: ConditionalFormat[];
  /** Images and charts drawn over the sheet. */
  drawings?: SheetDrawing[];
  /** Excel pivot tables, kept so export writes them back. */
  pivotTables?: SheetPivotTable[];
};

/**
 * An Excel pivot table, kept so export writes it back. Macro shows the
 * table's last values as cells; Excel rebuilds it from its source when the
 * exported file opens.
 */
export type SheetPivotTable = {
  /** The pivotTableDefinition part; export writes its cache and location. */
  table: string;
  /** The pivotCacheDefinition part, without the records Excel saved. */
  cache: string;
  /** The cells the table covers on its sheet. */
  location: string;
  /** The cells it summarizes, such as `'Orders'!$A$1:$F$500`. */
  source?: string;
  /** Custom number formats the parts use, by `numFmtId`. */
  formats?: Record<string, string>;
};
export const MAX_SHEET_PIVOT_TABLES = 64;
export const MAX_PIVOT_PART_LENGTH = 300_000;

function validPivotTable(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pivot = value as Record<string, unknown>;
  const formats = pivot.formats;
  return (
    Object.keys(pivot).every((key) =>
      ['table', 'cache', 'location', 'source', 'formats'].includes(key)
    ) &&
    typeof pivot.table === 'string' &&
    pivot.table.length <= MAX_PIVOT_PART_LENGTH &&
    pivot.table.includes('<pivotTableDefinition') &&
    typeof pivot.cache === 'string' &&
    pivot.cache.length <= MAX_PIVOT_PART_LENGTH &&
    pivot.cache.includes('<pivotCacheDefinition') &&
    validWorkbookRange(pivot.location) &&
    (pivot.source === undefined ||
      (typeof pivot.source === 'string' && pivot.source.length <= 1_000)) &&
    (formats === undefined ||
      (!!formats &&
        typeof formats === 'object' &&
        !Array.isArray(formats) &&
        Object.entries(formats).length <= 200 &&
        Object.entries(formats).every(
          ([id, code]) =>
            /^\d{1,5}$/.test(id) &&
            typeof code === 'string' &&
            code.length <= 255
        )))
  );
}

export function validWorkbookRange(range: unknown): range is string {
  if (typeof range !== 'string') return false;
  const parts = range.split(':');
  const first = parseCellAddress(parts[0]);
  const last = parseCellAddress(parts[1] ?? parts[0]);
  return (
    parts.length <= 2 &&
    !!first &&
    !!last &&
    first.row <= last.row &&
    first.column <= last.column
  );
}

export function parseWorkbookMetadata(
  encoded: unknown
): WorkbookSheetMetadata | undefined {
  if (typeof encoded !== 'string' || encoded.length > 1_000_000) return;
  try {
    const value = JSON.parse(encoded);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (
      Object.keys(value).some(
        (key) =>
          ![
            'merges',
            'rowHeights',
            'hiddenRows',
            'hiddenColumns',
            'hidden',
            'freeze',
            'autoFilter',
            'definedNames',
            'arrayFormulas',
            'gridlines',
            'tabColor',
            'defaultFont',
            'notes',
            'validations',
            'conditionalFormats',
            'drawings',
            'pivotTables',
          ].includes(key)
      )
    )
      return;
    const indices = (values: unknown, limit: number) =>
      values === undefined ||
      (Array.isArray(values) &&
        values.length <= limit &&
        values.every((v) => Number.isInteger(v) && v >= 0 && v < limit));
    if (
      value.merges !== undefined &&
      (!Array.isArray(value.merges) ||
        value.merges.length > 100_000 ||
        !value.merges.every(validWorkbookRange))
    )
      return;
    if (
      !indices(value.hiddenRows, SPREADSHEET_MAX_ROWS) ||
      !indices(value.hiddenColumns, SPREADSHEET_MAX_COLUMNS)
    )
      return;
    if (
      value.rowHeights !== undefined &&
      (!value.rowHeights ||
        typeof value.rowHeights !== 'object' ||
        Array.isArray(value.rowHeights) ||
        !Object.entries(value.rowHeights).every(
          ([key, height]) =>
            /^\d+$/.test(key) &&
            +key < SPREADSHEET_MAX_ROWS &&
            typeof height === 'number' &&
            Number.isFinite(height) &&
            height >= 0 &&
            height <= 409.5
        ))
    )
      return;
    if (value.hidden !== undefined && typeof value.hidden !== 'boolean') return;
    if (value.gridlines !== undefined && typeof value.gridlines !== 'boolean')
      return;
    if (
      value.defaultFont !== undefined &&
      (!value.defaultFont ||
        typeof value.defaultFont !== 'object' ||
        Object.keys(value.defaultFont).some(
          (key) => key !== 'name' && key !== 'size'
        ) ||
        typeof value.defaultFont.name !== 'string' ||
        !value.defaultFont.name ||
        value.defaultFont.name.length > 128 ||
        Array.from(value.defaultFont.name as string).some(
          (character) => character.charCodeAt(0) < 32
        ) ||
        !Number.isInteger(value.defaultFont.size) ||
        value.defaultFont.size < 8 ||
        value.defaultFont.size > 36)
    )
      return;
    if (
      value.tabColor !== undefined &&
      (typeof value.tabColor !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(value.tabColor))
    )
      return;
    if (
      value.freeze !== undefined &&
      (!value.freeze ||
        Object.keys(value.freeze).length !== 2 ||
        !Number.isInteger(value.freeze.rows) ||
        value.freeze.rows < 0 ||
        value.freeze.rows > SPREADSHEET_MAX_ROWS ||
        !Number.isInteger(value.freeze.columns) ||
        value.freeze.columns < 0 ||
        value.freeze.columns > SPREADSHEET_MAX_COLUMNS)
    )
      return;
    if (value.autoFilter !== undefined && !validWorkbookRange(value.autoFilter))
      return;
    if (value.notes !== undefined && !validNotes(value.notes)) return;
    if (value.drawings !== undefined && !validDrawings(value.drawings)) return;
    if (
      value.pivotTables !== undefined &&
      !(
        Array.isArray(value.pivotTables) &&
        value.pivotTables.length <= MAX_SHEET_PIVOT_TABLES &&
        value.pivotTables.every(validPivotTable)
      )
    )
      return;
    for (const [key, valid] of [
      ['validations', validDataValidation],
      ['conditionalFormats', validConditionalFormat],
    ] as const)
      if (
        value[key] !== undefined &&
        (!Array.isArray(value[key]) ||
          value[key].length > MAX_SHEET_RULES ||
          !value[key].every(valid))
      )
        return;
    if (
      value.definedNames !== undefined &&
      (!Array.isArray(value.definedNames) ||
        value.definedNames.length > 10_000 ||
        !value.definedNames.every((entry: unknown) => {
          if (
            !entry ||
            typeof entry !== 'object' ||
            Object.keys(entry).some(
              (key) => !['name', 'formula', 'local'].includes(key)
            )
          )
            return false;
          const { name, formula, local } = entry as Record<string, unknown>;
          return (
            typeof name === 'string' &&
            name.length > 0 &&
            name.length <= 255 &&
            typeof formula === 'string' &&
            formula.length <= 10_000 &&
            (local === undefined || typeof local === 'boolean')
          );
        }))
    )
      return;
    if (
      value.arrayFormulas !== undefined &&
      (!value.arrayFormulas ||
        typeof value.arrayFormulas !== 'object' ||
        Array.isArray(value.arrayFormulas) ||
        Object.keys(value.arrayFormulas).length > 100_000 ||
        !Object.entries(value.arrayFormulas).every(
          ([anchor, range]) =>
            !!parseCellAddress(anchor) &&
            validWorkbookRange(range) &&
            (range as string).split(':')[0] === anchor
        ))
    )
      return;
    return value;
  } catch {
    return;
  }
}

const SHEET_PREFIX = /^(?:\[0\]!)?(?:'((?:[^']|'')+)'|([^'!:\s()]+))!/;

/** A reference with its sheet renamed, when it names that sheet. */
function renamedReference(reference: string, from: string, to: string) {
  const match = SHEET_PREFIX.exec(reference);
  const sheet = match && (match[1]?.replace(/''/g, "'") ?? match[2]);
  if (!match || sheet?.toLowerCase() !== from.toLowerCase()) return reference;
  return `'${to.replaceAll("'", "''")}'!${reference.slice(match[0].length)}`;
}

/**
 * Metadata whose charts and pivot tables follow a renamed sheet, or
 * undefined when none refer to it. Formulas and names already block renames.
 */
export function renameSheetReferences(
  metadata: WorkbookSheetMetadata | undefined,
  from: string,
  to: string
): WorkbookSheetMetadata | undefined {
  if (!metadata) return;
  const rename = (reference: string) => renamedReference(reference, from, to);
  const escaped = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const result: WorkbookSheetMetadata = {
    ...metadata,
    ...(metadata.drawings && {
      drawings: metadata.drawings.map((drawing) => {
        if (drawing.type !== 'chart') return drawing;
        const { source } = drawing.chart;
        return {
          ...drawing,
          chart: {
            ...drawing.chart,
            references: drawing.chart.references.map(rename),
            // A pivot chart names its pivot table's sheet.
            ...(source && {
              source: source.replace(
                /(<(?:[\w.-]+:)?pivotSource>\s*<((?:[\w.-]+:)?name)>)(\[[^\]<]*\])?([^<]*)!([^<!]*)(<\/\2>)/,
                (
                  whole,
                  open,
                  _name,
                  book = '',
                  sheet: string,
                  table,
                  close
                ) => {
                  const unquoted = sheet
                    .replace(/^'(.*)'$/, '$1')
                    .replace(/''/g, "'")
                    .replace(/&apos;/g, "'")
                    .replace(/&amp;/g, '&');
                  return unquoted.toLowerCase() === from.toLowerCase()
                    ? `${open}${book}${escaped(/[^\w.]/.test(to) ? `'${to.replaceAll("'", "''")}'` : to)}!${table}${close}`
                    : whole;
                }
              ),
            }),
          },
        };
      }),
    }),
    ...(metadata.pivotTables && {
      pivotTables: metadata.pivotTables.map((pivot) =>
        pivot.source === undefined
          ? pivot
          : { ...pivot, source: rename(pivot.source) }
      ),
    }),
  };
  return JSON.stringify(result) === JSON.stringify(metadata)
    ? undefined
    : result;
}
