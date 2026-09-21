import { createUrqlInfiniteQuery } from '@app/lib/urql-solid/create-urql-infinite-query';
import {
  MyActivityDocument,
  type MyActivityQuery,
  type MyActivityQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import { registerActivityRevalidator } from '../../../lib/queries/activity/push-registry';
import type { ActivityContext } from '../context/activity-context';
import type { ActivityEvent } from '../core/event';
import { decodeActivityEvent } from './decode';

/** Rows fetched per feed page. */
export const ACTIVITY_FEED_PAGE_LIMIT = 50;

/**
 * Infinite query over the authenticated user's own activity, newest first.
 * Pages chase the server's opaque keyset cursor until it comes back null.
 */
export function createMyActivityQuery(
  context: Pick<ActivityContext, 'graphql'>,
  options: { enabled: Accessor<boolean> }
) {
  const client = createMemo(context.graphql);
  const result = createUrqlInfiniteQuery<
    MyActivityQuery,
    MyActivityQueryVariables,
    string | null,
    ActivityEvent[]
  >(() => ({
    query: MyActivityDocument,
    client: client(),
    initialPageParam: null,
    variables: (cursor) => ({
      input: { limit: ACTIVITY_FEED_PAGE_LIMIT, cursor },
    }),
    getNextPageParam: (lastPage) =>
      lastPage.user.activity.nextCursor ?? undefined,
    enabled: options.enabled(),
    requestPolicy: 'cache-and-network',
    keepPreviousData: true,
    select: ({ pages }) =>
      pages
        .flatMap((page) => page.user.activity.items)
        .map(decodeActivityEvent),
  }));
  onCleanup(
    registerActivityRevalidator({
      client,
      refresh: () => {
        if (options.enabled())
          return result.refetch({ requestPolicy: 'network-only' });
      },
    })
  );
  return result;
}
