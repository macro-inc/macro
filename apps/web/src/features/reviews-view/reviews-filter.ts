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

export function filterReviews(
  reviews: readonly GithubPullRequestEntity[],
  filter: ReviewsFilter
): GithubPullRequestEntity[] {
  const search = filter.search.trim().toLocaleLowerCase();
  return reviews.filter((review) => {
    const repository = `${review.metadata.owner}/${review.metadata.repo}`;
    const author = review.metadata.authorLogin;
    if (filter.scope === 'authored') {
      const loginMatches =
        filter.authorLogin !== undefined &&
        author?.toLowerCase() === filter.authorLogin.toLowerCase();
      const idMatches =
        filter.authorId !== undefined &&
        review.metadata.authorId !== undefined &&
        String(review.metadata.authorId) === filter.authorId;
      if (!loginMatches && !idMatches) return false;
    }
    if (filter.repositories.length && !filter.repositories.includes(repository))
      return false;
    if (filter.authors.length && (!author || !filter.authors.includes(author)))
      return false;
    if (!search) return true;
    return [
      review.metadata.name,
      repository,
      String(review.metadata.number),
      author ?? '',
    ].some((value) => value.toLocaleLowerCase().includes(search));
  });
}
