import type { GithubPullRequestEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import { filterReviews } from './reviews-filter';

const review = (
  id: string,
  owner: string,
  repo: string,
  authorLogin?: string
): GithubPullRequestEntity =>
  ({
    foreignId: id,
    metadata: {
      name: `Review ${id}`,
      owner,
      repo,
      authorLogin,
      number: Number(id),
    },
  }) as unknown as GithubPullRequestEntity;

const reviews = [
  review('1', 'macro', 'web', 'Alice'),
  review('2', 'macro', 'api', 'bob'),
  review('3', 'another', 'web'),
];
const defaults = {
  scope: 'all' as const,
  search: '',
  repositories: [] as string[],
  authors: [] as string[],
};

describe('Reviews filters', () => {
  it('includes every relevant open PR by default', () => {
    expect(filterReviews(reviews, defaults)).toHaveLength(3);
  });

  it('matches authored PRs using the linked GitHub username', () => {
    expect(
      filterReviews(reviews, {
        ...defaults,
        scope: 'authored',
        authorLogin: 'alice',
      }).map((item) => item.foreignId)
    ).toEqual(['1']);
    expect(filterReviews(reviews, { ...defaults, scope: 'authored' })).toEqual(
      []
    );
  });

  it('combines repository, author, and text filters', () => {
    expect(
      filterReviews(reviews, {
        ...defaults,
        repositories: ['macro/api'],
        authors: ['bob'],
        search: 'REVIEW 2',
      }).map((item) => item.foreignId)
    ).toEqual(['2']);
  });
});
