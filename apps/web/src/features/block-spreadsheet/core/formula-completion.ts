import type { CompletionContext } from '@ironcalc/wasm';
import { escapedColumnName } from '@macro-inc/spreadsheet/structured-references';
import catalog from './formula-functions.json';

// Adapted from IronCalc's function catalog at the vendored engine's upstream
// commit (vendor/ironcalc/upstream.json). See the adjacent MIT license.
// HYPERLINK is left out (Macro shows its text); AGGREGATE and GETPIVOTDATA are
// Macro's additions.
export type FormulaFunction = {
  args: string[][];
  description: string;
  examples: string[];
};
export const formulaFunctions: Record<string, FormulaFunction> = catalog;
const common = [
  'SUM',
  'AVERAGE',
  'IF',
  'COUNT',
  'COUNTA',
  'MIN',
  'MAX',
  'SUMIF',
  'COUNTIF',
  'IFERROR',
  'XLOOKUP',
  'ROUND',
];
const names = Object.keys(formulaFunctions).sort((a, b) => {
  const rank = (name: string) =>
    common.includes(name) ? common.indexOf(name) : common.length;
  return rank(a) - rank(b) || a.localeCompare(b);
});

/** A table name, column or area a formula can refer to, and the text that
 * replaces what was typed. */
export type ReferenceCompletion = {
  label: string;
  insert: string;
  detail: string;
};

export type FormulaCompletion =
  | { kind: 'list'; names: string[]; from: number }
  | { kind: 'detail'; name: string; argument: number }
  | {
      kind: 'references';
      items: ReferenceCompletion[];
      from: number;
      to: number;
    }
  | undefined;

/** The tables formulas can refer to, and the one holding the edited cell. */
export type TableReferences = {
  tables: { name: string; columns: string[] }[];
  own?: { name: string; columns: string[] };
};

const AREAS = ['#All', '#Data', '#Headers', '#Totals'];

/**
 * Table names, columns and areas for what is typed at `cursor`: after
 * `Table1[`, the table's columns and areas; after `[` inside a table, its
 * columns of the same row first; and table names, with the functions that
 * also match, while a name is typed.
 */
export function tableCompletion(
  text: string,
  cursor: number,
  references: TableReferences
): FormulaCompletion {
  const before = text.slice(0, cursor);
  if (!before.startsWith('=') || (before.match(/"/g)?.length ?? 0) % 2) return;
  const bracket = /([\p{L}_\\][\p{L}\p{N}_.\\]*)?\[([^[\]]*)$/u.exec(before);
  if (bracket) {
    const named = bracket[1]?.toLowerCase();
    const table = named
      ? references.tables.find((item) => item.name.toLowerCase() === named)
      : references.own;
    if (!table) return;
    const typed = bracket[2].toLowerCase();
    const items: ReferenceCompletion[] = [
      ...(named
        ? []
        : table.columns.map((column) => ({
            label: `@${column}`,
            insert: /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(column)
              ? `@${column}]`
              : `@[${escapedColumnName(column)}]]`,
            detail: 'This row',
          }))),
      ...table.columns.map((column) => ({
        label: column,
        insert: `${escapedColumnName(column)}]`,
        detail: `Column of ${table.name}`,
      })),
      ...AREAS.map((area) => ({
        label: area,
        insert: `${area}]`,
        detail: `Area of ${table.name}`,
      })),
    ].filter((item) => item.label.toLowerCase().startsWith(typed));
    return items.length
      ? {
          kind: 'references',
          items: items.slice(0, 40),
          from: cursor - bracket[2].length,
          to: cursor,
        }
      : undefined;
  }
  const word = /(?:^|[^\p{L}\p{N}_.\\!$])([\p{L}_\\][\p{L}\p{N}_.\\]*)$/u.exec(
    before
  );
  if (!word) return;
  const typed = word[1].toLowerCase();
  const tables = references.tables.filter((table) =>
    table.name.toLowerCase().startsWith(typed)
  );
  if (!tables.length) return;
  return {
    kind: 'references',
    items: [
      ...tables.map((table) => ({
        label: table.name,
        insert: `${table.name}[`,
        detail: `Table · ${table.columns.length} columns`,
      })),
      ...names
        .filter((name) => name.startsWith(word[1].toUpperCase()))
        .slice(0, 20)
        .map((name) => ({
          label: name,
          insert: `${name}(`,
          detail: functionSummary(formulaFunctions[name]),
        })),
    ],
    from: cursor - word[1].length,
    to: cursor,
  };
}

export function formulaCompletion(
  text: string,
  context: CompletionContext
): FormulaCompletion {
  const argument = context.expecting.find(
    (token) => typeof token === 'object' && 'Argument' in token
  );
  if (argument && typeof argument === 'object' && 'Argument' in argument) {
    const [name, index] = argument.Argument;
    if (formulaFunctions[name.toUpperCase()])
      return { kind: 'detail', name: name.toUpperCase(), argument: index - 1 };
  }
  const partial = context.expecting.find(
    (token) => typeof token === 'object' && 'FunctionName' in token
  );
  if (
    !partial ||
    typeof partial !== 'object' ||
    !('FunctionName' in partial) ||
    !partial.FunctionName
  )
    return;
  const matches = names.filter((name) =>
    name.startsWith(partial.FunctionName.toUpperCase())
  );
  if (!matches.length) return;
  // The engine reports Unicode scalar offsets in the formula without its '='.
  const from = Array.from(text)
    .slice(0, context.replace_from + 1)
    .join('').length;
  return { kind: 'list', names: matches.slice(0, 40), from };
}

export function insertFunction(
  text: string,
  cursor: number,
  from: number,
  name: string
) {
  // Replace the whole identifier when completing in its middle, keeping an existing '('.
  const suffix = text.slice(cursor).replace(/^[A-Za-z0-9_.]*/, '');
  const insert = name + (suffix.startsWith('(') ? '' : '(');
  return {
    text: text.slice(0, from) + insert + suffix,
    cursor: from + name.length + 1,
  };
}

export function argumentLabel(name: string) {
  if (name === '...') return '…';
  return name.endsWith('*') ? `[${name.slice(0, -1)}]` : name;
}

export function functionSummary(info: FormulaFunction) {
  return (
    info.description.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ?? info.description
  );
}
