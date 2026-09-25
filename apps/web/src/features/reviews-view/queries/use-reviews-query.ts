import { clause, compileClause, confine } from '@app/features/soup/filters';
import { type GithubPullRequestEntity, isGithubPrEntity } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import type { ReviewsSortId } from '../reviews-types';

/** Relevant open pull requests from the Inbox criterion, with Soup pagination. */
export function useReviewsQuery(
  sort: Accessor<ReviewsSortId>,
  enabled: Accessor<boolean>
) {
  const query = useSoupAstItemsQuery(
    () => ({
      params: {
        expand: true,
        limit: 100,
        sort_method: sort(),
        sort_direction: 'desc',
      },
      body: compileClause(
        confine({
          fef: clause.and(
            clause.eq('foreignEntitySource', 'github_pull_request'),
            clause.eq('foreignEntityDone', false),
            clause.eq('foreignEntityIncludesMe', true)
          ),
        })
      ),
    }),
    () => ({ enabled: enabled(), showSupportedForeignEntities: true })
  );

  const reviews = (): GithubPullRequestEntity[] => {
    if (!query.isEnabled || query.isLoading) return [];
    return (query.data?.entities ?? [])
      .filter(isGithubPrEntity)
      .filter((review) => review.metadata.status === 'open');
  };
  return {
    reviews,
    isLoading: () => query.isLoading,
    error: () => (reviews().length === 0 ? query.error : undefined),
    hasMore: () => query.hasNextPage,
    isLoadingMore: () => query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
    retry: () => query.refetch(),
  };
}
