import { until } from '@solid-primitives/promise';
import { Mutex } from 'async-mutex';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { reorderDatabaseColumns } from '../core/column-order';
import {
  columnSchemaMessage,
  type DatabaseSchemaChange,
} from '../core/column-schema';
import type { DatabaseViewColumn } from '../core/database-view';
import { withSort } from '../core/view-query';
import type { DatabaseViewState, ViewChange } from '../core/view-state';
import {
  layoutColumns,
  withLayoutColumn,
  withLayoutOrder,
  withoutColumn,
} from '../core/views';

/**
 * A view's columns as the table shows them, and the header actions that
 * change them: sorting, resizing, reordering and inserting.
 */
export function createColumnLayout(options: {
  view: Accessor<DatabaseViewState>;
  columns: Accessor<DatabaseViewColumn[]>;
  canEdit: Accessor<boolean>;
  /** Whether the view is stored, so its own layout holds the column order. */
  stored: Accessor<boolean>;
  changeView: (change: ViewChange) => void;
  /** Saves the table's own column order, which All records follows. */
  saveColumnOrder?: (columnIds: string[]) => DatabaseSchemaChange;
  /** Creates a column at the table's end and returns its id. */
  createColumn?: () => DatabaseSchemaChange<string>;
  /** Opens a header's rename, as for a column just inserted. */
  renameColumn: (columnId: string) => void;
}) {
  const [schemaError, setSchemaError] = createSignal('');
  const orderMutex = new Mutex();
  let orderSequence = 0;
  let pendingOrders = 0;
  let confirmedOrder: string[] = [];
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const layout = () => layoutColumns(options.view().layout, options.columns());
  const visibleColumns = () => layout().map((entry) => entry.column);
  const widths = () =>
    Object.fromEntries(layout().map((entry) => [entry.column.id, entry.width]));
  const columnOrder = () => layout().map((entry) => entry.column.id);

  function sort(columnId: string, direction: 'asc' | 'desc' | null) {
    const query = options.view().query;
    options.changeView({
      query: {
        ...query,
        sort: withSort(
          query.sort ?? [],
          columnId,
          direction === null
            ? null
            : direction === 'asc'
              ? 'ascending'
              : 'descending'
        ),
      },
    });
  }
  function resizeColumn(columnId: string, width: number) {
    options.changeView({
      layout: withLayoutColumn(
        options.view().layout,
        options.columns(),
        columnId,
        { width }
      ),
    });
  }
  /**
   * A local view forgets a deleted column; the server does it for stored ones.
   * Columns are deleted from table headers, so no board grouped by one gets here.
   */
  function forgetColumn(columnId: string) {
    if (options.stored()) return;
    withoutColumn(options.view(), columnId).map(({ query, layout }) =>
      options.changeView({ query, layout })
    );
  }
  /**
   * A drop moves the header at once. A stored view keeps its own column
   * order; All records follows the table's, which the drop then saves.
   */
  async function reorderColumn(
    columnId: string,
    targetId: string,
    edge: 'before' | 'after'
  ) {
    const order = columnOrder();
    const nextOrder = reorderDatabaseColumns(order, columnId, targetId, edge);
    if (!nextOrder) return;
    setSchemaError('');
    const showOrder = (ids: readonly string[]) =>
      options.changeView({
        layout: withLayoutOrder(options.view().layout, options.columns(), ids),
      });
    showOrder(nextOrder);
    const persist =
      options.canEdit() && !options.stored()
        ? options.saveColumnOrder
        : undefined;
    if (!persist) return;
    const sequence = ++orderSequence;
    if (pendingOrders++ === 0) confirmedOrder = order;
    try {
      // Each request reads the schema version refreshed by the previous write.
      // Queue complete orders so a later drop includes all optimistic moves.
      const persisted = await orderMutex.runExclusive(async () => {
        const result = await persist(nextOrder);
        if (result.isOk()) confirmedOrder = nextOrder;
        return result;
      });
      if (disposed || sequence !== orderSequence) return;
      if (persisted.isOk()) {
        setSchemaError('');
        return;
      }
      const currentOrder = columnOrder();
      // A view selection made during the write owns its own column layout.
      if (
        currentOrder.length === nextOrder.length &&
        currentOrder.every((id, index) => id === nextOrder[index])
      )
        showOrder(confirmedOrder);
      setSchemaError(columnSchemaMessage(persisted.error));
    } finally {
      pendingOrders--;
    }
  }
  async function insertColumn(targetId: string, side: 'left' | 'right') {
    const create = options.createColumn;
    if (!create) return;
    setSchemaError('');
    const result = await create();
    if (disposed) return;
    if (result.isErr()) {
      setSchemaError(columnSchemaMessage(result.error));
      return;
    }
    const created = result.value;
    // The new column arrives with the refreshed schema, at the table's end.
    await until(() =>
      options.columns().some((column) => column.id === created)
    );
    await reorderColumn(
      created,
      targetId,
      side === 'left' ? 'before' : 'after'
    );
    options.renameColumn(created);
  }
  function moveColumn(columnId: string, direction: 'left' | 'right') {
    const columns = visibleColumns();
    const target =
      columns[
        columns.findIndex((column) => column.id === columnId) +
          (direction === 'left' ? -1 : 1)
      ];
    if (target)
      void reorderColumn(
        columnId,
        target.id,
        direction === 'left' ? 'before' : 'after'
      );
  }
  return {
    columnOrder,
    visibleColumns,
    widths,
    schemaError,
    sort,
    resizeColumn,
    forgetColumn,
    reorderColumn,
    insertColumn,
    moveColumn,
  };
}
