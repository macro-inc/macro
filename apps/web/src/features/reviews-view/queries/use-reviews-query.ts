import {
  clause,
  compileClause,
  confine,
  type TargetExpr,
} from '@app/features/soup/filters';
import { type GithubPullRequestEntity, isGithubPrEntity } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import type { ReviewsScope, ReviewsSortId } from '../reviews-types';

/** What the Reviews list asks the backend for. */
export type ReviewsServerFilter = {
  scope: ReviewsScope;
  /** Numeric GitHub repository ids; any of them matches. */
  repositoryIds: readonly string[];
  /** Numeric GitHub user ids of authors; any of them matches. */
  authorIds: readonly string[];
  /** The viewer's GitHub user id, which "Authored by me" matches. */
  viewerGithubUserId?: string;
};

const anyOf = (field: string, ids: readonly string[]) =>
  clause.or(...ids.map((id) => clause.eq(field, id)));

/** Backend participant matching requires the viewer's linked GitHub user ID. */
export const reviewsQueryBody = (filter: ReviewsServerFilter) => {
  const pullRequest: TargetExpr[] = [];
  if (filter.repositoryIds.length > 0)
    pullRequest.push(
      anyOf('githubPullRequestRepositoryId', filter.repositoryIds)
    );
  if (filter.authorIds.length > 0)
    pullRequest.push(anyOf('githubPullRequestAuthorId', filter.authorIds));
  if (filter.scope === 'authored' && filter.viewerGithubUserId)
    pullRequest.push(
      clause.eq('githubPullRequestAuthorId', filter.viewerGithubUserId)
    );

  return compileClause(
    confine({
      fef:
        filter.scope === 'involving'
          ? clause.and(
              clause.eq('foreignEntitySource', 'github_pull_request'),
              clause.eq('foreignEntityIncludesMe', true)
            )
          : clause.eq('foreignEntitySource', 'github_pull_request'),
      ...(pullRequest.length > 0 ? { ghprf: clause.and(...pullRequest) } : {}),
    })
  );
};

/** GitHub pull requests accessible through Soup, with pagination. */
export function useReviewsQuery(
  sort: Accessor<ReviewsSortId>,
  filter: Accessor<ReviewsServerFilter>,
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
      body: reviewsQueryBody(filter()),
    }),
    () => ({ enabled: enabled(), showSupportedForeignEntities: true })
  );

  const reviews = (): GithubPullRequestEntity[] => {
    if (!query.isEnabled || query.isLoading) return [];
    return (query.data?.entities ?? []).filter(isGithubPrEntity);
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
