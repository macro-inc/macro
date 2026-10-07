import { describe, expect, it } from 'vitest';
import { DEFAULT_REVIEWS_FILTERS } from '../reviews-types';
import {
  reviewsStatusTab,
  reviewsStatusTabSelection,
  showReviewsStatusTabs,
} from './reviews-status';

describe('Reviews status presets', () => {
  it('defaults to Open', () => {
    expect(DEFAULT_REVIEWS_FILTERS.status).toEqual(['open']);
    expect(reviewsStatusTab(DEFAULT_REVIEWS_FILTERS.status)).toBe('open');
  });

  it('maps Closed to both unmerged closed and merged PRs', () => {
    expect(reviewsStatusTabSelection('closed')).toEqual(['closed', 'merged']);
    expect(reviewsStatusTabSelection('open')).toEqual(['open']);
  });

  it.each([
    ['closed', 'merged'],
    ['merged', 'closed'],
  ])(
    'keeps the Closed preset visible regardless of menu selection order (%s, %s)',
    (...statuses) => {
      expect(reviewsStatusTab(statuses)).toBe('closed');
      expect(showReviewsStatusTabs(statuses)).toBe(true);
    }
  );

  it.each([
    ['open', 'closed'],
    ['open', 'merged'],
    ['open', 'closed', 'merged'],
  ])(
    'hides tabs for custom multi-status selections (%s, %s)',
    (...statuses) => {
      expect(reviewsStatusTab(statuses)).toBeUndefined();
      expect(showReviewsStatusTabs(statuses)).toBe(false);
    }
  );

  it.each([[], ['closed'], ['merged']])(
    'does not highlight a broader preset for a partial or empty menu selection (%s)',
    (...statuses) => {
      expect(reviewsStatusTab(statuses)).toBeUndefined();
      expect(showReviewsStatusTabs(statuses)).toBe(true);
    }
  );
});
