/**
 * Derived columns in the editor: the engine reads and renders their formulas
 * against a catalog of the one table, built from the columns the grid has, so
 * every host that draws columns can edit formulas.
 */

import type {
  Catalog,
  ColumnKind,
  Formula,
  FormulaReading,
} from '@core/database-sql/generated/types';
import { loadDatabaseSqlWasm } from '@core/database-sql/wasm-module';
import { match, P } from 'ts-pattern';
import type { DatabaseViewColumn } from './database-view';

/** A table's formulas, read and rendered by the engine once it has loaded. */
export type FormulaTools = {
  /** What `text` reads as for the derived column `own`, or a new one. */
  read(text: string, own?: string): FormulaReading;
  /** `formula` as users write it, with the current column names. */
  render(formula: Formula): string;
};

/** The engine's formula tools for `columns` of `tableId`, loading it on first use. */
export async function loadFormulaTools(
  tableId: string,
  columns: readonly DatabaseViewColumn[]
): Promise<FormulaTools> {
  const wasm = await loadDatabaseSqlWasm();
  const catalog = formulaCatalog(tableId, columns);
  return {
    read: (text, own) => wasm.readFormula(catalog, tableId, own, text),
    render: (formula) => wasm.renderFormula(catalog, tableId, formula),
  };
}

/** The columns a formula can use: numbers, dates and other derived columns. */
export function formulaInputs(
  columns: readonly DatabaseViewColumn[],
  own?: string
): DatabaseViewColumn[] {
  return columns.filter(
    (column) =>
      column.id !== own &&
      !column.relation &&
      (column.dataType === 'NUMBER' || column.dataType === 'DATE')
  );
}

/**
 * A catalog holding only this table. Formulas name columns by placement, so
 * the placement stands in for the definition too.
 */
export function formulaCatalog(
  tableId: string,
  columns: readonly DatabaseViewColumn[]
): Catalog {
  return {
    tables: [
      {
        id: tableId,
        databaseId: tableId,
        database: '',
        name: '',
        columns: columns.map((column) => ({
          id: column.id,
          placement: column.id,
          name: column.name,
          kind: engineKind(column),
          ...(column.formula ? { formula: column.formula } : {}),
        })),
      },
    ],
  };
}

function engineKind(column: DatabaseViewColumn): ColumnKind {
  if (column.relation)
    return { kind: 'entity', multi: true, target: 'DATABASE_ROW' };
  return match(column.dataType)
    .returnType<ColumnKind>()
    .with('STRING', () => ({ kind: 'text' }))
    .with('NUMBER', () => ({ kind: 'number' }))
    .with('BOOLEAN', () => ({ kind: 'boolean' }))
    .with('DATE', () => ({ kind: 'date' }))
    .with('LINK', () => ({ kind: 'link' }))
    .with(P.union('SELECT_STRING', 'SELECT_NUMBER', 'TAG'), () => ({
      kind: 'select',
      multi: column.isMultiSelect,
      options: [],
    }))
    .with('ENTITY', () => ({
      kind: 'entity',
      multi: column.isMultiSelect,
      target: column.specificEntityType ?? 'USER',
    }))
    .exhaustive();
}
