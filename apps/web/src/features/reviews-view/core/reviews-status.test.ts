import { describe, expect, it } from 'vitest';
import {
  reviewsStatusTab,
  reviewsStatusTabSelection,
  showReviewsStatusTabs,
} from './reviews-status';

describe('reviews status toggle', () => {
  it('highlights the preset a selection matches', () => {
    expect(reviewsStatusTab(['open'])).toBe('open');
    expect(reviewsStatusTab(['merged', 'closed'])).toBe('closed');
    expect(reviewsStatusTab([])).toBe('all');
    expect(reviewsStatusTab(['merged'])).toBeUndefined();
  });

  it('selects every status for All', () => {
    expect(reviewsStatusTabSelection('all')).toEqual([]);
    expect(reviewsStatusTabSelection('closed')).toEqual(['closed', 'merged']);
  });

  it('hides the toggle only for custom multi-status selections', () => {
    expect(showReviewsStatusTabs([])).toBe(true);
    expect(showReviewsStatusTabs(['open', 'merged'])).toBe(false);
  });
});
