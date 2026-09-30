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
  isChannelThreadEntity: (entity: { type: string }) =>
    entity.type === 'channel_thread',
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));

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
      // Four channel lists, the Threads rail's threads and their channels,
      // then the selected conversation.
      expect(useSoupAstItemsQuery).toHaveBeenCalledTimes(7);
      for (const [, options] of useSoupAstItemsQuery.mock.calls.slice(0, 4)) {
        expect(options?.().graphqlProjection).toBe('channel-list');
        expect(options?.().staleTime).toBe(30_000);
      }
      for (const [, options] of useSoupAstItemsQuery.mock.calls.slice(4, 6)) {
        expect(options?.().staleTime).toBe(30_000);
      }
      const [, selectionOptions] = useSoupAstItemsQuery.mock.calls[6];
      expect(selectionOptions?.().graphqlProjection).toBeUndefined();
      expect(selectionOptions?.().staleTime).toBe(0);
    } finally {
      dispose();
    }
  });
});

describe('Threads rail source', () => {
  it('lists only channels holding the user’s threads', () => {
    const thread = (
      id: string,
      channelId: string,
      senderId: string,
      replyCount: number
    ) => ({
      type: 'channel_thread',
      id,
      channelId,
      senderId,
      thread: { replyCount, preview: [] },
    });
    const channel = (id: string, updatedAt: string) => ({
      type: 'channel',
      id,
      name: id,
      updatedAt,
    });
    const threadFilters: string[] = [];
    useSoupAstItemsQuery.mockImplementation((args) => {
      const { body } = args();
      const isThreadQuery = JSON.stringify(body.cthf).includes('Participant');
      if (isThreadQuery) threadFilters.push(JSON.stringify(body.cthf));
      return {
        isEnabled: true,
        isLoading: false,
        data: {
          entities: isThreadQuery
            ? [
                thread('t1', 'dm', 'someone', 2),
                thread('t2', 'eng', 'user-1', 1),
                thread('t3', 'eng', 'someone', 4),
              ]
            : [
                channel('eng', '2026-09-02'),
                channel('dm', '2026-09-01'),
                channel('general', '2026-09-03'),
              ],
        },
      } as never;
    });
    const dispose = createRoot((dispose) => {
      const sources = useChannelsSources(
        (scope) => scope === 'threads',
        () => 'updated_at'
      );
      // Distinct channels in the channel sort; `general` holds no threads.
      expect(sources.threads.items().map((c) => c.id)).toEqual(['eng', 'dm']);
      // The server drops the user's unanswered roots, so pages stay full.
      expect(threadFilters[0]).toContain('HasReplies');
      return dispose;
    });
    dispose();
    useSoupAstItemsQuery.mockReset();
  });
});

describe('Threads rail paging', () => {
  it('keeps paging on its own while the list may be too short to scroll', () => {
    const fetchNextPage = vi.fn(async () => {});
    useSoupAstItemsQuery.mockImplementation(
      () =>
        ({
          isEnabled: true,
          isLoading: false,
          isFetching: false,
          error: null,
          hasNextPage: true,
          fetchNextPage,
          data: { entities: [] },
        }) as never
    );
    const dispose = createRoot((dispose) => {
      useChannelsSources(
        (scope) => scope === 'threads',
        () => 'updated_at'
      );
      return dispose;
    });
    expect(fetchNextPage).toHaveBeenCalled();
    dispose();
    useSoupAstItemsQuery.mockReset();
  });
});
