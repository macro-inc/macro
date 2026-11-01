import {
  columnLetters,
  type FormulaPiece,
  formulaPieces,
  quotedSheet,
} from './formula-pieces';

/** A table as formulas see it: where its cells are and its column names. */
export type WorkbookTable = {
  name: string;
  sheet: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  headerRows: number;
  totalsRows: number;
  columns: string[];
  /** Its filters hide rows, which SUBTOTAL(1-11) then leaves out. */
  filtered?: boolean;
};

/** One structured reference: `Table1[Amount]`, or `[@Qty]` inside a table. */
type StructuredReference = {
  /** The pieces it spans. */
  start: number;
  end: number;
  table?: string;
  specifier: string;
};

/** The structured references of a formula's pieces. A bare word naming one
 * of `tables`, such as `=SUM(Table1)`, refers to that table's data. */
function structuredReferences(
  pieces: FormulaPiece[],
  tables?: Set<string>
): StructuredReference[] {
  const found: StructuredReference[] = [];
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index];
    const next = pieces[index + 1];
    if (
      piece.kind === 'word' &&
      next?.kind === 'bracket' &&
      pieces[index - 1]?.text !== '!'
    ) {
      found.push({
        start: index,
        end: index + 1,
        table: piece.text,
        specifier: next.text,
      });
      index++;
    } else if (
      piece.kind === 'bracket' &&
      !/^\[\d+\]$/.test(piece.text) &&
      pieces[index - 1]?.kind !== 'word'
    )
      found.push({ start: index, end: index, specifier: piece.text });
    else if (
      piece.kind === 'word' &&
      tables?.has(piece.text.toLowerCase()) &&
      next?.text !== '(' &&
      next?.text !== '!' &&
      next?.text !== ':' &&
      pieces[index - 1]?.text !== '!' &&
      pieces[index - 1]?.text !== ':'
    )
      found.push({
        start: index,
        end: index,
        table: piece.text,
        specifier: '',
      });
  }
  return found;
}

/** Rewrite each structured reference with `replace`, which returns its new
 * text or undefined to keep it. */
function rewrite(
  formula: string,
  replace: (reference: StructuredReference) => string | undefined,
  tables?: Set<string>
): string {
  if (!formula.includes('[')) {
    const lower = formula.toLowerCase();
    if (!tables || ![...tables].some((name) => lower.includes(name)))
      return formula;
  }
  const pieces = formulaPieces(formula);
  const output = pieces.map((piece) => piece.text);
  let changed = false;
  for (const reference of structuredReferences(pieces, tables)) {
    const text = replace(reference);
    if (text === undefined) continue;
    output[reference.start] = text;
    for (let at = reference.start + 1; at <= reference.end; at++)
      output[at] = '';
    changed = true;
  }
  return changed ? output.join('') : formula;
}

/** Whether a formula has a structured reference, to any table. */
export function hasStructuredReference(formula: string): boolean {
  return (
    formula.includes('[') &&
    structuredReferences(formulaPieces(formula)).length > 0
  );
}

/** Whether a formula refers to its own row of a table, as `[@Qty]` does. */
export function hasThisRowReference(formula: string): boolean {
  return (
    formula.includes('[') &&
    structuredReferences(formulaPieces(formula)).some((reference) =>
      specifierItems(reference.specifier).some(
        (item) => item.trim().toLowerCase() === '#this row'
      )
    )
  );
}

/** The table names a formula's structured references give, lowercase;
 * bare words count when they name one of `tables`. */
export function referencedTableNames(
  formula: string,
  tables?: Iterable<string>
): Set<string> {
  const names = tables && lowercaseSet(tables);
  return new Set(
    structuredReferences(formulaPieces(formula), names).flatMap((reference) =>
      reference.table ? [reference.table.toLowerCase()] : []
    )
  );
}

function lowercaseSet(names: Iterable<string>) {
  return new Set([...names].map((name) => name.toLowerCase()));
}

/** The table a reference names, or for `[@Qty]` the table holding the cell. */
function referencedTable(
  reference: StructuredReference,
  tables: WorkbookTable[],
  sheet: string,
  row: number,
  column: number
) {
  if (reference.table !== undefined) {
    const name = reference.table.toLowerCase();
    return tables.find((table) => table.name.toLowerCase() === name);
  }
  return tables.find(
    (table) =>
      table.sheet === sheet &&
      row >= table.top &&
      row <= table.bottom &&
      column >= table.left &&
      column <= table.right
  );
}

/** Column names inside a structured reference unescape `'`-prefixed characters. */
function columnSpecifier(text: string) {
  return text.replace(/'(.)/g, '$1').trim().toLowerCase();
}

/** A column name as a structured reference writes it inside brackets. */
export function escapedColumnName(name: string) {
  return name.replace(/['#[\]]/g, "'$&");
}

/** The bracketed items of a specifier: `#This Row`, column names, `:` and `,`. */
function specifierItems(specifier: string): string[] {
  const inner = specifier.slice(1, -1).trim();
  const items: string[] = [];
  if (inner.startsWith('[')) {
    for (const match of inner.matchAll(/\[((?:'.|[^\]])*)\]|(:)|,/g))
      items.push(match[2] ?? match[1] ?? ',');
  } else if (inner.startsWith('@')) {
    items.push('#This Row');
    const rest = inner.slice(1).trim();
    if (rest.startsWith('['))
      for (const match of rest.matchAll(/\[((?:'.|[^\]])*)\]|(:)/g))
        items.push(match[2] ?? match[1]);
    else if (rest) items.push(rest);
  } else if (inner) items.push(inner);
  return items;
}

/** Convert one structured reference (`Table1[Amount]`, `[@Qty]`,
 * `Table1[[#This Row],[Price]:[Tax]]`) to an A1 range. */
function structuredRange(
  table: WorkbookTable,
  specifier: string,
  sheet: string,
  row: number
): string | undefined {
  let rows:
    | 'data'
    | 'all'
    | 'headers'
    | 'totals'
    | 'this'
    | 'data-totals'
    | 'headers-data' = 'data';
  const area = new Set<string>();
  const columnNames: string[] = [];
  let span = false;
  for (const item of specifierItems(specifier)) {
    if (item === ',') continue;
    if (item === ':') {
      span = true;
      continue;
    }
    const lower = item.trim().toLowerCase();
    if (lower.startsWith('#')) area.add(lower);
    else if (lower === '@') area.add('#this row');
    else columnNames.push(columnSpecifier(item));
  }
  if (area.has('#all')) rows = 'all';
  else if (area.has('#this row')) rows = 'this';
  else if (area.has('#headers') && area.has('#data')) rows = 'headers-data';
  else if (area.has('#data') && area.has('#totals')) rows = 'data-totals';
  else if (area.has('#headers')) rows = 'headers';
  else if (area.has('#totals')) rows = 'totals';
  const firstData = table.top + table.headerRows;
  const lastData = table.bottom - table.totalsRows;
  const [top, bottom] = {
    all: [table.top, table.bottom],
    data: [firstData, lastData],
    headers: [table.top, table.top],
    totals: [table.bottom, table.bottom],
    'headers-data': [table.top, lastData],
    'data-totals': [firstData, table.bottom],
    this: [row, row],
  }[rows];
  if (
    (rows === 'headers' && !table.headerRows) ||
    (rows === 'totals' && !table.totalsRows) ||
    (rows === 'this' && (row < firstData || row > lastData)) ||
    top > bottom
  )
    return;
  const index = (name: string) =>
    table.columns.findIndex((column) => column.trim().toLowerCase() === name);
  let left = table.left;
  let right = table.right;
  if (columnNames.length) {
    const first = index(columnNames[0]);
    const last = index(columnNames[span ? columnNames.length - 1 : 0]);
    if (first < 0 || last < 0 || (!span && columnNames.length > 1)) return;
    left = table.left + Math.min(first, last);
    right = table.left + Math.max(first, last);
  }
  const prefix = table.sheet === sheet ? '' : `${quotedSheet(table.sheet)}!`;
  const rowText = (value: number) =>
    rows === 'this' ? `${value + 1}` : `$${value + 1}`;
  const start = `$${columnLetters(left + 1)}${rowText(top)}`;
  const end = `$${columnLetters(right + 1)}${rowText(bottom)}`;
  return `${prefix}${start === end ? start : `${start}:${end}`}`;
}

/**
 * Replace structured table references with equivalent A1 references, for the
 * formula in `row` and `column` of `sheet`. A reference to a table or column
 * that does not exist makes the result undefined, or becomes `unresolved`
 * when it is given. References to tables `resolves` refuses stay as written.
 */
export function resolveStructuredReferences(
  formula: string,
  tables: WorkbookTable[],
  sheet: string,
  row: number,
  column: number,
  options: {
    unresolved?: string;
    resolves?: (table: WorkbookTable) => boolean;
  } = {}
): string | undefined {
  const names = lowercaseSet(tables.map((table) => table.name));
  const { unresolved, resolves } = options;
  let failed = false;
  const resolved = rewrite(
    formula,
    (reference) => {
      const table = referencedTable(reference, tables, sheet, row, column);
      if (table && resolves && !resolves(table)) return;
      // A word before brackets that names no table is left to the engine
      // unless a replacement for unknown references is given.
      if (!table && reference.table !== undefined && unresolved === undefined)
        return;
      const range = table
        ? structuredRange(table, reference.specifier, sheet, row)
        : undefined;
      if (range !== undefined) return range;
      if (unresolved === undefined) failed = true;
      return unresolved;
    },
    names
  );
  return failed ? undefined : resolved;
}

/** A formula with its references to table `from` naming `to` instead. */
export function renameTableReferences(
  formula: string,
  from: string,
  to: string
): string {
  return rewrite(
    formula,
    (reference) =>
      reference.table?.toLowerCase() === from.toLowerCase()
        ? `${to}${reference.specifier}`
        : undefined,
    lowercaseSet([from])
  );
}

/** A specifier with column `from` named `to`, or undefined when it does not
 * name `from`. */
function renamedSpecifier(specifier: string, from: string, to: string) {
  const target = from.trim().toLowerCase();
  const escaped = escapedColumnName(to);
  const items = (text: string) =>
    text.replace(/\[((?:'.|[^\]])*)\]/g, (whole, item: string) =>
      !item.trim().startsWith('#') && columnSpecifier(item) === target
        ? `[${escaped}]`
        : whole
    );
  const inner = specifier.slice(1, -1);
  const trimmed = inner.trim();
  let next: string | undefined;
  if (trimmed.startsWith('[')) next = `[${items(inner)}]`;
  else if (trimmed.startsWith('@')) {
    const rest = trimmed.slice(1).trim();
    if (rest.startsWith('[')) next = `[@${items(rest)}]`;
    else if (rest && columnSpecifier(rest) === target)
      next = /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(to)
        ? `[@${to}]`
        : `[@[${escaped}]]`;
  } else if (!trimmed.startsWith('#') && columnSpecifier(inner) === target)
    next = `[${escaped}]`;
  return next === specifier ? undefined : next;
}

/** A formula with its references to column `from` of table `table` naming
 * `to` instead, for the formula in `row` and `column` of `sheet`. */
export function renameColumnReferences(
  formula: string,
  tables: WorkbookTable[],
  sheet: string,
  row: number,
  column: number,
  rename: { table: string; from: string; to: string }
): string {
  return rewrite(formula, (reference) => {
    const table = referencedTable(reference, tables, sheet, row, column);
    if (table?.name.toLowerCase() !== rename.table.toLowerCase()) return;
    const specifier = renamedSpecifier(
      reference.specifier,
      rename.from,
      rename.to
    );
    return specifier === undefined
      ? undefined
      : `${reference.table ?? ''}${specifier}`;
  });
}

/**
 * Structured references as Excel files store them: each names its table, and
 * `@` is written as `[#This Row]`.
 */
export function qualifyStructuredReferences(
  formula: string,
  tables: WorkbookTable[],
  sheet: string,
  row: number,
  column: number
): string {
  return rewrite(
    formula,
    (reference) => {
      const table = referencedTable(reference, tables, sheet, row, column);
      if (!table) return;
      if (!reference.specifier) return `${table.name}[#Data]`;
      const items = specifierItems(reference.specifier);
      const thisRow = reference.specifier.slice(1).trimStart().startsWith('@');
      if (!thisRow) return `${table.name}${reference.specifier}`;
      const columns = items
        .slice(1)
        .map((item) => (item === ':' ? ':' : `[${item}]`))
        .join('');
      return `${table.name}${columns ? `[[#This Row],${columns}]` : '[#This Row]'}`;
    },
    lowercaseSet(tables.map((table) => table.name))
  );
}

/**
 * Structured references as Excel shows them: `[#This Row]` as `@`, and
 * without the table name inside the table they refer to.
 */
export function displayStructuredReferences(
  formula: string,
  tables: WorkbookTable[],
  sheet: string,
  row: number,
  column: number
): string {
  return rewrite(formula, (reference) => {
    const table = referencedTable(reference, tables, sheet, row, column);
    if (!table) return;
    const own =
      table.sheet === sheet &&
      row >= table.top &&
      row <= table.bottom &&
      column >= table.left &&
      column <= table.right;
    const items = specifierItems(reference.specifier).filter(
      (item) => item !== ','
    );
    let specifier = reference.specifier;
    if (
      reference.specifier.slice(1).trimStart().startsWith('[') &&
      items[0]?.toLowerCase() === '#this row' &&
      items.slice(1).every((item) => item === ':' || !item.startsWith('#'))
    ) {
      const columns = items.slice(1);
      specifier = !columns.length
        ? '[@]'
        : columns.length === 1 && /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(columns[0])
          ? `[@${columns[0]}]`
          : `[@${columns.map((item) => (item === ':' ? ':' : `[${item}]`)).join('')}]`;
    }
    const name = own ? '' : table.name;
    return `${name}${specifier}` ===
      `${reference.table ?? ''}${reference.specifier}`
      ? undefined
      : `${name}${specifier}`;
  });
}

/**
 * The formula with each structured reference replaced by a string literal
 * the calculation engine keeps as it is, so it can move the formula's other
 * references, and a function putting the references back.
 */
export function protectStructuredReferences(formula: string): {
  formula: string;
  restore: (text: string) => string;
} {
  if (!formula.includes('['))
    return { formula, restore: (text: string) => text };
  let prefix = '__macro_table_reference_';
  while (formula.includes(prefix)) prefix += '_';
  const originals: string[] = [];
  const pieces = formulaPieces(formula);
  const protectedFormula = rewrite(formula, (reference) => {
    originals.push(
      pieces
        .slice(reference.start, reference.end + 1)
        .map((piece) => piece.text)
        .join('')
    );
    return `"${prefix}${originals.length - 1}"`;
  });
  return {
    formula: protectedFormula,
    restore: (text) =>
      originals.length
        ? text.replace(
            new RegExp(`"${prefix}(\\d+)"`, 'g'),
            (whole, index: string) => originals[Number(index)] ?? whole
          )
        : text,
  };
}
