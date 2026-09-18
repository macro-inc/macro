import { match } from 'ts-pattern';

export type DatabaseCellValue = string | number | null;

/** View state uses stable column ids, never names or SQL expressions. */
export type DatabaseViewColumn = {
  id: string;
  name: string;
  dataType: string;
  isMultiSelect: boolean;
  options: (string | number)[];
  writable: boolean;
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
  filters: DatabaseFilter[];
  sorts: DatabaseSort[];
  hiddenColumns: string[];
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
    !column.isMultiSelect &&
    ['SELECT_STRING', 'SELECT_NUMBER', 'BOOLEAN'].includes(column.dataType)
  );
}

function isEmpty(value: DatabaseCellValue): boolean {
  return value === null || value === '' || value === '[]';
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
  if (filter.operator === 'is_empty') return isEmpty(value);
  if (filter.operator === 'is_not_empty') return !isEmpty(value);
  // An unfinished filter must not make a table appear to have lost its rows.
  if (!filter.value.trim()) return true;
  if (isEmpty(value)) return false;
  const left = comparable(value, column);
  const right = comparable(filter.value, column);
  if (typeof right === 'number' && !Number.isFinite(right)) return true;
  return match(filter.operator)
    .with('equals', () => left === right)
    .with('not_equals', () => left !== right)
    .with('contains', () => String(left).includes(String(right)))
    .with('not_contains', () => !String(left).includes(String(right)))
    .with('starts_with', () => String(left).startsWith(String(right)))
    .with('gt', () => left > right)
    .with('gte', () => left >= right)
    .with('lt', () => left < right)
    .with('lte', () => left <= right)
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
        String(getValue(row, column.id) ?? '')
          .toLocaleLowerCase()
          .includes(search)
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
      if (isEmpty(aValue) && isEmpty(bValue)) continue;
      if (isEmpty(aValue)) return 1;
      if (isEmpty(bValue)) return -1;
      const left = comparable(aValue, column);
      const right = comparable(bValue, column);
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
    if (isEmpty(value)) return null;
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
  for (const row of rows) addGroup(getValue(row, column.id)).rows.push(row);
  addGroup(null);
  return [...groups.values()];
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

export function isDatabaseViewConfig(value: unknown): value is DatabaseViewConfig {
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
    value.hiddenColumns.every((id) => typeof id === 'string')
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
  return {
    ...view,
    groupBy: columns.some(
      (column) => column.id === view.groupBy && isBoardGroupColumn(column)
    )
      ? view.groupBy
      : (columns.find(isBoardGroupColumn)?.id ?? null),
    filters: view.filters.filter((filter) => ids.has(filter.columnId)),
    sorts: view.sorts.filter((sort) => ids.has(sort.columnId)),
    hiddenColumns: view.hiddenColumns.filter((id) => ids.has(id)),
  };
}
