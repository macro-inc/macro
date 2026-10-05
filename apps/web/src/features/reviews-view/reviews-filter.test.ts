import { describe, expect, it } from 'vitest';
import { effectiveReviewsFilters } from './reviews-filter';
import {
  EMPTY_REVIEWS_FILTERS,
  type ReviewsFilterSelection,
} from './reviews-types';

describe('effective review filters', () => {
  const saved: ReviewsFilterSelection = {
    ...EMPTY_REVIEWS_FILTERS,
    repository: ['42'],
    review: ['awaiting_my_review'],
  };

  it('excludes viewer-specific selections without changing saved filters', () => {
    const active = effectiveReviewsFilters(saved, false);
    expect(active.review).toEqual([]);
    expect(active.repository).toEqual(['42']);
    expect(saved.review).toEqual(['awaiting_my_review']);
  });

  it('restores saved selections when the GitHub identity returns', () => {
    effectiveReviewsFilters(saved, false);
    expect(effectiveReviewsFilters(saved, true)).toBe(saved);
  });

  it('has no active selections when only unavailable review filters are saved', () => {
    const active = effectiveReviewsFilters(
      { ...EMPTY_REVIEWS_FILTERS, review: ['reviewed_by_me'] },
      false
    );
    expect(Object.values(active).flat()).toEqual([]);
  });
});
