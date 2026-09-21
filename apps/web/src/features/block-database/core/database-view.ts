import { match } from 'ts-pattern';
import type { DatabaseEntityType } from './column-inference';
import { relatedRowIds } from './database-relations';

export type DatabaseCellValue = string | number | null;

/** View state uses stable column ids, never names or SQL expressions. */
export type DatabaseViewColumn = {
  id: string;
  name: string;
  dataType: string;
  isMultiSelect: boolean;
  options: (string | number)[];
  writable: boolean;
  specificEntityType?: DatabaseEntityType | null;
  /** A new, empty Text column may adopt the type of its first entry. */
  inferType?: boolean;
  /** A relationship points to rows in a table, independently of the property's scalar type. */
  relation?: {
    databaseId: string;
    tableId: string;
    labels?: Record<string, string>;
  };
};

export type DatabaseFilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'starts_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte';

export type DatabaseFilter = {
  id: string;
  columnId: string;
  operator: DatabaseFilterOperator;
  value: string;
};

export type DatabaseSort = {
  columnId: string;
  direction: 'asc' | 'desc';
};

export type DatabaseViewConfig = {
  layout: 'table' | 'board';
  groupBy: string | null;
  /** Lane keys in the user’s preferred order; new lanes follow alphabetically. */
  groupOrder?: string[];
  filters: DatabaseFilter[];
  sorts: DatabaseSort[];
  hiddenColumns: string[];
  /** Omitted on older views; unlisted columns follow in schema order. */
  columnOrder?: string[];
  search: string;
};

export type SavedDatabaseViewConfig = {
  kind: 'database-view';
  version: 1;
  databaseId: string;
  tableId: string;
  view: DatabaseViewConfig;
};

export type SavedDatabaseView = {
  id: string;
  name: string;
  view: DatabaseViewConfig;
};

export function defaultDatabaseView(): DatabaseViewConfig {
  return {
    layout: 'table',
    groupBy: null,
    filters: [],
    sorts: [],
    hiddenColumns: [],
    search: '',
  };
}

/** Stable ids preserve layout through schema changes without dropping fresh columns. */
export function orderDatabaseColumns(
  columns: readonly DatabaseViewColumn[],
  order: readonly string[] = []
): DatabaseViewColumn[] {
  const remaining = new Map(columns.map((column) => [column.id, column]));
  const ordered: DatabaseViewColumn[] = [];
  for (const id of order) {
    const column = remaining.get(id);
    if (!column) continue;
    ordered.push(column);
    remaining.delete(id);
  }
  return [...ordered, ...remaining.values()];
}

/** Move past the next visible column; hidden fields keep their place for later. */
export function moveDatabaseViewColumn(
  view: DatabaseViewConfig,
  columns: readonly DatabaseViewColumn[],
  columnId: string,
  direction: 'left' | 'right'
): DatabaseViewConfig {
  const ordered = orderDatabaseColumns(columns, view.columnOrder);
  const visible = ordered.filter(
    (column) => !view.hiddenColumns.includes(column.id)
  );
  const index = visible.findIndex((column) => column.id === columnId);
  const neighbor = visible[index + (direction === 'left' ? -1 : 1)];
  if (index < 0 || !neighbor) return view;
  const columnOrder = ordered.map((column) => column.id);
  const from = columnOrder.indexOf(columnId);
  const to = columnOrder.indexOf(neighbor.id);
  [columnOrder[from], columnOrder[to]] = [neighbor.id, columnId];
  return reconcileDatabaseView({ ...view, columnOrder }, columns);
}

export const FILTER_OPERATORS: {
  value: DatabaseFilterOperator;
  label: string;
}[] = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

export function filterNeedsValue(operator: DatabaseFilterOperator): boolean {
  return operator !== 'is_empty' && operator !== 'is_not_empty';
}

export function filterOperatorsFor(column: DatabaseViewColumn) {
  const numeric = column.dataType === 'NUMBER';
  const date = column.dataType === 'DATE';
  const categorical =
    column.dataType === 'BOOLEAN' || column.dataType.startsWith('SELECT_');
  return FILTER_OPERATORS.filter(({ value }) => {
    if (['gt', 'gte', 'lt', 'lte'].includes(value)) return numeric || date;
    if (['contains', 'not_contains', 'starts_with'].includes(value))
      return !numeric && !date && !categorical;
    return true;
  }).map((operator) => {
    if (column.isMultiSelect && column.dataType.startsWith('SELECT_')) {
      if (operator.value === 'equals')
        return { ...operator, label: 'contains' };
      if (operator.value === 'not_equals')
        return { ...operator, label: 'does not contain' };
    }
    if (!date) return operator;
    const dateLabel: Partial<Record<DatabaseFilterOperator, string>> = {
      gt: 'is after',
      gte: 'is on or after',
      lt: 'is before',
      lte: 'is on or before',
    };
    return { ...operator, label: dateLabel[operator.value] ?? operator.label };
  });
}

export function isBoardGroupColumn(column: DatabaseViewColumn): boolean {
  return (
    !column.relation &&
    ['SELECT_STRING', 'SELECT_NUMBER', 'BOOLEAN'].includes(column.dataType)
  );
}

export function databaseCellValues(
  value: DatabaseCellValue,
  column: DatabaseViewColumn
): DatabaseCellValue[] {
  if (column.relation)
    return relatedRowIds(value).map(
      (id) => column.relation?.labels?.[id] ?? 'Unavailable record'
    );
  if (column.isMultiSelect && typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed))
        return parsed.filter(
          (item): item is DatabaseCellValue =>
            item === null ||
            typeof item === 'string' ||
            typeof item === 'number'
        );
    } catch {
      // Older scalar values remain searchable when a property becomes multi-value.
    }
  }
  return [value];
}

function isEmpty(
  value: DatabaseCellValue,
  column: DatabaseViewColumn
): boolean {
  return databaseCellValues(value, column).every(
    (item) => item === null || item === ''
  );
}

function comparable(value: DatabaseCellValue, column: DatabaseViewColumn) {
  if (column.dataType === 'NUMBER' || column.dataType === 'BOOLEAN') {
    return Number(value);
  }
  // Date filters are calendar-day comparisons. SQL values may carry an RFC3339
  // time suffix, whereas a date input supplies YYYY-MM-DD.
  if (column.dataType === 'DATE') return String(value).slice(0, 10);
  return String(value).toLocaleLowerCase();
}

export function matchesDatabaseFilter(
  value: DatabaseCellValue,
  column: DatabaseViewColumn,
  filter: DatabaseFilter
): boolean {
  if (filter.operator === 'is_empty') return isEmpty(value, column);
  if (filter.operator === 'is_not_empty') return !isEmpty(value, column);
  // An unfinished filter must not make a table appear to have lost its rows.
  if (!filter.value.trim()) return true;
  const right = comparable(filter.value, column);
  if (typeof right === 'number' && !Number.isFinite(right)) return true;
  const values = databaseCellValues(value, column)
    .filter((item) => item !== null && item !== '')
    .map((item) => comparable(item, column));
  if (!values.length && !column.isMultiSelect) return false;
  return match(filter.operator)
    .with('equals', () => values.some((left) => left === right))
    .with('not_equals', () => values.every((left) => left !== right))
    .with('contains', () =>
      values.some((left) => String(left).includes(String(right)))
    )
    .with('not_contains', () =>
      values.every((left) => !String(left).includes(String(right)))
    )
    .with('starts_with', () =>
      values.some((left) => String(left).startsWith(String(right)))
    )
    .with('gt', () => values.some((left) => left > right))
    .with('gte', () => values.some((left) => left >= right))
    .with('lt', () => values.some((left) => left < right))
    .with('lte', () => values.some((left) => left <= right))
    .exhaustive();
}

/** Search, then AND filters, then stable multi-column sorting. Never mutates rows. */
export function applyDatabaseView<Row>(
  rows: readonly Row[],
  columns: readonly DatabaseViewColumn[],
  view: DatabaseViewConfig,
  getValue: (row: Row, columnId: string) => DatabaseCellValue
): Row[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const search = view.search.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => {
    if (
      search &&
      !columns.some((column) =>
        databaseCellValues(getValue(row, column.id), column).some((value) =>
          String(value ?? '')
            .toLocaleLowerCase()
            .includes(search)
        )
      )
    )
      return false;
    return view.filters.every((filter) => {
      const column = byId.get(filter.columnId);
      return (
        !column ||
        matchesDatabaseFilter(getValue(row, column.id), column, filter)
      );
    });
  });
  if (!view.sorts.length) return filtered;
  return filtered.sort((a, b) => {
    for (const sort of view.sorts) {
      const column = byId.get(sort.columnId);
      if (!column) continue;
      const aValue = getValue(a, column.id);
      const bValue = getValue(b, column.id);
      // Empty cells stay at the end in either direction.
      if (isEmpty(aValue, column) && isEmpty(bValue, column)) continue;
      if (isEmpty(aValue, column)) return 1;
      if (isEmpty(bValue, column)) return -1;
      const left = comparable(
        column.relation
          ? databaseCellValues(aValue, column).join(', ')
          : aValue,
        column
      );
      const right = comparable(
        column.relation
          ? databaseCellValues(bValue, column).join(', ')
          : bValue,
        column
      );
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), undefined, {
              numeric: true,
              sensitivity: 'base',
            });
      if (order) return sort.direction === 'asc' ? order : -order;
    }
    return 0;
  });
}

export type DatabaseRowGroup<Row> = {
  key: string;
  label: string;
  value: DatabaseCellValue;
  rows: Row[];
};

/** Configured options stay visible even when empty, so they are drop targets. */
export function groupDatabaseRows<Row>(
  rows: readonly Row[],
  column: DatabaseViewColumn,
  getValue: (row: Row, columnId: string) => DatabaseCellValue
): DatabaseRowGroup<Row>[] {
  const groups = new Map<string, DatabaseRowGroup<Row>>();
  const normalize = (value: DatabaseCellValue): DatabaseCellValue => {
    if (isEmpty(value, column)) return null;
    if (column.dataType === 'BOOLEAN') return Number(value) ? 1 : 0;
    // SELECT_NUMBER, like SELECT_STRING, exposes labels as SQLite TEXT.
    return String(value);
  };
  const addGroup = (rawValue: DatabaseCellValue) => {
    const value = normalize(rawValue);
    const key = value === null ? 'empty' : `value:${JSON.stringify(value)}`;
    let group = groups.get(key);
    if (!group) {
      const label =
        value === null
          ? `No ${column.name.toLocaleLowerCase()}`
          : column.dataType === 'BOOLEAN'
            ? value === 1
              ? 'Checked'
              : 'Unchecked'
            : String(value);
      group = { key, label, value, rows: [] };
      groups.set(key, group);
    }
    return group;
  };
  for (const value of column.dataType === 'BOOLEAN' ? [0, 1] : column.options)
    addGroup(value);
  for (const row of rows) {
    const values = databaseCellValues(getValue(row, column.id), column);
    for (const value of new Set(values.length ? values : [null]))
      addGroup(value).rows.push(row);
  }
  addGroup(null);
  return [...groups.values()].sort((a, b) =>
    a.value === null
      ? 1
      : b.value === null
        ? -1
        : a.label.localeCompare(b.label, undefined, {
            numeric: true,
            sensitivity: 'base',
          })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFilter(value: unknown): value is DatabaseFilter {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.columnId === 'string' &&
    typeof value.value === 'string' &&
    FILTER_OPERATORS.some((operator) => operator.value === value.operator)
  );
}

function isSort(value: unknown): value is DatabaseSort {
  return (
    isRecord(value) &&
    typeof value.columnId === 'string' &&
    (value.direction === 'asc' || value.direction === 'desc')
  );
}

export function isDatabaseViewConfig(
  value: unknown
): value is DatabaseViewConfig {
  return (
    isRecord(value) &&
    (value.layout === 'table' || value.layout === 'board') &&
    (value.groupBy === null || typeof value.groupBy === 'string') &&
    typeof value.search === 'string' &&
    Array.isArray(value.filters) &&
    value.filters.every(isFilter) &&
    Array.isArray(value.sorts) &&
    value.sorts.every(isSort) &&
    Array.isArray(value.hiddenColumns) &&
    value.hiddenColumns.every((id) => typeof id === 'string') &&
    (value.groupOrder === undefined ||
      (Array.isArray(value.groupOrder) &&
        value.groupOrder.every((id) => typeof id === 'string'))) &&
    (value.columnOrder === undefined ||
      (Array.isArray(value.columnOrder) &&
        value.columnOrder.every((id) => typeof id === 'string')))
  );
}

export function isSavedDatabaseViewConfig(
  value: unknown
): value is SavedDatabaseViewConfig {
  return (
    isRecord(value) &&
    value.kind === 'database-view' &&
    value.version === 1 &&
    typeof value.databaseId === 'string' &&
    typeof value.tableId === 'string' &&
    isDatabaseViewConfig(value.view)
  );
}

/** Adding a field or loading an older view never makes fresh fields disappear. */
export function reconcileDatabaseView(
  view: DatabaseViewConfig,
  columns: readonly DatabaseViewColumn[]
): DatabaseViewConfig {
  const ids = new Set(columns.map((column) => column.id));
  const columnOrder = orderDatabaseColumns(columns, view.columnOrder).map(
    (column) => column.id
  );
  return {
    ...view,
    // Canonical schema order keeps a restored default view from looking unsaved.
    columnOrder: columnOrder.every((id, index) => id === columns[index].id)
      ? undefined
      : columnOrder,
    groupBy: columns.some(
      (column) => column.id === view.groupBy && isBoardGroupColumn(column)
    )
      ? view.groupBy
      : view.layout === 'board'
        ? (columns.find(isBoardGroupColumn)?.id ?? null)
        : null,
    filters: view.filters.filter((filter) => ids.has(filter.columnId)),
    sorts: view.sorts.filter((sort) => ids.has(sort.columnId)),
    hiddenColumns: view.hiddenColumns.filter((id) => ids.has(id)),
  };
}

/** Preserve unrelated tags when moving one occurrence of a multi-select card. */
export function boardMoveValue(
  column: DatabaseViewColumn,
  current: DatabaseCellValue,
  target: DatabaseCellValue,
  from?: DatabaseCellValue
): DatabaseCellValue {
  if (!column.isMultiSelect) return target;
  if (target === null) return '[]';
  const values = databaseCellValues(current, column).filter(
    (value) => value !== null && value !== '' && value !== from
  );
  return JSON.stringify([...new Set([...values, target])]);
}

export function orderDatabaseGroups<Row>(
  groups: readonly DatabaseRowGroup<Row>[],
  order: readonly string[] = []
): DatabaseRowGroup<Row>[] {
  const remaining = new Map(groups.map((group) => [group.key, group]));
  const ordered: DatabaseRowGroup<Row>[] = [];
  for (const key of order) {
    const group = remaining.get(key);
    if (group) {
      ordered.push(group);
      remaining.delete(key);
    }
  }
  return [...ordered, ...remaining.values()];
}
