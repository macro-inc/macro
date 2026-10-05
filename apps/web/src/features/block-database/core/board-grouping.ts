/**
 * What a new board groups by, and the Status column a table with nothing a
 * board can group by is offered: created in the same batch as the board.
 */
import type { DatabaseOp } from '@core/database-sql/generated/types';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { ViewQuery } from '@service-storage/generated/schemas/viewQuery';
import type { DatabaseViewColumn } from './database-view';
import { isDatabaseNameTaken } from './property-creation';
import { boardLayout } from './views';

/** What a board groups by: an existing column, or a Status column created with it. */
export type BoardGrouping =
  | { kind: 'column'; columnId: string }
  | { kind: 'new-status' };

/** The Status column's options, in lane order. */
export const STATUS_OPTIONS = ['To do', 'In progress', 'Done'] as const;

/** The ids minted for a new Status column and each of its options. */
export type MintedStatusColumn = {
  column: string;
  options: [string, string, string];
};

/** The Status column's name: `Status`, or the first of `Status 2`, `Status 3`… the table has free. */
export function statusColumnName(
  columns: readonly DatabaseViewColumn[]
): string {
  const taken = columns.map((column) => column.name);
  let name = 'Status';
  for (let suffix = 2; isDatabaseNameTaken(name, taken); suffix++)
    name = `Status ${suffix}`;
  return name;
}

function statusColumnOp(
  tableId: string,
  columns: readonly DatabaseViewColumn[],
  status: MintedStatusColumn
): DatabaseOp {
  return {
    kind: 'column',
    table: tableId,
    column: status.column,
    change: {
      kind: 'create',
      definition: {
        source: 'new',
        name: statusColumnName(columns),
        type: { type: 'select', multi: false },
        options: STATUS_OPTIONS.map((label, index) => ({
          id: status.options[index],
          label,
        })),
      },
    },
  };
}

/** One batch: a Status column, then a new board of the table grouped by it. */
export function newBoardWithStatusColumn(params: {
  tableId: string;
  viewId: string;
  name: string;
  query: ViewQuery;
  columns: readonly DatabaseViewColumn[];
  status: MintedStatusColumn;
}): DatabaseOp[] {
  return [
    statusColumnOp(params.tableId, params.columns, params.status),
    {
      kind: 'view',
      table: params.tableId,
      view: params.viewId,
      change: {
        kind: 'create',
        view: {
          name: params.name,
          query: params.query,
          layout: boardLayout(params.status.column, params.columns),
        },
      },
    },
  ];
}

/** One batch: a Status column, then `view` laid out as a board grouped by it. */
export function boardWithStatusColumn(params: {
  view: DatabaseView;
  columns: readonly DatabaseViewColumn[];
  status: MintedStatusColumn;
}): DatabaseOp[] {
  return [
    statusColumnOp(params.view.tableId, params.columns, params.status),
    {
      kind: 'view',
      table: params.view.tableId,
      view: params.view.id,
      change: {
        kind: 'update',
        layout: boardLayout(params.status.column, params.columns),
      },
    },
  ];
}
