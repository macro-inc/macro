import {
  comparePriority,
  hasPrLink,
  type PrLinkKind,
  type PrLinks,
  type PrPriorityId,
} from '@block-pr/data/pr-links';
import type { GithubPullRequestEntity } from '@entity';
import type { ReviewsFilterSelection, ReviewsSortId } from './reviews-types';

/** Keep saved viewer-specific filters inactive until a GitHub identity is available. */
export function effectiveReviewsFilters(
  filters: ReviewsFilterSelection,
  hasGithubIdentity: boolean
): ReviewsFilterSelection {
  return hasGithubIdentity ? filters : { ...filters, review: [] };
}

export function isAuthoredBy(
  review: GithubPullRequestEntity,
  authorLogin?: string,
  authorId?: string
): boolean {
  const reviewAuthorId = review.metadata.authorId;
  if (authorId && reviewAuthorId !== undefined) {
    if (String(reviewAuthorId) === authorId) return true;
  }

  const reviewAuthor = review.metadata.authorLogin;
  if (!authorLogin || !reviewAuthor) return false;

  return reviewAuthor.toLowerCase() === authorLogin.toLowerCase();
}

/** Scope, repository, and author filters run on the backend; search runs here. */
export function searchReviews(
  reviews: readonly GithubPullRequestEntity[],
  search: string
): GithubPullRequestEntity[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return [...reviews];

  return reviews.filter((review) =>
    [
      review.metadata.name,
      `${review.metadata.owner}/${review.metadata.repo}`,
      String(review.metadata.number),
      review.metadata.authorLogin ?? '',
    ].some((value) => value.toLocaleLowerCase().includes(query))
  );
}

/** Whether the priority or linked-to filters are narrowing the list. */
export const hasLinkFilters = (filters: ReviewsFilterSelection) =>
  filters.priority.length > 0 ||
  filters.linked.length > 0 ||
  filters.origin.length > 0;

/** The origin filter option for pull requests nothing identifies. */
export const UNKNOWN_ORIGIN = 'unknown';

const SORT_ORDER: Record<
  ReviewsSortId,
  { timestamp: 'updatedAt' | 'createdAt'; descending: boolean }
> = {
  priority: { timestamp: 'updatedAt', descending: true },
  recently_updated: { timestamp: 'updatedAt', descending: true },
  least_recently_updated: { timestamp: 'updatedAt', descending: false },
  newest: { timestamp: 'createdAt', descending: true },
  oldest: { timestamp: 'createdAt', descending: false },
};

const timestampMs = (value: unknown) => {
  const ms =
    typeof value === 'string' || typeof value === 'number'
      ? new Date(value).getTime()
      : Number.NaN;
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/**
 * Priority and linked-to filters, and the priority sort, which read each pull
 * request's links. Rows whose links have not loaded yet are held back while
 * a link filter is active, since they cannot be matched.
 *
 * Rows are re-sorted by their current timestamp: the local cache keeps a pull
 * request at its fetched position after a live update changes its
 * `updatedAt`, which would split the list's date headings.
 */
export function applyReviewLinks(
  reviews: readonly GithubPullRequestEntity[],
  linksFor: (review: GithubPullRequestEntity) => PrLinks | undefined,
  filters: ReviewsFilterSelection,
  sort: ReviewsSortId
): GithubPullRequestEntity[] {
  let result = [...reviews];
  if (hasLinkFilters(filters)) {
    result = result.filter((review) => {
      const links = linksFor(review);
      if (!links) return false;
      if (
        filters.priority.length > 0 &&
        !filters.priority.includes(links.priority.id)
      )
        return false;
      if (
        filters.origin.length > 0 &&
        !filters.origin.includes(links.origin?.tool ?? UNKNOWN_ORIGIN)
      )
        return false;
      // Like the other groups, any selected option matches.
      return (
        filters.linked.length === 0 ||
        filters.linked.some((kind) => hasPrLink(links, kind as PrLinkKind))
      );
    });
  }
  const order = SORT_ORDER[sort];
  const time = (review: GithubPullRequestEntity) =>
    timestampMs(review[order.timestamp]);
  result.sort((a, b) => {
    const [first, second] = order.descending
      ? [time(b), time(a)]
      : [time(a), time(b)];
    return first === second ? 0 : first < second ? -1 : 1;
  });
  if (sort === 'priority') {
    const priority = (review: GithubPullRequestEntity): PrPriorityId =>
      linksFor(review)?.priority.id ?? 'none';
    // Array sort is stable, so equal priorities keep their recency order.
    result.sort((a, b) => comparePriority(priority(a), priority(b)));
  }
  return result;
}
