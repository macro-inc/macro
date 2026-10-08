import type { Formula } from '@core/database-sql/generated/types';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { DatabaseSchemaChange } from '../core/column-schema';
import type { DatabaseViewColumn } from '../core/database-view';

/** A formula column to add next to `beside`, or in its place. */
export type NewFormulaColumn = {
  name: string;
  formula: Formula;
  beside: string;
  /** Take `beside`'s place: only for a column that never held a value. */
  replace: boolean;
};

/** Derived columns of the table the grid shows. */
export type FormulaEditing = {
  tableId: string;
  /** Every column of the table, in table order, hidden ones too. */
  columns: Accessor<readonly DatabaseViewColumn[]>;
  setFormula: (columnId: string, formula: Formula) => DatabaseSchemaChange;
  createFormulaColumn: (
    column: NewFormulaColumn
  ) => DatabaseSchemaChange<string>;
};

export const FormulaEditingContext = createContext<FormulaEditing>();

/** Formula editing where the grid offers it; viewers and tests have none. */
export function useFormulaEditing(): FormulaEditing | undefined {
  return useContext(FormulaEditingContext);
}
