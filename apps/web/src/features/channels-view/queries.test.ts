import { QueryClient } from '@tanstack/query-core';
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
  it('refreshes a newly cached full edge instead of reusing it for 30 seconds', async () => {
    useSoupAstItemsQuery.mockClear();
    const dispose = createRoot((dispose) => {
      useChannelByIdQuery(
        () => 'channel-id',
        () => true
      );
      return dispose;
    });
    const client = new QueryClient();
    try {
      const [, options] = useSoupAstItemsQuery.mock.calls[0];
      const queryKey = ['selected-channel', 'channel-id'];
      client.setQueryData(queryKey, ['old-notification']);
      const queryFn = vi.fn(async () => [
        'old-notification',
        'new-notification',
      ]);
      const notifications = await client.fetchQuery({
        queryKey,
        queryFn,
        staleTime: options?.().staleTime,
      });
      expect(queryFn).toHaveBeenCalledOnce();
      expect(notifications).toEqual(['old-notification', 'new-notification']);
    } finally {
      client.clear();
      dispose();
    }
  });
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
        expect(options?.().staleTime).toBe(30_000);
      }
      const [, selectionOptions] = useSoupAstItemsQuery.mock.calls[4];
      expect(selectionOptions?.().graphqlProjection).toBeUndefined();
      expect(selectionOptions?.().staleTime).toBe(0);
    } finally {
      dispose();
    }
  });
});
