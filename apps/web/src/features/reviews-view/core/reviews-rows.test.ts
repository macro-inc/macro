import type { GithubPullRequestEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import { buildReviewsRows } from './reviews-rows';

const now = new Date('2026-10-09T12:00:00');
const review = (id: string, updatedAt: string, createdAt = updatedAt) =>
  ({ id, updatedAt, createdAt }) as unknown as GithubPullRequestEntity;

const labels = (rows: ReturnType<typeof buildReviewsRows>) =>
  rows.map((row) => (row.kind === 'header' ? `# ${row.label}` : row.id));

describe('buildReviewsRows', () => {
  const reviews = [
    review('a', '2026-10-09T09:00:00', '2026-09-01T09:00:00'),
    review('b', '2026-10-09T08:00:00', '2026-10-08T09:00:00'),
    review('c', '2026-10-08T08:00:00'),
    review('d', '2026-10-05T08:00:00'),
  ];

  it('heads each date bucket of the sort timestamp like email', () => {
    expect(
      labels(
        buildReviewsRows(reviews, {
          sort: 'recently_updated',
          grouped: true,
          now,
        })
      )
    ).toEqual(['# Today', 'a', 'b', '# Yesterday', 'c', '# Last 7 days', 'd']);
  });

  it('groups creation sorts by when pull requests were opened', () => {
    expect(
      labels(
        buildReviewsRows(reviews.slice(0, 2), {
          sort: 'newest',
          grouped: true,
          now,
        })
      )
    ).toEqual(['# Last month', 'a', '# Yesterday', 'b']);
  });

  it('lists flat while searching or sorted by priority', () => {
    expect(
      labels(
        buildReviewsRows(reviews, {
          sort: 'recently_updated',
          grouped: false,
          now,
        })
      )
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(
      labels(
        buildReviewsRows(reviews, { sort: 'priority', grouped: true, now })
      )
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps each pull request at its index among pull requests', () => {
    const rows = buildReviewsRows(reviews, {
      sort: 'recently_updated',
      grouped: true,
      now,
    });
    expect(
      rows.flatMap((row) => (row.kind === 'review' ? [row.index] : []))
    ).toEqual([0, 1, 2, 3]);
  });
});
