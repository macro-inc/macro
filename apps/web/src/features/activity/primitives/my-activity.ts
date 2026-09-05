import { type Accessor, createMemo } from 'solid-js';
import type { ActivityContext } from '../context/activity-context';
import type { ActivityOverview } from '../core/event';
import { type FeedGroup, groupEventsByDay } from '../core/group-events';
import { createMyActivityQuery } from '../queries/feed-query';
import { createMyActivityOverviewQuery } from '../queries/overview-query';

export type FeedView =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'empty' }
  | { t: 'ready'; groups: FeedGroup[]; hasMore: boolean; loadingMore: boolean };

export type OverviewView =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'ready'; overview: ActivityOverview };

export type MyActivityState = {
  overview: Accessor<OverviewView>;
  feed: Accessor<FeedView>;
  loadMore: () => void;
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
      };
    }
    if (feedQuery.isLoading) return { t: 'loading' };
    if (feedQuery.isError) return { t: 'error' };
    return { t: 'empty' };
  });

  return {
    overview,
    feed,
    loadMore: () => void feedQuery.fetchNextPage(),
  };
}
