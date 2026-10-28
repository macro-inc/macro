/**
 * What a new timeline spans, and the Time range column a table with no date-range
 * column is offered: created in the same batch as the timeline.
 */

import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { ViewQuery } from '@service-storage/generated/schemas/viewQuery';
import type { DatabaseOp } from '../../../lib/core/database-sql/generated/types';
import type { DatabaseViewColumn } from './database-view';
import { isDatabaseNameTaken } from './property-creation';
import { timelineLayout } from './views';

/** What a timeline spans: an existing date-range column, or a Time range column created with it. */
export type TimelineRange =
  | { kind: 'column'; columnId: string }
  | { kind: 'new-column' };

/** The Time range column's name: `Time range`, or the first of `Time range 2`, `Time range 3`… the table has free. */
export function timeRangeColumnName(
  columns: readonly DatabaseViewColumn[]
): string {
  const taken = columns.map((column) => column.name);
  let name = 'Time range';
  for (let suffix = 2; isDatabaseNameTaken(name, taken); suffix++)
    name = `Time range ${suffix}`;
  return name;
}

function timeRangeColumnOp(
  tableId: string,
  columns: readonly DatabaseViewColumn[],
  columnId: string
): DatabaseOp {
  return {
    kind: 'column',
    table: tableId,
    column: columnId,
    change: {
      kind: 'create',
      definition: {
        source: 'new',
        name: timeRangeColumnName(columns),
        type: { type: 'date_range' },
      },
    },
  };
}

/** One batch: a Time range column, then a new timeline of the table along it. */
export function newTimelineWithTimeRangeColumn(params: {
  tableId: string;
  viewId: string;
  name: string;
  query: ViewQuery;
  columns: readonly DatabaseViewColumn[];
  /** The id minted for the Time range column. */
  column: string;
}): DatabaseOp[] {
  return [
    timeRangeColumnOp(params.tableId, params.columns, params.column),
    {
      kind: 'view',
      table: params.tableId,
      view: params.viewId,
      change: {
        kind: 'create',
        view: {
          name: params.name,
          query: params.query,
          layout: timelineLayout(params.column, params.columns),
        },
      },
    },
  ];
}

/** One batch: a Time range column, then `view` laid out as a timeline along it. */
export function timelineWithTimeRangeColumn(params: {
  view: DatabaseView;
  columns: readonly DatabaseViewColumn[];
  column: string;
}): DatabaseOp[] {
  return [
    timeRangeColumnOp(params.view.tableId, params.columns, params.column),
    {
      kind: 'view',
      table: params.view.tableId,
      view: params.view.id,
      change: {
        kind: 'update',
        layout: timelineLayout(params.column, params.columns),
      },
    },
  ];
}
