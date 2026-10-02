/** A table's typed views as the grid and board draw them, and the layouts new views start with. */
import type { FilterNode, LaneKey } from '@core/database-sql/generated/types';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { ViewColumn } from '@service-storage/generated/schemas/viewColumn';
import type { ViewLayout } from '@service-storage/generated/schemas/viewLayout';
import { err, ok, type Result } from 'neverthrow';
import { match } from 'ts-pattern';
import { type DatabaseViewColumn, isBoardGroupColumn } from './database-view';
import { moveBeside } from './move-beside';
import { titleColumn } from './table';

/** A table layout's column, with its width. */
type LayoutColumn = {
  column: DatabaseViewColumn;
  width: number | null;
};

/**
 * Every column in display order: the layout's listed ones first, then the
 * rest in the table's order. A board lists none.
 */
export function layoutColumns(
  layout: ViewLayout,
  columns: readonly DatabaseViewColumn[]
): LayoutColumn[] {
  const listed = layout.kind === 'table' ? layout.columns : [];
  const byId = new Map(columns.map((column) => [column.id, column]));
  const shown = listed.flatMap((entry) => {
    const column = byId.get(entry.column);
    return column ? [{ column, width: entry.width ?? null }] : [];
  });
  const named = new Set(shown.map((entry) => entry.column.id));
  return [
    ...shown,
    ...columns
      .filter((column) => !named.has(column.id))
      .map((column) => ({ column, width: null })),
  ];
}

function tableLayout(entries: readonly LayoutColumn[]): ViewLayout {
  return {
    kind: 'table',
    columns: entries.map(
      (entry): ViewColumn => ({
        column: entry.column.id,
        width: entry.width,
      })
    ),
  };
}

/** The table layout with one column's width changed. */
export function withLayoutColumn(
  layout: ViewLayout,
  columns: readonly DatabaseViewColumn[],
  columnId: string,
  change: Partial<Pick<LayoutColumn, 'width'>>
): ViewLayout {
  return tableLayout(
    layoutColumns(layout, columns).map((entry) =>
      entry.column.id === columnId ? { ...entry, ...change } : entry
    )
  );
}

/** The table layout with its columns in `order`; columns it leaves out keep their places after. */
export function withLayoutOrder(
  layout: ViewLayout,
  columns: readonly DatabaseViewColumn[],
  order: readonly string[]
): ViewLayout {
  const entries = layoutColumns(layout, columns);
  const byId = new Map(entries.map((entry) => [entry.column.id, entry]));
  const ordered = order.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
  const placed = new Set(ordered.map((entry) => entry.column.id));
  return tableLayout([
    ...ordered,
    ...entries.filter((entry) => !placed.has(entry.column.id)),
  ]);
}

/**
 * The view of every row in the table's order, which a table always has:
 * not stored, so changing it changes only what this viewer sees.
 */
export function allRecordsView(table: {
  id: string;
  database_id: string;
}): DatabaseView {
  const epoch = new Date(0).toISOString();
  return {
    id: table.id,
    databaseId: table.database_id,
    tableId: table.id,
    name: 'All records',
    // The first key of an empty list: the engine reads only minted keys.
    position: '80',
    query: { filter: null, sort: [] },
    layout: { kind: 'table', columns: [] },
    createdAt: epoch,
    updatedAt: epoch,
  };
}

/** The single selects and single-person columns a board can group by. */
export function boardGroupColumns(
  columns: readonly DatabaseViewColumn[]
): DatabaseViewColumn[] {
  return columns.filter(isBoardGroupColumn);
}

/**
 * A new board grouped by `groupBy`, its cards titled by the first column and
 * showing the first few other fields.
 */
export function boardLayout(
  groupBy: string,
  columns: readonly DatabaseViewColumn[]
): ViewLayout {
  // `groupBy` is one of the columns, so there is a first one.
  const title = titleColumn(columns)?.id ?? groupBy;
  return {
    kind: 'board',
    groupBy,
    title,
    lanes: [],
    cardFields: columns
      .filter((column) => column.id !== groupBy && column.id !== title)
      .slice(0, 3)
      .map((column) => column.id),
    hideEmptyLanes: false,
  };
}

/** A lane as one string: for keyed lists, drop targets and comparing lanes. */
export function laneId(lane: LaneKey): string {
  return match(lane)
    .with({ kind: 'option' }, ({ id }) => `option:${id}`)
    .with({ kind: 'user' }, ({ id }) => `user:${id}`)
    .with({ kind: 'none' }, () => 'no-option')
    .exhaustive();
}

/** Whether two lane keys name the same lane. */
export function sameLane(left: LaneKey, right: LaneKey): boolean {
  return laneId(left) === laneId(right);
}

/** A person's lane is named by their email, the part of their user id after `macro|`. */
function personLabel(userId: string): string {
  const separator = userId.indexOf('|');
  return separator < 0 ? userId : userId.slice(separator + 1);
}

/**
 * What a board lane is called: its option's label, its person, or
 * `No <column>` for cards with an empty cell.
 */
export function laneLabel(
  groupColumn: DatabaseViewColumn,
  lane: LaneKey
): string {
  const empty = `No ${groupColumn.name.toLocaleLowerCase()}`;
  return match(lane)
    .with(
      { kind: 'option' },
      ({ id }) =>
        groupColumn.options.find((entry) => entry.id === id)?.label ?? empty
    )
    .with({ kind: 'user' }, ({ id }) => personLabel(id))
    .with({ kind: 'none' }, () => empty)
    .exhaustive();
}

/** The grid value a card created in `lane` starts with in the grouping column. */
export function laneValue(
  groupColumn: DatabaseViewColumn,
  lane: LaneKey
): string | undefined {
  return match(lane)
    .with(
      { kind: 'option' },
      ({ id }) => groupColumn.options.find((option) => option.id === id)?.label
    )
    .with({ kind: 'user' }, ({ id }) => id)
    .with({ kind: 'none' }, () => undefined)
    .exhaustive();
}

type BoardLayout = Extract<ViewLayout, { kind: 'board' }>;

/** The column a board titles its cards by. */
export function cardTitleColumn(
  layout: BoardLayout,
  columns: readonly DatabaseViewColumn[]
): DatabaseViewColumn | undefined {
  return columns.find((column) => column.id === layout.title);
}

/** The board with its lanes in `order`, keeping each lane's hidden flag. */
export function withLaneOrder(
  layout: BoardLayout,
  order: readonly LaneKey[]
): BoardLayout {
  return {
    ...layout,
    lanes: order.map((key) => ({
      key,
      hidden: layout.lanes.some(
        (lane) => sameLane(lane.key, key) && !!lane.hidden
      ),
    })),
  };
}

/** The board with one lane hidden or shown; the lanes it lists keep their order. */
export function withLaneHidden(
  layout: BoardLayout,
  key: LaneKey,
  hidden: boolean
): BoardLayout {
  const listed = layout.lanes.some((lane) => sameLane(lane.key, key));
  return {
    ...layout,
    lanes: listed
      ? layout.lanes.map((lane) =>
          sameLane(lane.key, key) ? { ...lane, hidden } : lane
        )
      : [...layout.lanes, { key, hidden }],
  };
}

function withoutColumnNode(
  node: FilterNode,
  columnId: string
): FilterNode | undefined {
  if (node.kind === 'condition')
    return node.column === columnId ? undefined : node;
  const conditions = node.conditions.flatMap((child) => {
    const kept = withoutColumnNode(child, columnId);
    return kept ? [kept] : [];
  });
  return conditions.length ? { ...node, conditions } : undefined;
}

/**
 * The view without a removed column: its conditions, sort key and layout
 * entry go. A board grouped by it has nothing else to group by, so the
 * column cannot be removed from it, as the service refuses too.
 */
export function withoutColumn(
  view: DatabaseView,
  columnId: string
): Result<DatabaseView, { kind: 'board-groups-by-column' }> {
  if (view.layout.kind === 'board' && view.layout.groupBy === columnId)
    return err({ kind: 'board-groups-by-column' });
  const filter = view.query.filter;
  const kept = filter
    ? withoutColumnNode({ kind: 'group', ...filter }, columnId)
    : undefined;
  return ok({
    ...view,
    query: {
      filter:
        kept?.kind === 'group'
          ? { conjunction: kept.conjunction, conditions: kept.conditions }
          : null,
      sort: (view.query.sort ?? []).filter((key) => key.column !== columnId),
    },
    layout:
      view.layout.kind === 'table'
        ? {
            ...view.layout,
            columns: view.layout.columns.filter(
              (entry) => entry.column !== columnId
            ),
          }
        : {
            ...view.layout,
            cardFields: view.layout.cardFields.filter((id) => id !== columnId),
          },
  });
}

/** The view order with `id` dropped onto `target`'s place; unchanged when either is unknown or they are the same. */
export function movedViewOrder(
  order: readonly string[],
  id: string,
  target: string
): string[] {
  const edge = order.indexOf(id) < order.indexOf(target) ? 'after' : 'before';
  return moveBeside(order, id, target, edge) ?? [...order];
}
