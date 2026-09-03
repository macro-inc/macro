import { expect, it } from 'vitest';
import { EMPTY_STARTERS, FEATURED_DISCOVER } from './provider-meta';

it('keeps Notion on Discover Featured', () => {
  expect(FEATURED_DISCOVER).toContainEqual(
    expect.objectContaining({ id: 'notion' })
  );
  expect(FEATURED_DISCOVER).toBe(EMPTY_STARTERS);
});
