import type { GithubPullRequestEntity } from '@entity';
import type { ReviewsFilterSelection } from './reviews-types';

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
