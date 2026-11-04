import type { GroupSummary } from '@macro-inc/spreadsheet/table-groups';

/** The table dialog: renaming a table, or changing the cells it covers. */
export type TableDialogState =
  | { kind: 'rename'; table: string; name: string }
  | { kind: 'range'; table: string; range: string };

export type TableDialogInput =
  | { kind: 'rename'; name: string }
  | { kind: 'range'; range: string };

/** One value a column filter lists, and whether the filter shows it. */
export type TableFilterChoice = { value: string; shown: boolean };

/** A group by view of a table: its rows grouped by one column's values,
 * with another column summarized for each group. */
export type TableGroupView = {
  table: string;
  column: number;
  summaryColumn: number;
  summary: GroupSummary;
};

/** Formatting options a table's menu toggles. */
export type TableOption =
  | 'bandedRows'
  | 'bandedColumns'
  | 'firstColumn'
  | 'lastColumn';
