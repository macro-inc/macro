import { createUrqlInfiniteQuery } from '@app/lib/urql-solid/create-urql-infinite-query';
import {
  type ActivityFeedInput,
  MyActivityDocument,
  type MyActivityQuery,
  type MyActivityQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import { registerActivityRevalidator } from '../../../lib/queries/activity/push-registry';
import type { ActivityContext } from '../context/activity-context';
import type { ActivityEvent, ActivityScope } from '../core/event';
import { decodeActivityEvent } from './decode';

/** Rows fetched per feed page. */
export const ACTIVITY_FEED_PAGE_LIMIT = 50;

/**
 * One page request for a feed. The viewer's own feed leaves `scope` out, so
 * it reads the same against servers that predate the team scope.
 */
function feedInput(
  scope: ActivityScope,
  cursor: string | null
): ActivityFeedInput {
  const page = { limit: ACTIVITY_FEED_PAGE_LIMIT, cursor };
  return scope === 'team' ? { ...page, scope: 'TEAM' } : page;
}

/**
 * Infinite query over one activity feed, newest first: the authenticated
 * user's own, or their teammates' on items shared with the user. Pages chase
 * the server's opaque keyset cursor until it comes back null.
 */
export function createMyActivityQuery(
  context: Pick<ActivityContext, 'graphql'>,
  options: { scope: ActivityScope; enabled: Accessor<boolean> }
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
    variables: (cursor) => ({ input: feedInput(options.scope, cursor) }),
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
