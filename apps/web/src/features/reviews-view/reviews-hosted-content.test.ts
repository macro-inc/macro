import { describe, expect, it } from 'vitest';
import { reviewsHostedContent } from './reviews-hosted-content';
import { reviewsTabSearchCodec } from './reviews-tab-search';

describe('Reviews PR navigation', () => {
  it('preserves the selected tab in a new split', () => {
    const tab = reviewsTabSearchCodec.serialize({ tab: 'authored' });
    const content = reviewsHostedContent(
      { type: 'pr', id: 'pr-1' },
      tab ? { reviews: tab } : undefined
    );

    expect(content).toEqual({
      type: 'component',
      id: 'reviews',
      entryMetadata: {
        search: { reviews: { tab: ['authored'] } },
        route: {
          matches: [
            { id: 'view-reviews', params: {} },
            { id: 'reviews-pr', params: { foreignEntityId: 'pr-1' } },
          ],
        },
      },
    });
  });
});
