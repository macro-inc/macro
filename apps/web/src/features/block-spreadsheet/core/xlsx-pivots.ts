import type { ConditionalStyle } from '@macro-inc/spreadsheet/sheet-rules';
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

/** Why some pivot tables are downloaded without the data Excel saved. */
export const PIVOT_RECORDS_WARNING =
  'Some pivot tables over other workbooks or data connections are downloaded without the data Excel saved with them; Excel fills them again when they refresh.';

/** Why some pivot tables became ordinary cells. */
export const PIVOT_VALUES_WARNING =
  'Pivot tables over Power Query, the data model, OLAP cubes or consolidated ranges, and very large ones, keep only their last values.';

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
  /** Cells of another workbook, through the relationship named. */
  | { kind: 'workbook'; link: string }
  /** One of the workbook's data connections. */
  | { kind: 'connection'; id: string }
  | { kind: 'unsupported' };

function cacheSource(bytes: Uint8Array, path: string): CacheSource {
  let source: CacheSource = { kind: 'unsupported' };
  let type: string | undefined;
  let olap = false;
  parse(bytes, path, (parser) => {
    parser.on('opentag', (node) => {
      if (node.uri !== MAIN) return;
      const value = attributes(node);
      if (node.local === 'cacheSource') {
        type = value.type;
        if (type === 'external' && value.connectionId)
          source = { kind: 'connection', id: value.connectionId };
      } else if (node.local === 'worksheetSource' && type === 'worksheet') {
        // A source in another workbook has a relationship to it.
        const link = Object.values(node.attributes).find(
          (item) => item.uri === RELATIONSHIPS && item.local === 'id'
        )?.value;
        if (link) source = { kind: 'workbook', link };
        else if (value.ref)
          source = { kind: 'range', sheet: value.sheet, ref: value.ref };
        else if (value.name) source = { kind: 'name', name: value.name };
      } else if (node.local === 'cacheHierarchies') olap = true;
    });
  });
  // An OLAP cube's cache needs the server, or the data model, to show.
  return olap ? { kind: 'unsupported' } : source;
}

const connectionParts = new WeakMap<XlsxArchive, Map<string, string>>();

/**
 * The workbook's data connections by id, each a `connection` element that
 * declares the namespaces it uses, as `xl/connections.xml` holds them.
 */
function workbookConnections(archive: XlsxArchive): Map<string, string> {
  let connections = connectionParts.get(archive);
  if (connections) return connections;
  connections = new Map();
  connectionParts.set(archive, connections);
  const target = [...relationships(archive, 'xl/workbook.xml').values()].find(
    (entry) => entry.type === 'connections' && !entry.external
  )?.target;
  const bytes = target && archive.read(target);
  if (!bytes) return connections;
  const xml = text(bytes);
  const prefix = mainPrefix(xml, 'connections');
  if (prefix === undefined) return connections;
  const root =
    new RegExp(`<${prefix}connections\\b[^>]*>`).exec(xml)?.[0] ?? '';
  // Declarations and markup compatibility the root makes for its children.
  const inherited = [
    ...root.matchAll(/\s(xmlns:[\w.-]+|[\w.-]+:Ignorable)="[^"]*"/g),
  ];
  for (const [element] of xml.matchAll(
    new RegExp(
      `<${prefix}connection\\b[^>]*?(?:/>|>[\\s\\S]*?</${prefix}connection>)`,
      'g'
    )
  )) {
    const tag = /^<[^>]*?(?=\s*\/?>)/.exec(element)?.[0] ?? '';
    const id = /\sid="([^"]*)"/.exec(tag)?.[1];
    if (!id) continue;
    const declarations = inherited
      .filter(([, name]) => !tag.includes(` ${name}=`))
      .map(([declaration]) => declaration)
      .join('');
    connections.set(id, `${tag}${declarations}${element.slice(tag.length)}`);
  }
  return connections;
}

/**
 * Connections to the workbook's own data model or Power Query queries read
 * parts Macro does not keep.
 */
const internalConnection = (connection: string) =>
  /\$Workbook\$|ThisWorkbookDataModel|Data Model Connection|\smodel="1"/.test(
    connection
  );

/** XML attribute text, as written. */
function decodeAttribute(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * A connection without the password Excel may have saved with it: Excel
 * asks for it when the connection refreshes.
 */
function withoutPasswords(connection: string): {
  connection: string;
  removed: boolean;
} {
  let removed = false;
  const result = connection
    .replace(/(<(?:[\w.-]+:)?connection\b[^>]*?)\ssavePassword="[^"]*"/, '$1')
    .replace(
      /(<(?:[\w.-]+:)?dbPr\b[^>]*?\sconnection=")([^"]*)"/,
      (_, start: string, value: string) => {
        const text = decodeAttribute(value);
        const kept = text
          .split(';')
          .filter((part) => !/^\s*(?:password|pwd)\s*=/i.test(part))
          .join(';');
        if (kept !== text) removed = true;
        return `${start}${escapeAttribute(kept)}"`;
      }
    );
  return { connection: result, removed: removed || result !== connection };
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
  /** A differential format by its `dxfId`. */
  differential: (index: number) => ConditionalStyle | undefined;
  warnings: Set<string>;
}): SheetPivotTable[] {
  const { archive, warnings } = options;
  const pivots: SheetPivotTable[] = [];
  let skipped = false;
  let removedPasswords = false;
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
    const cacheRelations = relationships(archive, cacheTarget);
    let reference: string | undefined;
    // A source Macro does not hold: the cache keeps what Excel saved of it.
    let workbook: string | undefined;
    let connection: string | undefined;
    if (source.kind === 'workbook') {
      const link = cacheRelations.get(source.link);
      // Excel marks a link whose file it could not find as missing; the
      // download links it as usual, for Excel to look for it again.
      if (
        link?.external &&
        (link.type === 'externalLinkPath' || link.type === 'xlPathMissing') &&
        link.target
      )
        workbook = link.target;
    } else if (source.kind === 'connection') {
      const found = workbookConnections(archive).get(source.id);
      if (found && !internalConnection(found)) {
        const cleaned = withoutPasswords(found);
        // Export numbers connections anew.
        connection = cleaned.connection.replace(
          /^(<[^>]*?\s)id="[^"]*"/,
          '$1id="0"'
        );
        if (cleaned.removed) removedPasswords = true;
      }
    }
    const cached = workbook !== undefined || connection !== undefined;
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
      ((source.kind === 'workbook' || source.kind === 'connection') &&
        !cached) ||
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
    // which export writes anew: keep each, numbered in order of use.
    // Equal formats share one number, as export writes each once.
    const styles: ConditionalStyle[] = [];
    const differentials = new Map<string, number>();
    table = table.replace(/\bdxfId="(\d+)"/g, (_, id: string) => {
      const style = options.differential(Number(id)) ?? {};
      const key = JSON.stringify(style);
      let index = differentials.get(key);
      if (index === undefined) {
        index = styles.length;
        differentials.set(key, index);
        styles.push(style);
      }
      return `dxfId="${index}"`;
    });
    // A custom pivot style is not written; Excel's default takes its place.
    table = table.replace(
      new RegExp(
        `(<${tablePrefix}pivotTableStyleInfo\\b[^>]*\\sname=")([^"]*)"`
      ),
      (whole, start: string, name: string) =>
        /^PivotStyle(?:Light|Medium|Dark)\d+$/.test(name)
          ? whole
          : `${start}PivotStyleLight16"`
    );
    // Without its records, Excel reads the source again when the file opens.
    // A source Macro does not hold keeps the records Excel saved, when they
    // fit, and Excel refreshes it only when asked to.
    const relationshipPrefix = new RegExp(
      `xmlns:([A-Za-z_][\\w.-]*)="${RELATIONSHIPS}"`
    ).exec(cache)?.[1];
    let records: string | undefined;
    if (cached) {
      const target = [...cacheRelations.values()].find(
        (entry) => entry.type === 'pivotCacheRecords' && !entry.external
      )?.target;
      const bytes = target && archive.read(target);
      const saved = bytes && text(bytes);
      if (saved && saved.length <= MAX_PIVOT_PART_LENGTH) records = saved;
      else if (saved) warnings.add(PIVOT_RECORDS_WARNING);
    }
    cache = withRootAttributes(cache, `${cachePrefix}pivotCacheDefinition`, {
      ...(relationshipPrefix && { [`${relationshipPrefix}:id`]: undefined }),
      ...(!cached && { refreshOnLoad: '1' }),
      ...(!records && { saveData: '0' }),
    });
    // Export writes the link to the other workbook anew.
    if (workbook && relationshipPrefix)
      cache = cache.replace(
        new RegExp(
          `(<${cachePrefix}worksheetSource\\b[^>]*?)\\s${relationshipPrefix}:id="[^"]*"`
        ),
        '$1'
      );
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
    if (connection)
      cache = cache.replace(
        new RegExp(
          `(<${cachePrefix}cacheSource\\b[^>]*?\\sconnectionId=")[^"]*"`
        ),
        (_, start: string) => `${start}0"`
      );
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
      ...(records && { records }),
      ...(workbook && { workbook }),
      ...(connection && { connection }),
      ...(Object.keys(formats).length && { formats }),
      ...(styles.length && { styles }),
    });
  }
  if (pivots.some((pivot) => !pivot.workbook && !pivot.connection))
    warnings.add(
      'Pivot tables show their last values in Macro; Excel rebuilds them from their data when the downloaded file opens.'
    );
  if (pivots.some((pivot) => pivot.workbook || pivot.connection))
    warnings.add(
      'Pivot tables over other workbooks or data connections show their last values in Macro; the download keeps them with the data Excel saved, to refresh in Excel.'
    );
  if (removedPasswords)
    warnings.add(
      'Passwords saved with data connections are not kept; Excel asks for them when it refreshes a pivot table.'
    );
  if (skipped) warnings.add(PIVOT_VALUES_WARNING);
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

/**
 * A pivot table without the records Excel saved: Excel shows its layout
 * and fills it again when it refreshes from its source.
 */
export function withoutRecords(pivot: SheetPivotTable): SheetPivotTable {
  const { records: _records, ...rest } = pivot;
  const prefix = mainPrefix(pivot.cache, 'pivotCacheDefinition');
  return prefix === undefined
    ? rest
    : {
        ...rest,
        cache: withRootAttributes(
          pivot.cache,
          `${prefix}pivotCacheDefinition`,
          { saveData: '0' }
        ),
      };
}

/** The table's name, for pivot charts that refer to it. */
export function pivotTableName(pivot: SheetPivotTable): string | undefined {
  return /<(?:[\w.-]+:)?pivotTableDefinition\b[^>]*\sname="([^"]*)"/.exec(
    pivot.table
  )?.[1];
}

/** A relationship of an exported part. */
export type PartRelationship = {
  type: string;
  target: string;
  external?: true;
};

/**
 * The parts of a pivot table for export, with its cache's id, its location
 * and source as they are now, and its number formats in the new workbook.
 * A cache over a source Macro does not hold keeps its records, its link to
 * the other workbook and the id of its data connection, numbered in the
 * new workbook. Undefined when its source no longer exists.
 */
export function pivotParts(
  pivot: SheetPivotTable,
  cacheId: number,
  format: (code: string) => number,
  differential: (style: ConditionalStyle) => number,
  connectionId?: number
):
  | {
      table: string;
      cache: string;
      records?: string;
      /** The cache's relationships, `rId1` onward. */
      relationships: PartRelationship[];
    }
  | undefined {
  const tablePrefix = mainPrefix(pivot.table, 'pivotTableDefinition');
  const cachePrefix = mainPrefix(pivot.cache, 'pivotCacheDefinition');
  if (tablePrefix === undefined || cachePrefix === undefined) return;
  const numberFormats = (part: string) =>
    part.replace(/\bnumFmtId="(\d+)"/g, (attribute, id: string) => {
      const code = pivot.formats?.[id];
      return code ? `numFmtId="${format(code)}"` : attribute;
    });
  const differentials = (part: string) =>
    part.replace(
      /\bdxfId="(\d+)"/g,
      (_, id: string) =>
        `dxfId="${differential(pivot.styles?.[Number(id)] ?? {})}"`
    );
  const table = differentials(
    numberFormats(
      withLocation(
        withRootAttributes(pivot.table, `${tablePrefix}pivotTableDefinition`, {
          cacheId: String(cacheId),
        }),
        tablePrefix,
        pivot.location
      )
    )
  );
  let cache = numberFormats(pivot.cache);
  if (pivot.source) {
    const sourced = withSource(cache, cachePrefix, pivot.source);
    if (!sourced) return;
    cache = sourced;
  }
  const relationships: PartRelationship[] = [];
  const records = pivot.records && relationships.length + 1;
  if (pivot.records)
    relationships.push({
      type: 'pivotCacheRecords',
      target: `pivotCacheRecords${cacheId}.xml`,
    });
  const link = pivot.workbook && relationships.length + 1;
  if (pivot.workbook)
    relationships.push({
      type: 'externalLinkPath',
      target: pivot.workbook,
      external: true,
    });
  if (records || link) {
    // Relationship ids need the namespace; an imported cache may not
    // declare it with this prefix.
    const declared = new RegExp(`\\sxmlns:r="${RELATIONSHIPS}"`).test(
      /^[^>]*>/.exec(cache)?.[0] ?? ''
    );
    if (!declared && /^[^>]*\sxmlns:r="/.test(cache)) return;
    cache = withRootAttributes(cache, `${cachePrefix}pivotCacheDefinition`, {
      ...(!declared && { 'xmlns:r': RELATIONSHIPS }),
      ...(records && { 'r:id': `rId${records}` }),
    });
  }
  if (link)
    cache = cache.replace(
      new RegExp(`<${cachePrefix}worksheetSource\\b`),
      `$& r:id="rId${link}"`
    );
  if (pivot.connection) {
    if (connectionId === undefined) return;
    cache = cache.replace(
      new RegExp(
        `(<${cachePrefix}cacheSource\\b[^>]*?\\sconnectionId=")[^"]*"`
      ),
      `$1${connectionId}"`
    );
  }
  const declaration =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return {
    table: `${declaration}${table}`,
    cache: `${declaration}${cache}`,
    ...(pivot.records && { records: `${declaration}${pivot.records}` }),
    relationships,
  };
}

/**
 * The connections part of a workbook whose pivot tables read data
 * connections, numbered from 1 in the order given.
 */
export function connectionsPart(connections: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<connections xmlns="${MAIN}">${connections
    .map((connection, index) =>
      connection.replace(/^(<[^>]*?\s)id="[^"]*"/, `$1id="${index + 1}"`)
    )
    .join('')}</connections>`;
}
