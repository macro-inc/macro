import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import {
  clause,
  compileClause,
  confine,
  type TargetExpr,
} from '@app/features/soup/filters';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { isGithubPrEntity } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import type {
  ReviewsFilterSelection,
  ReviewsReviewFilterId,
  ReviewsScope,
  ReviewsSortId,
} from '../reviews-types';

/** What the Reviews list asks the backend for. */
export type ReviewsServerFilter = {
  scope: ReviewsScope;
  /**
   * Repository and author selections are numeric GitHub ids, assignees are
   * numeric GitHub user ids, and labels are label names.
   */
  filters: ReviewsFilterSelection;
  /** The viewer's GitHub user id, which the "me" scopes and filters match. */
  viewerGithubUserId?: string;
};

const REVIEWS_SORTS: Record<
  ReviewsSortId,
  { sort_method: 'updated_at' | 'created_at'; sort_direction: 'asc' | 'desc' }
> = {
  // Priority comes from links, so loaded rows are ordered on the client.
  priority: { sort_method: 'updated_at', sort_direction: 'desc' },
  recently_updated: { sort_method: 'updated_at', sort_direction: 'desc' },
  least_recently_updated: { sort_method: 'updated_at', sort_direction: 'asc' },
  newest: { sort_method: 'created_at', sort_direction: 'desc' },
  oldest: { sort_method: 'created_at', sort_direction: 'asc' },
};

const anyOf = (field: string, ids: readonly string[]) =>
  clause.or(...ids.map((id) => clause.eq(field, id)));

function reviewClause(
  id: ReviewsReviewFilterId,
  viewer: string | undefined
): TargetExpr | undefined {
  switch (id) {
    case 'reviewed_by_me':
      return viewer
        ? clause.eq('githubPullRequestReviewedBy', viewer)
        : undefined;
    case 'not_reviewed_by_me':
      return viewer
        ? clause.not(clause.eq('githubPullRequestReviewedBy', viewer))
        : undefined;
    case 'awaiting_my_review':
      return viewer
        ? clause.eq('githubPullRequestReviewRequested', viewer)
        : undefined;
  }
}

const SCOPE_FIELDS: Partial<Record<ReviewsScope, string>> = {
  authored: 'githubPullRequestAuthorId',
  assigned: 'githubPullRequestAssigneeId',
  review_requests: 'githubPullRequestReviewRequested',
};

/** Backend participant matching requires the viewer's linked GitHub user ID. */
export const reviewsQueryBody = (filter: ReviewsServerFilter) => {
  const { filters, viewerGithubUserId: viewer } = filter;
  const pullRequest: TargetExpr[] = [];
  if (filters.repository.length > 0)
    pullRequest.push(
      anyOf('githubPullRequestRepositoryId', filters.repository)
    );
  if (filters.author.length > 0)
    pullRequest.push(anyOf('githubPullRequestAuthorId', filters.author));
  if (filters.assignee.length > 0)
    pullRequest.push(anyOf('githubPullRequestAssigneeId', filters.assignee));
  if (filters.label.length > 0)
    pullRequest.push(anyOf('githubPullRequestLabel', filters.label));
  const reviews = filters.review.flatMap(
    (id) => reviewClause(id as ReviewsReviewFilterId, viewer) ?? []
  );
  if (reviews.length > 0) pullRequest.push(clause.or(...reviews));
  const scopeField = SCOPE_FIELDS[filter.scope];
  if (scopeField && viewer) pullRequest.push(clause.eq(scopeField, viewer));

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
  const notificationSource = useGlobalNotificationSource();
  const query = useSoupAstItemsQuery(
    () => ({
      params: {
        expand: true,
        limit: 100,
        ...REVIEWS_SORTS[sort()],
      },
      body: reviewsQueryBody(filter()),
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
