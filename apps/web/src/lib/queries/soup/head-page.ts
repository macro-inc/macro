/** The head is authoritative up to its final timestamp in the sort order. At that boundary,
 * millisecond precision cannot prove membership, so retain unknown ties.
 * First occurrence wins: a head record must beat an older page's copy. */
export function mergeHeadRows<Item>(
  current: readonly Item[],
  retained: readonly Item[],
  key: (item: Item) => string,
  timestamp: (item: Item) => number,
  direction: 'ASC' | 'DESC'
): Item[] {
  if (current.length === 0) return [];
  const order = direction === 'ASC' ? 1 : -1;
  const seen = new Set<string>();
  const decorate = (items: readonly Item[]) =>
    items.flatMap((item) => {
      const id = key(item);
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ item, id, time: timestamp(item) }];
    });
  const head = decorate(current);
  const edge = head.reduce((last, row) =>
    order * (row.time - last.time) > 0 ? row : last
  );
  const known = decorate(retained).filter(
    (row) =>
      !Number.isFinite(edge.time) ||
      !Number.isFinite(row.time) ||
      order * (row.time - edge.time) >= 0
  );
  return [...head, ...known]
    .sort(
      (left, right) =>
        order * (left.time - right.time || left.id.localeCompare(right.id))
    )
    .map(({ item }) => item);
}
