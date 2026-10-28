/**
 * A timeline's rows as the chart lists them: a bar per dated record, grouped
 * by a single select or single person when the view says, and the records
 * without dates apart.
 */

import type { ViewLayout } from '@service-storage/generated/schemas/viewLayout';
import type { LaneKey } from '../../../lib/core/database-sql/generated/types';
import { type CellTimeRange, cellTimeRange } from './cell-date-range';
import {
  type DatabaseViewColumn,
  isBoardGroupColumn,
  isPersonColumn,
  optionOf,
} from './database-view';
import { type DatabaseRow, rowValue } from './table';
import { laneId, laneLabel } from './views';

export type TimelineLayout = Extract<ViewLayout, { kind: 'timeline' }>;

/** One line of the chart. */
export type TimelineItem =
  | {
      kind: 'group';
      id: string;
      /** The group's id, which its records name. */
      group: string;
      lane: LaneKey;
      label: string;
      count: number;
    }
  | {
      kind: 'record';
      id: string;
      row: DatabaseRow;
      /** The record's group's id; empty when the timeline is not grouped. */
      group: string;
      /** The range its bar spans; undefined when its cell is empty. */
      range: CellTimeRange | undefined;
    }
  | { kind: 'undated'; id: string; count: number };

/** The group a record's cell puts it in. */
export function timelineLane(
  groupColumn: DatabaseViewColumn,
  row: DatabaseRow
): LaneKey {
  const value = rowValue(row, groupColumn.id);
  if (value === null || value === '') return { kind: 'none' };
  if (isPersonColumn(groupColumn)) return { kind: 'user', id: String(value) };
  const option = optionOf(groupColumn, String(value));
  return option ? { kind: 'option', id: option.id } : { kind: 'none' };
}

/** The column a timeline groups by, when it names one that can group. */
export function timelineGroupColumn(
  layout: TimelineLayout,
  columns: readonly DatabaseViewColumn[]
): DatabaseViewColumn | undefined {
  return columns.find(
    (column) => column.id === layout.groupBy && isBoardGroupColumn(column)
  );
}

function record(
  row: DatabaseRow,
  rangeColumnId: string,
  group: string
): Extract<TimelineItem, { kind: 'record' }> {
  return {
    kind: 'record',
    id: row.rowId,
    row,
    group,
    range: cellTimeRange(rowValue(row, rangeColumnId)),
  };
}

/**
 * The chart's lines in the rows' order. Ungrouped, dated records come first
 * and the undated follow under their own heading. Grouped, every option is a
 * group, even an empty one, so records can be moved into it; people follow in
 * the order they first appear, then the records with an empty cell. A
 * collapsed group lists none of its records.
 */
export function timelineItems(params: {
  rows: readonly DatabaseRow[];
  rangeColumnId: string;
  groupColumn?: DatabaseViewColumn;
  collapsed?: ReadonlySet<string>;
}): TimelineItem[] {
  const records = params.rows.map((row) =>
    record(row, params.rangeColumnId, '')
  );
  const dated = records.filter((item) => item.range);
  const groupColumn = params.groupColumn;
  if (!groupColumn) {
    const undated = records.filter((item) => !item.range);
    return undated.length
      ? [
          ...dated,
          { kind: 'undated', id: 'undated', count: undated.length },
          ...undated,
        ]
      : dated;
  }
  const lanes = new Map<string, { lane: LaneKey; rows: DatabaseRow[] }>();
  if (!isPersonColumn(groupColumn))
    for (const option of groupColumn.options) {
      const lane: LaneKey = { kind: 'option', id: option.id };
      lanes.set(laneId(lane), { lane, rows: [] });
    }
  // Dated records lead each group, in the rows' order.
  const ordered = [
    ...params.rows.filter((_, index) => records[index].range),
    ...params.rows.filter((_, index) => !records[index].range),
  ];
  const none: LaneKey = { kind: 'none' };
  const empty: DatabaseRow[] = [];
  for (const row of ordered) {
    const lane = timelineLane(groupColumn, row);
    if (lane.kind === 'none') {
      empty.push(row);
      continue;
    }
    const id = laneId(lane);
    const entry = lanes.get(id) ?? { lane, rows: [] };
    entry.rows.push(row);
    lanes.set(id, entry);
  }
  lanes.set(laneId(none), { lane: none, rows: empty });
  return [...lanes].flatMap(([id, entry]): TimelineItem[] => [
    {
      kind: 'group',
      id: `group:${id}`,
      group: id,
      lane: entry.lane,
      label: laneLabel(groupColumn, entry.lane),
      count: entry.rows.length,
    },
    ...(params.collapsed?.has(id)
      ? []
      : entry.rows.map((row) => record(row, params.rangeColumnId, id))),
  ]);
}

function sameItem(left: TimelineItem, right: TimelineItem): boolean {
  if (left.kind === 'record' && right.kind === 'record')
    return (
      left.row === right.row &&
      left.group === right.group &&
      left.range?.allDay === right.range?.allDay &&
      left.range?.start.getTime() === right.range?.start.getTime() &&
      left.range?.end.getTime() === right.range?.end.getTime()
    );
  if (left.kind === 'group' && right.kind === 'group')
    return (
      left.group === right.group &&
      left.label === right.label &&
      left.count === right.count
    );
  return (
    left.kind === 'undated' &&
    right.kind === 'undated' &&
    left.count === right.count
  );
}

/** `next`, keeping each unchanged item from `previous`, so the chart keeps its rows mounted. */
export function reuseTimelineItems(
  previous: readonly TimelineItem[],
  next: TimelineItem[]
): TimelineItem[] {
  const kept = new Map(previous.map((item) => [item.id, item]));
  return next.map((item) => {
    const existing = kept.get(item.id);
    return existing && sameItem(existing, item) ? existing : item;
  });
}
