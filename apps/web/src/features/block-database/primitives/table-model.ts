import type { SortKey } from '@core/database-sql/generated/types';
import {
  type ColumnDef,
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createTable,
  type Header,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/solid-table';
import { createMemo, createSignal } from 'solid-js';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow } from '../core/table';

const MIN_COLUMN_WIDTH = 80;

const features = tableFeatures({
  columnOrderingFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature,
  columnMeta: {} as DatabaseViewColumn,
});

type DatabaseHeader = Header<typeof features, DatabaseRow>;

export type DatabaseTableModelOptions = {
  rows: DatabaseRow[];
  columns: DatabaseViewColumn[];
  columnOrder?: string[];
  sort: readonly SortKey[];
  widths: Record<string, number | null>;
  onSort: (columnId: string, direction: 'asc' | 'desc' | null) => void;
  onResizeColumn?: (columnId: string, width: number) => void;
};

/** TanStack owns the display model; SQL owns which records match and their order. */
export function createDatabaseTableModel(options: DatabaseTableModelOptions) {
  const columns = createMemo<ColumnDef<typeof features, DatabaseRow>[]>(() =>
    options.columns.map((column) => ({
      id: column.id,
      header: column.name,
      meta: column,
      accessorFn: (row) => row.cells[column.id] ?? null,
    }))
  );
  // Unsized columns use responsive CSS. Seed a drag from the actual DOM width.
  const [measured, setMeasured] = createSignal<{ id: string; width: number }>();
  const sizing = createMemo(() => {
    const sizes = Object.fromEntries(
      Object.entries(options.widths).filter(
        (entry): entry is [string, number] => entry[1] !== null
      )
    );
    const start = measured();
    if (start) sizes[start.id] = start.width;
    return sizes;
  });
  const sorting = createMemo(() =>
    options.sort.map((key) => ({
      id: key.column,
      desc: key.direction === 'descending',
    }))
  );
  const table = createTable({
    features,
    get data() {
      return options.rows;
    },
    get columns() {
      return columns();
    },
    getRowId: (row) => row.rowId,
    manualSorting: true,
    columnResizeMode: 'onEnd',
    defaultColumn: { minSize: MIN_COLUMN_WIDTH, size: 192 },
    state: {
      get sorting() {
        return sorting();
      },
      get columnOrder() {
        return options.columnOrder ?? [];
      },
      get columnSizing() {
        return sizing();
      },
    },
    onSortingChange: (update) => {
      const before = sorting();
      const after = typeof update === 'function' ? update(before) : update;
      for (const key of before)
        if (!after.some((next) => next.id === key.id))
          options.onSort(key.id, null);
      for (const key of after)
        if (!before.some((old) => old.id === key.id && old.desc === key.desc))
          options.onSort(key.id, key.desc ? 'desc' : 'asc');
    },
    onColumnSizingChange: (update) => {
      const after = typeof update === 'function' ? update(sizing()) : update;
      const id = table.atoms.columnResizing.get().isResizingColumn;
      if (id && after[id] !== undefined)
        options.onResizeColumn?.(
          id,
          Math.max(MIN_COLUMN_WIDTH, Math.round(after[id]))
        );
      setMeasured(undefined);
    },
  });
  const visibleColumns = createMemo(() =>
    table.getVisibleLeafColumns().map((column) => column.columnDef.meta!)
  );
  function resize(header: DatabaseHeader, event: MouseEvent | TouchEvent) {
    if (!options.onResizeColumn || ('button' in event && event.button !== 0))
      return;
    if ('touches' in event && event.touches.length !== 1) return;
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    const element = event.currentTarget;
    if (!(element instanceof HTMLElement)) return;
    setMeasured({
      id: header.column.id,
      width:
        element.parentElement?.getBoundingClientRect().width ??
        header.getSize(),
    });
    header.getResizeHandler(element.ownerDocument)(event);
  }
  function width(columnId: string): number | undefined {
    const resizing = table.atoms.columnResizing.get();
    if (resizing.isResizingColumn === columnId)
      return Math.max(
        MIN_COLUMN_WIDTH,
        Math.round((resizing.startSize ?? 0) + (resizing.deltaOffset ?? 0))
      );
    return options.widths[columnId] == null
      ? undefined
      : table.getColumn(columnId)?.getSize();
  }
  function sort(columnId: string, direction: 'asc' | 'desc' | null) {
    const column = table.getColumn(columnId);
    if (!column) return;
    if (direction === null) column.clearSorting();
    else column.toggleSorting(direction === 'desc', true);
  }
  return {
    table,
    visibleColumns,
    width,
    resize,
    sort,
  };
}

export type DatabaseTableModel = ReturnType<typeof createDatabaseTableModel>;
