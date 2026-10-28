import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createMemo } from 'solid-js';
import type { ActivityContext } from '../context/activity-context';
import type { ActivityOverview, ActivityScope } from '../core/event';
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
  /**
   * Every virtualized row of the screen: on the viewer's own feed the
   * overview first, then the feed. The overview is the viewer's own, so the
   * team feed has none.
   */
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
 * action the screen exposes, for the feed `scope` selects. Each scope keeps
 * its own query, so switching tabs never shows the other feed's rows and
 * switching back finds the pages already loaded. Data wins over status
 * flags so a background refetch never blanks rows the user is reading.
 */
export function createMyActivityState(
  context: Pick<ActivityContext, 'graphql' | 'entityTypeShown'>,
  scope: Accessor<ActivityScope>
): MyActivityState {
  const overviewQuery = createMyActivityOverviewQuery(context, {
    enabled: () => true,
  });
  const mineQuery = createMyActivityQuery(context, {
    scope: 'mine',
    enabled: () => scope() === 'mine',
  });
  const teamQuery = createMyActivityQuery(context, {
    scope: 'team',
    enabled: () => scope() === 'team',
  });
  const feedQuery = () => (scope() === 'team' ? teamQuery : mineQuery);
  const groups = createMemo(() =>
    groupEventsByDay(
      (feedQuery().data ?? []).filter((event) =>
        context.entityTypeShown(event.entityType)
      )
    )
  );

  const overview = createMemo<OverviewView>(() => {
    const data = overviewQuery.data;
    if (data)
      return {
        t: 'ready',
        overview: {
          ...data,
          topEntities: data.topEntities.filter((entity) =>
            context.entityTypeShown(entity.entityType)
          ),
        },
      };
    if (overviewQuery.isError) return { t: 'error' };
    return { t: 'loading' };
  });

  const feed = createMemo<FeedView>(() => {
    const query = feedQuery();
    // A team page can arrive empty while older pages remain (the server
    // bounds each page's scan), so only the last page decides "empty".
    if (groups().length > 0 || query.hasNextPage) {
      return {
        t: 'ready',
        groups: groups(),
        hasMore: query.hasNextPage,
        loadingMore: query.isFetchingNextPage,
        moreFailed: query.isFetchNextPageError,
      };
    }
    if (query.isLoading) return { t: 'loading' };
    if (query.isError) return { t: 'error' };
    return { t: 'empty' };
  });

  const rows = createMemo<FeedRow[]>((previous) => {
    const current = feed();
    const feedRows: FeedRow[] =
      current.t === 'ready'
        ? flattenFeed(current.groups, { hasMore: current.hasMore })
        : [{ kind: 'status', status: current.t }];
    return reuseRows(
      previous,
      scope() === 'team' ? feedRows : [{ kind: 'overview' }, ...feedRows]
    );
  }, []);

  const fetchNext = () => {
    const query = feedQuery();
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    fireAndForget(query.fetchNextPage(), 'activity');
  };

  return {
    overview,
    feed,
    rows,
    loadMore: () => {
      if (feedQuery().isFetchNextPageError) return;
      fetchNext();
    },
    retryMore: fetchNext,
  };
}
