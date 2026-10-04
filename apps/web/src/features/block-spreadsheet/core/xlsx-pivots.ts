import {
  MAX_PIVOT_PART_LENGTH,
  MAX_SHEET_PIVOT_TABLES,
  type SheetPivotTable,
} from '@macro-inc/spreadsheet/workbook-metadata';
import {
  formatCellAddress,
  parseCellAddress,
  SPREADSHEET_MAX_ROWS,
} from './spreadsheet-document';
import type { XlsxArchive } from './xlsx-archive';
import type { WorkbookTable } from './xlsx-formula';
import { attributes, parse, relationships } from './xlsx-parts';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIPS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const BUILTIN_FORMATS = 164;

const quoteSheet = (name: string) => `'${name.replaceAll("'", "''")}'`;

/** The element prefix a part uses for SpreadsheetML, with its colon. */
function mainPrefix(xml: string, root: string): string | undefined {
  const match = new RegExp(`<(?:([A-Za-z_][\\w.-]*):)?${root}\\b`).exec(xml);
  if (!match) return;
  const prefix = match[1];
  const declared = prefix
    ? new RegExp(`xmlns:${prefix}="${MAIN}"`).test(xml)
    : new RegExp(`xmlns="${MAIN}"`).test(xml);
  return declared ? (prefix ? `${prefix}:` : '') : undefined;
}

/** Remove an element and its content wherever it appears. */
function withoutElement(xml: string, element: string): string {
  return xml
    .replace(new RegExp(`<${element}\\b[^>]*/>`, 'g'), '')
    .replace(
      new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?</${element}>`, 'g'),
      ''
    );
}

/** Change, add or remove attributes of a part's root element. */
function withRootAttributes(
  xml: string,
  root: string,
  changes: Record<string, string | undefined>
): string {
  return xml.replace(new RegExp(`<${root}\\b[^>]*>`), (tag) => {
    let result = tag;
    for (const [name, value] of Object.entries(changes)) {
      const pattern = new RegExp(`\\s${name.replace('.', '\\.')}="[^"]*"`);
      if (value === undefined) result = result.replace(pattern, '');
      else if (pattern.test(result))
        result = result.replace(pattern, ` ${name}="${value}"`);
      else result = result.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);
    }
    return result;
  });
}

function text(part: Uint8Array) {
  return new TextDecoder().decode(part).replace(/^﻿?<\?xml[^>]*>\s*/, '');
}

/** What a cache definition reads, from its `cacheSource`. */
type CacheSource =
  | { kind: 'range'; sheet?: string; ref: string }
  | { kind: 'name'; name: string }
  | { kind: 'unsupported' };

function cacheSource(bytes: Uint8Array, path: string): CacheSource {
  let source: CacheSource = { kind: 'unsupported' };
  let type: string | undefined;
  parse(bytes, path, (parser) => {
    parser.on('opentag', (node) => {
      if (node.uri !== MAIN) return;
      const value = attributes(node);
      if (node.local === 'cacheSource') type = value.type;
      else if (node.local === 'worksheetSource' && type === 'worksheet') {
        // A source in another workbook has a relationship to it.
        if (
          Object.values(node.attributes).some(
            (item) => item.uri === RELATIONSHIPS
          )
        )
          return;
        if (value.ref)
          source = { kind: 'range', sheet: value.sheet, ref: value.ref };
        else if (value.name) source = { kind: 'name', name: value.name };
      }
    });
  });
  return source;
}

/** An absolute reference to a range, `'Sheet'!$A$1:$D$9` or `Sheet!$A:$D`. */
function sourceReference(sheet: string, ref: string): string | undefined {
  const cells = /^\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  if (cells)
    return `${quoteSheet(sheet)}!$${cells[1].toUpperCase()}$${cells[2]}:$${cells[3].toUpperCase()}$${cells[4]}`;
  const columns = /^\$?([A-Z]{1,3}):\$?([A-Z]{1,3})$/i.exec(ref);
  if (columns)
    return `${quoteSheet(sheet)}!$${columns[1].toUpperCase()}:$${columns[2].toUpperCase()}`;
}

/**
 * The pivot tables of a sheet, kept for export. Their cells already hold
 * the values Excel last showed; the parts let Excel rebuild them.
 */
export function readSheetPivotTables(options: {
  archive: XlsxArchive;
  sheetPath: string;
  sheetName: string;
  tables: WorkbookTable[];
  customFormat: (id: number) => string | undefined;
  warnings: Set<string>;
}): SheetPivotTable[] {
  const { archive, warnings } = options;
  const pivots: SheetPivotTable[] = [];
  let skipped = false;
  for (const relation of relationships(archive, options.sheetPath).values()) {
    if (relation.type !== 'pivotTable' || relation.external) continue;
    const tableBytes = archive.read(relation.target);
    const cacheTarget = [
      ...relationships(archive, relation.target).values(),
    ].find(
      (entry) => entry.type === 'pivotCacheDefinition' && !entry.external
    )?.target;
    const cacheBytes = cacheTarget && archive.read(cacheTarget);
    if (!tableBytes || !cacheTarget || !cacheBytes) {
      skipped = true;
      continue;
    }
    const source = cacheSource(cacheBytes, cacheTarget);
    let reference: string | undefined;
    if (source.kind === 'range')
      reference = sourceReference(
        source.sheet ?? options.sheetName,
        source.ref
      );
    else if (source.kind === 'name') {
      // Tables become ordinary cells, so a table source becomes its range.
      const table = options.tables.find(
        (entry) => entry.name.toLowerCase() === source.name.toLowerCase()
      );
      if (table?.headerRows)
        reference = sourceReference(
          table.sheet,
          `${formatCellAddress(table.top, table.left)}:${formatCellAddress(table.bottom - table.totalsRows, table.right)}`
        );
    }
    let table = text(tableBytes);
    let cache = text(cacheBytes);
    const tablePrefix = mainPrefix(table, 'pivotTableDefinition');
    const cachePrefix = mainPrefix(cache, 'pivotCacheDefinition');
    const location = new RegExp(
      `<${tablePrefix ?? ''}location\\b[^>]*\\sref="([^"]+)"`
    ).exec(table)?.[1];
    const [start, end = start] = (location ?? '').split(':');
    const first = parseCellAddress(start);
    const last = parseCellAddress(end);
    if (
      source.kind === 'unsupported' ||
      (source.kind === 'range' && !reference) ||
      (source.kind === 'name' &&
        !reference &&
        options.tables.some(
          (entry) => entry.name.toLowerCase() === source.name.toLowerCase()
        )) ||
      tablePrefix === undefined ||
      cachePrefix === undefined ||
      !first ||
      !last ||
      last.row >= SPREADSHEET_MAX_ROWS
    ) {
      skipped = true;
      continue;
    }
    // Formats of pivot areas refer to the workbook's differential formats,
    // which export writes anew; Excel applies the table's style instead.
    for (const element of ['formats', 'conditionalFormats'])
      table = withoutElement(table, `${tablePrefix}${element}`);
    if (/\bdxfId="/.test(table))
      table = withoutElement(table, `${tablePrefix}extLst`);
    // Without its records, Excel reads the source again when the file opens.
    const relationshipPrefix = new RegExp(
      `xmlns:([A-Za-z_][\\w.-]*)="${RELATIONSHIPS}"`
    ).exec(cache)?.[1];
    cache = withRootAttributes(cache, `${cachePrefix}pivotCacheDefinition`, {
      ...(relationshipPrefix && { [`${relationshipPrefix}:id`]: undefined }),
      saveData: '0',
      refreshOnLoad: '1',
    });
    // Custom number formats are numbered in order of use, as export
    // numbers them again; unknown ones show as General.
    const formats: Record<string, string> = {};
    const numbers = new Map<string, string>();
    const renumbered = (part: string) =>
      part.replace(/\bnumFmtId="(\d+)"/g, (attribute, id: string) => {
        if (Number(id) < BUILTIN_FORMATS) return attribute;
        let number = numbers.get(id);
        if (number === undefined) {
          const code = options.customFormat(Number(id));
          if (!code) return 'numFmtId="0"';
          number = String(BUILTIN_FORMATS + numbers.size);
          numbers.set(id, number);
          formats[number] = code;
        }
        return `numFmtId="${number}"`;
      });
    // Export numbers caches anew.
    table = renumbered(
      withRootAttributes(table, `${tablePrefix}pivotTableDefinition`, {
        cacheId: '0',
      })
    );
    cache = renumbered(cache);
    // The source as export writes it: tables become their cells.
    if (reference) cache = withSource(cache, cachePrefix, reference) ?? cache;
    if (
      table.length > MAX_PIVOT_PART_LENGTH ||
      cache.length > MAX_PIVOT_PART_LENGTH ||
      pivots.length >= MAX_SHEET_PIVOT_TABLES
    ) {
      skipped = true;
      continue;
    }
    const from = formatCellAddress(first.row, first.column);
    const to = formatCellAddress(last.row, last.column);
    const cells = from === to ? from : `${from}:${to}`;
    pivots.push({
      table: withLocation(table, tablePrefix, cells),
      cache,
      location: cells,
      ...(reference && { source: reference }),
      ...(Object.keys(formats).length && { formats }),
    });
  }
  if (pivots.length)
    warnings.add(
      'Pivot tables show their last values in Macro; Excel rebuilds them from their data when the downloaded file opens.'
    );
  if (skipped)
    warnings.add(
      'Pivot tables from other workbooks, data connections or very large layouts keep only their last values.'
    );
  return pivots;
}

/** Split an absolute source reference into `worksheetSource` attributes. */
function sourceAttributes(source: string) {
  const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(source);
  if (!match) return;
  const ref = match[3].replace(/\$/g, '');
  if (!/^[A-Z]{1,3}\d*:[A-Z]{1,3}\d*$/i.test(ref)) return;
  return { sheet: match[1]?.replace(/''/g, "'") ?? match[2], ref };
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

/** A table definition covering `location`. */
function withLocation(table: string, prefix: string, location: string) {
  return table.replace(
    new RegExp(`(<${prefix}location\\b[^>]*\\sref=")[^"]*"`),
    `$1${location}"`
  );
}

/** A cache definition reading `source`, or undefined if it is not a range. */
function withSource(
  cache: string,
  prefix: string,
  source: string
): string | undefined {
  const attributes = sourceAttributes(source);
  if (!attributes) return;
  return cache.replace(
    new RegExp(
      `<${prefix}worksheetSource\\b[^>]*?(?:/>|>[\\s\\S]*?</${prefix}worksheetSource>)`
    ),
    `<${prefix}worksheetSource ref="${attributes.ref}" sheet="${escapeAttribute(attributes.sheet)}"/>`
  );
}

/** The table's name, for pivot charts that refer to it. */
export function pivotTableName(pivot: SheetPivotTable): string | undefined {
  return /<(?:[\w.-]+:)?pivotTableDefinition\b[^>]*\sname="([^"]*)"/.exec(
    pivot.table
  )?.[1];
}

/**
 * The parts of a pivot table for export, with its cache's id, its location
 * and source as they are now, and its number formats in the new workbook.
 * Undefined when its source no longer exists.
 */
export function pivotParts(
  pivot: SheetPivotTable,
  cacheId: number,
  format: (code: string) => number
): { table: string; cache: string } | undefined {
  const tablePrefix = mainPrefix(pivot.table, 'pivotTableDefinition');
  const cachePrefix = mainPrefix(pivot.cache, 'pivotCacheDefinition');
  if (tablePrefix === undefined || cachePrefix === undefined) return;
  const numberFormats = (part: string) =>
    part.replace(/\bnumFmtId="(\d+)"/g, (attribute, id: string) => {
      const code = pivot.formats?.[id];
      return code ? `numFmtId="${format(code)}"` : attribute;
    });
  const table = numberFormats(
    withLocation(
      withRootAttributes(pivot.table, `${tablePrefix}pivotTableDefinition`, {
        cacheId: String(cacheId),
      }),
      tablePrefix,
      pivot.location
    )
  );
  let cache = numberFormats(pivot.cache);
  if (pivot.source) {
    const sourced = withSource(cache, cachePrefix, pivot.source);
    if (!sourced) return;
    cache = sourced;
  }
  const declaration =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return { table: `${declaration}${table}`, cache: `${declaration}${cache}` };
}
