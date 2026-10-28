import type {
  PivotLayout,
  PivotLayoutField,
  PivotLayoutLine,
} from '@ironcalc/wasm';
import { parseCellAddress } from './spreadsheet-document';
import type { SheetPivotTable } from './workbook-metadata';

/** Where a pivot table shows its values, for GETPIVOTDATA, on its sheet. */
export type SheetPivotLayout = Omit<PivotLayout, 'sheet'>;

/** An element of a pivot part, without namespace prefixes or text. */
type XmlElement = {
  name: string;
  attributes: Record<string, string | undefined>;
  children: XmlElement[];
};

const TAG =
  /<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /(?:[^\s=:]+:)?([^\s=:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string) {
  return text.replace(
    /&(?:#x([\da-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/gi,
    (entity, hex: string, decimal: string, name: string) =>
      hex
        ? String.fromCodePoint(Number.parseInt(hex, 16))
        : decimal
          ? String.fromCodePoint(Number(decimal))
          : (ENTITIES[name.toLowerCase()] ?? entity)
  );
}

/** The root element of a part Excel wrote: its tags, nothing else. */
function parseXml(xml: string): XmlElement | undefined {
  const root: XmlElement = { name: '', attributes: {}, children: [] };
  const open = [root];
  for (const [, closing, name, attributeText, empty] of xml.matchAll(TAG)) {
    if (closing) {
      if (open.length > 1) open.pop();
      continue;
    }
    const attributes: XmlElement['attributes'] = {};
    for (const [, key, double, single] of attributeText.matchAll(ATTRIBUTE))
      attributes[key] = decodeEntities(double ?? single);
    const element: XmlElement = { name, attributes, children: [] };
    open[open.length - 1].children.push(element);
    if (!empty) open.push(element);
  }
  return root.children[0];
}

const child = (element: XmlElement | undefined, name: string) =>
  element?.children.find((entry) => entry.name === name);
const children = (element: XmlElement | undefined, name: string) =>
  element?.children.filter((entry) => entry.name === name) ?? [];

function integer(value: string | undefined): number | undefined {
  const number = Number(value);
  return value !== undefined && Number.isInteger(number) ? number : undefined;
}

/** A name or a text as GETPIVOTDATA compares them. */
export function pivotName(text: string): string {
  return text.trim().toLowerCase();
}

/** Excel's serial number of an ISO date, as the engine counts. */
function dateSerial(iso: string): number | undefined {
  const time = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(time) ? time / 86_400_000 + 25_569 : undefined;
}

/** What an item of a cache field shows, and its value if it has one. */
function cacheItem(
  value: XmlElement | undefined,
  index: number,
  groupBy: string | undefined
): PivotLayoutField['items'][number] {
  const v = value?.attributes.v ?? '';
  switch (value?.name) {
    case 'n': {
      const number = Number(v);
      return Number.isFinite(number)
        ? { text: String(number), number }
        : { text: pivotName(v) };
    }
    case 'b':
      return { text: v === '1' || v === 'true' ? 'true' : 'false' };
    case 'd': {
      const number = dateSerial(v);
      return { text: pivotName(v), ...(number !== undefined && { number }) };
    }
    case 'm':
      return { text: '(blank)' };
    case 's': {
      // Months and quarters of grouped dates go by their number, as Excel
      // writes them: the first and last group hold the dates outside.
      const count = groupBy === 'months' ? 12 : groupBy === 'quarters' ? 4 : 0;
      const number =
        index >= 1 && index <= count
          ? index
          : /^-?\d+(?:\.\d+)?$/.test(v.trim())
            ? Number(v)
            : undefined;
      return { text: pivotName(v), ...(number !== undefined && { number }) };
    }
    default:
      return { text: pivotName(v) };
  }
}

/** The fields of a pivot table, with the items its rows and columns index. */
function layoutFields(
  table: XmlElement,
  cache: XmlElement
): PivotLayoutField[] {
  const pivotFields = children(child(table, 'pivotFields'), 'pivotField');
  return children(child(cache, 'cacheFields'), 'cacheField').map(
    (cacheField, index) => {
      const pivotField = pivotFields[index];
      const group = child(cacheField, 'fieldGroup');
      const groupBy = child(group, 'rangePr')?.attributes.groupBy;
      // A grouped field's items are its groups.
      const values = (
        child(group, 'groupItems') ?? child(cacheField, 'sharedItems')
      )?.children;
      const items = children(child(pivotField, 'items'), 'item').map((item) => {
        const { t, x, n } = item.attributes;
        // Subtotal items are never on a row or column of values.
        if (t && t !== 'data') return { text: '' };
        const position = integer(x) ?? -1;
        const value = cacheItem(values?.[position], position, groupBy);
        return n === undefined ? value : { ...value, text: pivotName(n) };
      });
      const names = [cacheField.attributes.name, pivotField?.attributes.name]
        .filter((name): name is string => !!name)
        .map(pivotName);
      return { names: [...new Set(names)], items };
    }
  );
}

/** Excel's subtotal item types; a line of one of them is a subtotal. */
const LINE_TYPES = new Set([
  'data',
  'default',
  'sum',
  'countA',
  'avg',
  'max',
  'min',
  'product',
  'count',
  'stdDev',
  'stdDevP',
  'var',
  'varP',
  'grand',
  'blank',
]);

/**
 * The rows (or columns) of values: `rowItems` lists them in order, each
 * repeating `r` items of the line before and giving the rest. The values
 * field, `-2` among the fields, picks the data field a line shows.
 */
function layoutLines(
  fields: number[],
  lines: XmlElement | undefined,
  start: number,
  end: number
): PivotLayoutLine[] | undefined {
  if (!lines) return [{ at: start, items: [] }];
  const values = fields.indexOf(-2);
  const result: PivotLayoutLine[] = [];
  let previous: number[] = [];
  for (const [index, line] of children(lines, 'i').entries()) {
    const at = start + index;
    if (at > end) return;
    const type = line.attributes.t ?? 'data';
    if (!LINE_TYPES.has(type)) return;
    const items = [
      ...previous.slice(0, integer(line.attributes.r) ?? 0),
      ...children(line, 'x').map((x) => integer(x.attributes.v) ?? 0),
    ];
    previous = items;
    if (type === 'blank') continue;
    const pairs: [number, number][] = [];
    let data: number | undefined;
    if (type !== 'grand')
      for (const [position, item] of items.entries()) {
        const field = fields[position];
        if (field === -2) data = item;
        else if (field !== undefined && field >= 0) pairs.push([field, item]);
      }
    if (values >= 0 && data === undefined)
      data =
        type === 'data'
          ? integer(line.attributes.i)
          : (integer(line.attributes.i) ?? 0);
    result.push({
      at,
      items: pairs,
      ...(data !== undefined && { data }),
      ...(type !== 'data' && { total: true }),
    });
  }
  return result;
}

function bounds(range: string | undefined) {
  const [start, end = start] = (range ?? '').split(':');
  const first = parseCellAddress(start ?? '');
  const last = parseCellAddress(end ?? '');
  return first && last ? { first, last } : undefined;
}

/**
 * Where a kept pivot table shows each of its values, from its definition and
 * its cache. Undefined when its cells no longer have the shape Excel gave
 * them, after rows or columns were inserted or deleted inside it.
 */
export function pivotLayout(
  pivot: SheetPivotTable
): SheetPivotLayout | undefined {
  const table = parseXml(pivot.table);
  const cache = parseXml(pivot.cache);
  if (
    table?.name !== 'pivotTableDefinition' ||
    cache?.name !== 'pivotCacheDefinition'
  )
    return;
  const location = child(table, 'location');
  const now = bounds(pivot.location);
  const original = bounds(location?.attributes.ref);
  if (
    !now ||
    !original ||
    now.last.row - now.first.row !== original.last.row - original.first.row ||
    now.last.column - now.first.column !==
      original.last.column - original.first.column
  )
    return;
  const range: SheetPivotLayout['range'] = [
    now.first.row + 1,
    now.first.column + 1,
    now.last.row + 1,
    now.last.column + 1,
  ];
  const fields = layoutFields(table, cache);
  const axis = (name: string) =>
    children(child(table, name), 'field').flatMap(
      (field) => integer(field.attributes.x) ?? []
    );
  const rows = layoutLines(
    axis('rowFields'),
    child(table, 'rowItems'),
    range[0] + (integer(location?.attributes.firstDataRow) ?? 0),
    range[2]
  );
  const columns = layoutLines(
    axis('colFields'),
    child(table, 'colItems'),
    range[1] + (integer(location?.attributes.firstDataCol) ?? 0),
    range[3]
  );
  if (!rows || !columns) return;
  const data = children(child(table, 'dataFields'), 'dataField').map(
    (field) => {
      const source = fields[integer(field.attributes.fld) ?? -1];
      return [
        ...new Set(
          [
            ...(field.attributes.name
              ? [pivotName(field.attributes.name)]
              : []),
            ...(source?.names.slice(0, 1) ?? []),
          ].filter(Boolean)
        ),
      ];
    }
  );
  const filters = children(child(table, 'pageFields'), 'pageField').flatMap(
    (field): [number, number | null][] => {
      const index = integer(field.attributes.fld);
      return index === undefined || index < 0
        ? []
        : [[index, integer(field.attributes.item) ?? null]];
    }
  );
  return {
    range,
    data,
    fields,
    ...(filters.length && { filters }),
    rows,
    columns,
  };
}

const layouts = new WeakMap<SheetPivotTable, SheetPivotLayout | null>();

/** The layouts of a sheet's pivot tables, worked out once per table. */
export function sheetPivotLayouts(
  pivots: readonly SheetPivotTable[] | undefined
): SheetPivotLayout[] {
  return (pivots ?? []).flatMap((pivot) => {
    let layout = layouts.get(pivot);
    if (layout === undefined) {
      layout = pivotLayout(pivot) ?? null;
      layouts.set(pivot, layout);
    }
    return layout ? [layout] : [];
  });
}
