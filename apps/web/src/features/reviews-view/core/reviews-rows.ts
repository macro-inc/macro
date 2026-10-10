import { dateBucket } from '@app/features/soup/collection/date-buckets';
import type { GithubPullRequestEntity } from '@entity';
import { match } from 'ts-pattern';
import type { ReviewsSortId } from '../reviews-types';

/** A Reviews list row: a date heading, or a pull request with its list index. */
export type ReviewsRow =
  | { kind: 'header'; id: string; label: string }
  | {
      kind: 'review';
      id: string;
      review: GithubPullRequestEntity;
      /** Position among the pull requests, which focus and selection use. */
      index: number;
    };

/** The timestamp a sort orders by, or `undefined` when it is not by date. */
const sortTimestamp = (sort: ReviewsSortId) =>
  match(sort)
    .with(
      'recently_updated',
      'least_recently_updated',
      () => (review: GithubPullRequestEntity) => review.updatedAt
    )
    .with(
      'newest',
      'oldest',
      () => (review: GithubPullRequestEntity) => review.createdAt
    )
    .with('priority', () => undefined)
    .exhaustive();

/**
 * Pull requests under the same date headings as email (Today, Yesterday,
 * Last 7 days, …) by the date the list is sorted on. A sort that is not by
 * date, or a search, lists them flat.
 */
export function buildReviewsRows(
  reviews: readonly GithubPullRequestEntity[],
  options: { sort: ReviewsSortId; grouped: boolean; now?: Date }
): ReviewsRow[] {
  const timestamp = options.grouped ? sortTimestamp(options.sort) : undefined;
  const rows: ReviewsRow[] = [];
  let bucket: string | undefined;
  reviews.forEach((review, index) => {
    if (timestamp) {
      const next = dateBucket(timestamp(review), options.now);
      if (next.key !== bucket) {
        bucket = next.key;
        rows.push({
          kind: 'header',
          id: `header:${next.key}:${index}`,
          label: next.label,
        });
      }
    }
    rows.push({ kind: 'review', id: review.id, review, index });
  });
  return rows;
}
