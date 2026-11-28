import { fireAndForget } from '@core/util/fireAndForget';
import { getGraphqlCacheHost } from '@service-storage/graphql-soup';
import { refreshActiveGraphqlSoupQueries } from './active-queries';

/** Read the lists left stale by a direct write. The uncached exchange reads
 * each mounted list in cursor order. A live cache that took the returned rows
 * leaves only unsupported lists stale. A failed cache write leaves all of
 * them stale. A failed read never makes the committed mutation retryable. */
export function refreshAfterWrite(result: {
  effectsResolved: boolean;
  listsReadAgain: boolean;
}) {
  if (result.listsReadAgain) return;
  const unmaintainedOnly =
    result.effectsResolved && getGraphqlCacheHost() !== undefined;
  fireAndForget(
    refreshActiveGraphqlSoupQueries({ unmaintainedOnly }),
    'entity-mutation'
  );
}
