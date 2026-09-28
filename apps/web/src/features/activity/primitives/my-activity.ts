import { type Accessor, createMemo } from 'solid-js';
import type { ActivityContext } from '../context/activity-context';
import type { ActivityOverview } from '../core/event';
import { type FeedRow, flattenFeed, reuseRows } from '../core/feed-rows';
import { type FeedGroup, groupEventsByDay } from '../core/group-events';
import { createMyActivityQuery } from '../queries/feed-query';
import { createMyActivityOverviewQuery } from '../queries/overview-query';

export type FeedView =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'empty' }
  | {
      t: 'ready';
      groups: FeedGroup[];
      hasMore: boolean;
      loadingMore: boolean;
      /** The last next-page request failed; auto-paging waits for `retryMore`. */
      moreFailed: boolean;
    };

export type OverviewView =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'ready'; overview: ActivityOverview };

export type MyActivityState = {
  overview: Accessor<OverviewView>;
  feed: Accessor<FeedView>;
  /** Every virtualized row of the screen: the overview first, then the feed. */
  rows: Accessor<FeedRow[]>;
  /**
   * Fetch the next feed page. No-op while one is in flight, none remain, or
   * the last attempt failed (so a scroller resting near the end does not
   * hammer a failing endpoint).
   */
  loadMore: () => void;
  /** Retry the failed next page. The one way to page again after a failure. */
  retryMore: () => void;
};

/**
 * The Activity screen as data: overview and feed view states plus the one
 * action the screen exposes. Data wins over status flags so a background
 * refetch never blanks rows the user is reading.
 */
export function createMyActivityState(
  context: Pick<ActivityContext, 'graphql'>
): MyActivityState {
  const overviewQuery = createMyActivityOverviewQuery(context, {
    enabled: () => true,
  });
  const feedQuery = createMyActivityQuery(context, { enabled: () => true });
  const groups = createMemo(() => groupEventsByDay(feedQuery.data ?? []));

  const overview = createMemo<OverviewView>(() => {
    const data = overviewQuery.data;
    if (data) return { t: 'ready', overview: data };
    if (overviewQuery.isError) return { t: 'error' };
    return { t: 'loading' };
  });

  const feed = createMemo<FeedView>(() => {
    if (groups().length > 0) {
      return {
        t: 'ready',
        groups: groups(),
        hasMore: feedQuery.hasNextPage,
        loadingMore: feedQuery.isFetchingNextPage,
        moreFailed: feedQuery.isFetchNextPageError,
      };
    }
    if (feedQuery.isLoading) return { t: 'loading' };
    if (feedQuery.isError) return { t: 'error' };
    return { t: 'empty' };
  });

  const rows = createMemo<FeedRow[]>((previous) => {
    const current = feed();
    const feedRows: FeedRow[] =
      current.t === 'ready'
        ? flattenFeed(current.groups, { hasMore: current.hasMore })
        : [{ kind: 'status', status: current.t }];
    return reuseRows(previous, [{ kind: 'overview' }, ...feedRows]);
  }, []);

  const fetchNext = () => {
    if (!feedQuery.hasNextPage || feedQuery.isFetchingNextPage) return;
    void feedQuery.fetchNextPage();
  };

  return {
    overview,
    feed,
    rows,
    loadMore: () => {
      if (feedQuery.isFetchNextPageError) return;
      fetchNext();
    },
    retryMore: fetchNext,
  };
}
