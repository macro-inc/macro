/**
 * What a timeline bar shows besides its title: its times, the fields the view
 * names, and the option color it is tinted by.
 */

import { toGanttDay } from '@app/components/gantt/gantt-date';
import {
  formatGanttTime,
  formatGanttTimeRange,
} from '@app/components/gantt/gantt-time';
import type { CellTimeRange } from './cell-date-range';
import {
  type DatabaseViewColumn,
  databaseCellValues,
  isOptionColumn,
  isPersonColumn,
  optionOf,
} from './database-view';
import { type DatabaseRow, formatCellValue, rowValue } from './table';
import type { TimelineLayout } from './timeline';
import { laneLabel } from './views';

/**
 * A timed bar's times: `9:30 AM – 4 PM` within one day, or
 * `Oct 9, 10:30 AM → Oct 13, 5 PM` across days. All-day bars show none; their
 * place on the chart is their dates.
 */
export function timelineBarTime(range: CellTimeRange): string | undefined {
  if (range.allDay) return undefined;
  return toGanttDay(range.start) === toGanttDay(range.end)
    ? `${formatGanttTime(range.start)} – ${formatGanttTime(range.end)}`
    : formatGanttTimeRange(range);
}

/** One field a bar shows: its text, and its options' colors when it holds options. */
export type TimelineBarField = {
  columnId: string;
  name: string;
  text: string;
  colors: string[];
};

/** The columns a bar can show after its title: all but the title and the range it spans. */
export function timelineBarFieldColumns(
  layout: TimelineLayout,
  columns: readonly DatabaseViewColumn[],
  titleColumnId: string | undefined
): DatabaseViewColumn[] {
  return columns.filter(
    (column) => column.id !== layout.range && column.id !== titleColumnId
  );
}

function fieldText(column: DatabaseViewColumn, row: DatabaseRow): string {
  const value = rowValue(row, column.id);
  if (value === null || value === '') return '';
  if (isPersonColumn(column))
    return laneLabel(column, { kind: 'user', id: String(value) });
  // Other mentions hold ids, which mean nothing as text.
  if (column.dataType === 'ENTITY' && !column.relation) return '';
  return formatCellValue(column, value);
}

/**
 * The view's bar fields that hold something for `row`, in the view's order.
 * Removed columns, the title and the range are left out.
 */
export function timelineBarFields(
  row: DatabaseRow,
  layout: TimelineLayout,
  columns: readonly DatabaseViewColumn[],
  titleColumnId: string | undefined
): TimelineBarField[] {
  const shown = timelineBarFieldColumns(layout, columns, titleColumnId);
  return (layout.barFields ?? []).flatMap((id) => {
    const column = shown.find((entry) => entry.id === id);
    if (!column) return [];
    const text = fieldText(column, row);
    if (!text) return [];
    return [
      {
        columnId: column.id,
        name: column.name,
        text,
        colors: isOptionColumn(column)
          ? optionColors(column, row).filter((color) => color !== undefined)
          : [],
      },
    ];
  });
}

/** The select and tag columns a timeline can color its bars by. */
export function timelineColorColumns(
  columns: readonly DatabaseViewColumn[]
): DatabaseViewColumn[] {
  return columns.filter(isOptionColumn);
}

/** The column a timeline colors by, when it names a select or tag column. */
export function timelineColorColumn(
  layout: TimelineLayout,
  columns: readonly DatabaseViewColumn[]
): DatabaseViewColumn | undefined {
  return columns.find(
    (column) => column.id === layout.colorBy && isOptionColumn(column)
  );
}

function optionColors(
  column: DatabaseViewColumn,
  row: DatabaseRow
): (string | undefined)[] {
  const value = rowValue(row, column.id);
  if (value === null || value === '') return [];
  return databaseCellValues(value, column).map(
    (label) => optionOf(column, String(label))?.color ?? undefined
  );
}

/**
 * A bar's colors: the first of its options that still has a color tints it,
 * and the rest are its dots. An empty cell, or options removed or uncolored,
 * leave it neutral.
 */
export function timelineBarColor(
  row: DatabaseRow,
  column: DatabaseViewColumn | undefined
): { tint: string | undefined; dots: string[] } {
  const colors = column
    ? optionColors(column, row).filter((color) => color !== undefined)
    : [];
  return { tint: colors[0], dots: colors.slice(1) };
}
