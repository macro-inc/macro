import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const useSoupAstItemsQuery = vi.hoisted(() =>
  vi.fn(
    (
      ..._args: Parameters<
        typeof import('@queries/soup/items').useSoupAstItemsQuery
      >
    ) => ({
      isEnabled: true,
      isLoading: false,
      data: { entities: [] },
    })
  )
);

vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery }));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
}));

import { useChannelByIdQuery, useChannelsSources } from './queries';

describe('channel list query selection', () => {
  it('bounds every list but keeps the selected conversation notification edge complete', () => {
    useSoupAstItemsQuery.mockClear();
    const dispose = createRoot((dispose) => {
      useChannelsSources(
        () => true,
        () => 'updated_at'
      );
      useChannelByIdQuery(
        () => 'channel-id',
        () => true
      );
      return dispose;
    });
    try {
      expect(useSoupAstItemsQuery).toHaveBeenCalledTimes(5);
      for (const [, options] of useSoupAstItemsQuery.mock.calls.slice(0, 4)) {
        expect(options?.().graphqlProjection).toBe('channel-list');
      }
      const [, selectionOptions] = useSoupAstItemsQuery.mock.calls[4];
      expect(selectionOptions?.().graphqlProjection).toBeUndefined();
    } finally {
      dispose();
    }
  });
});
