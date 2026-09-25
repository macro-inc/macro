import type { GithubPullRequestEntity } from '@entity';
import type { ReviewsScope } from './reviews-types';

export type ReviewsFilter = {
  scope: ReviewsScope;
  authorLogin?: string;
  authorId?: string;
  search: string;
  repositories: readonly string[];
  authors: readonly string[];
};

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

export function filterReviews(
  reviews: readonly GithubPullRequestEntity[],
  filter: ReviewsFilter
): GithubPullRequestEntity[] {
  const search = filter.search.trim().toLocaleLowerCase();

  return reviews.filter((review) => {
    if (
      filter.scope === 'authored' &&
      !isAuthoredBy(review, filter.authorLogin, filter.authorId)
    ) {
      return false;
    }

    const repository = `${review.metadata.owner}/${review.metadata.repo}`;
    if (
      filter.repositories.length > 0 &&
      !filter.repositories.includes(repository)
    ) {
      return false;
    }

    const author = review.metadata.authorLogin;
    if (filter.authors.length > 0) {
      if (!author || !filter.authors.includes(author)) return false;
    }

    if (!search) return true;

    const searchableFields = [
      review.metadata.name,
      repository,
      String(review.metadata.number),
      author ?? '',
    ];
    return searchableFields.some((value) =>
      value.toLocaleLowerCase().includes(search)
    );
  });
}
