import { describe, expect, it } from 'vitest';
import { createVisitReview } from './visit';

describe('review on entry', () => {
  it('makes one decision per visit across duplicate Share controls and live updates', () => {
    const visit = createVisitReview();
    visit.navigate('document:a');
    expect(visit.claim('document:a')).toBe(true);
    expect(visit.claim('document:a')).toBe(false);
    visit.navigate('document:a');
    expect(visit.claim('document:a')).toBe(false);
    visit.navigate('home');
    visit.navigate('document:a');
    expect(visit.claim('document:a')).toBe(true);
  });
});
