import { thrownResultErrorHasCode } from '@core/util/result';

/**
 * The record `matches` picks from a list query's cache. Undefined while the
 * first fetch is pending (reading `data` then would suspend the screen). A
 * refetch that failed for a while keeps the last list on screen (FE-48); one
 * refused as forbidden or not found means the list is gone for this person,
 * and a successful one that dropped the record drops it.
 */
export function cachedRecord<Item>(
  query: {
    isPending: boolean;
    error?: unknown;
    data: readonly Item[] | undefined;
  },
  matches: (item: Item) => boolean
): Item | undefined {
  if (query.isPending) return undefined;
  if (
    thrownResultErrorHasCode(query.error, 'FORBIDDEN') ||
    thrownResultErrorHasCode(query.error, 'NOT_FOUND')
  )
    return undefined;
  return query.data?.find(matches);
}
