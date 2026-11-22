/**
 * The record `matches` picks from a list query's cache. Undefined only while
 * the first fetch is pending (reading `data` then would suspend the screen);
 * a failed refetch keeps the last list on screen (FE-48), and a successful
 * one that dropped the record drops it.
 */
export function cachedRecord<Item>(
  query: { isPending: boolean; data: readonly Item[] | undefined },
  matches: (item: Item) => boolean
): Item | undefined {
  if (query.isPending) return undefined;
  return query.data?.find(matches);
}
