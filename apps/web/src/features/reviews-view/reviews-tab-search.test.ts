import { describe, expect, it } from 'vitest';
import { reviewsTabSearchCodec } from './reviews-tab-search';

describe('Reviews tab URL', () => {
  it.each(['involving', 'all', 'authored'] as const)(
    'round-trips the %s tab',
    (tab) => {
      const encoded = reviewsTabSearchCodec.serialize({ tab });
      expect(reviewsTabSearchCodec.parse(encoded)).toEqual({
        value: { tab },
        valid: true,
      });
    }
  );

  it('defaults to involving for invalid or missing tabs', () => {
    expect(reviewsTabSearchCodec.parse({})).toEqual({
      value: { tab: 'involving' },
      valid: true,
    });
    expect(reviewsTabSearchCodec.parse({ tab: ['invalid'] })).toEqual({
      value: { tab: 'involving' },
      valid: false,
    });
  });
});
