import { createUrqlInfiniteQuery } from '@app/lib/urql-solid/create-urql-infinite-query';
import {
  MyActivityDocument,
  type MyActivityQuery,
  type MyActivityQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Accessor } from 'solid-js';
import type { ActivityEvent } from './entity';

/** Rows fetched per feed page. */
export const ACTIVITY_FEED_PAGE_LIMIT = 50;

/**
 * Infinite query over the authenticated user's own activity, newest first.
 * Pages chase the server's opaque keyset cursor until it comes back null.
 */
export function createMyActivityQuery(options: { enabled: Accessor<boolean> }) {
  return createUrqlInfiniteQuery<
    MyActivityQuery,
    MyActivityQueryVariables,
    string | null,
    ActivityEvent[]
  >(() => ({
    query: MyActivityDocument,
    client: getGraphqlSoupClient(),
    initialPageParam: null,
    variables: (cursor) => ({
      input: { limit: ACTIVITY_FEED_PAGE_LIMIT, cursor },
    }),
    getNextPageParam: (lastPage) =>
      lastPage.user.activity.nextCursor ?? undefined,
    enabled: options.enabled(),
    requestPolicy: 'cache-and-network',
    keepPreviousData: true,
    select: ({ pages }) => pages.flatMap((page) => page.user.activity.items),
  }));
}
