/** Insert at a visible header edge while preserving each hidden column's slot. */
export function reorderDatabaseColumns(
  order: readonly string[],
  hiddenColumns: readonly string[],
  columnId: string,
  targetId: string,
  edge: 'before' | 'after'
): string[] | undefined {
  const hidden = new Set(hiddenColumns);
  const visible = order.filter((id) => !hidden.has(id));
  const from = visible.indexOf(columnId);
  if (from < 0 || columnId === targetId || !visible.includes(targetId)) return;

  visible.splice(from, 1);
  const insertion = visible.indexOf(targetId) + (edge === 'after' ? 1 : 0);
  visible.splice(insertion, 0, columnId);
  const nextOrder = mergeDatabaseColumnOrder(order, visible);
  return nextOrder.some((id, index) => id !== order[index])
    ? nextOrder
    : undefined;
}

/** Apply a partial layout without moving omitted schema columns, such as lookups. */
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
