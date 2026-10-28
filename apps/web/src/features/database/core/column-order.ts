import { moveBeside } from './move-beside';

/** The order with `columnId` dropped at `targetId`'s edge; `undefined` when nothing moves. */
export function reorderDatabaseColumns(
  order: readonly string[],
  columnId: string,
  targetId: string,
  edge: 'before' | 'after'
): string[] | undefined {
  const nextOrder = moveBeside(order, columnId, targetId, edge);
  return nextOrder?.some((id, index) => id !== order[index])
    ? nextOrder
    : undefined;
}

/** Apply a partial layout without moving omitted schema columns. */
export function mergeDatabaseColumnOrder(
  order: readonly string[],
  requestedOrder: readonly string[]
): string[] {
  const known = new Set(order);
  const requested = [...new Set(requestedOrder)].filter((id) => known.has(id));
  const included = new Set(requested);
  let index = 0;
  return order.map((id) => (included.has(id) ? requested[index++] : id));
}
