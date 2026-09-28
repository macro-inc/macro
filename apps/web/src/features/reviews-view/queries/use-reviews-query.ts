import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { clause, compileClause, confine } from '@app/features/soup/filters';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { isGithubPrEntity } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import type { ReviewsScope, ReviewsSortId } from '../reviews-types';

/** Backend participant matching requires the viewer's linked GitHub user ID. */
export const reviewsQueryBody = (scope: ReviewsScope) =>
  compileClause(
    confine({
      fef:
        scope === 'involving'
          ? clause.and(
              clause.eq('foreignEntitySource', 'github_pull_request'),
              clause.eq('foreignEntityIncludesMe', true)
            )
          : clause.eq('foreignEntitySource', 'github_pull_request'),
    })
  );

/** GitHub pull requests accessible through Soup, with pagination. */
export function useReviewsQuery(
  sort: Accessor<ReviewsSortId>,
  scope: Accessor<ReviewsScope>,
  enabled: Accessor<boolean>
) {
  const notificationSource = useGlobalNotificationSource();
  const query = useSoupAstItemsQuery(
    () => ({
      params: {
        expand: true,
        limit: 100,
        sort_method: sort(),
        sort_direction: 'desc',
      },
      body: reviewsQueryBody(scope()),
    }),
    () => ({ enabled: enabled(), showSupportedForeignEntities: true })
  );

  const reviews = () => {
    if (!query.isEnabled || query.isLoading) return [];
    return (query.data?.entities ?? [])
      .filter(isGithubPrEntity)
      .map((entity) => withEntityNotifications(entity, notificationSource));
  };
  return {
    reviews,
    isLoading: () => query.isLoading,
    error: () => (reviews().length === 0 ? query.error : undefined),
    pageError: () => query.error,
    hasMore: () => query.hasNextPage,
    isLoadingMore: () => query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
    retry: () => query.refetch(),
  };
}
