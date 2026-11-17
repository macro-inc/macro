import type { ChannelEntity } from '@entity/types/entity';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { createMemo, createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const useSoupAstItemsQuery = vi.hoisted(() =>
  vi.fn(
    (
      ..._args: Parameters<
        typeof import('@queries/soup/items').useSoupAstItemsQuery
      >
    ) => {
      const entities: ChannelEntity[] = [];
      return {
        isEnabled: true,
        isLoading: false,
        data: { entities },
      };
    }
  )
);

const fetchAllChannels = vi.hoisted(() =>
  vi.fn<(signal?: AbortSignal) => Promise<ApiChannelWithLatest[]>>()
);
vi.mock('@queries/channel/channels', () => ({ fetchAllChannels }));

const createChannelDetailQuery = vi.hoisted(() =>
  vi.fn((_channelId: () => string | undefined, enabled: () => boolean) => ({
    get isEnabled() {
      return enabled();
    },
    isPending: false,
    isLoading: false,
    isFetching: false,
    error: null,
    data: { entities: [] },
    refresh: async () => {},
  }))
);

vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery }));
vi.mock('@queries/channel/detail', () => ({ createChannelDetailQuery }));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
  isChannelThreadEntity: (entity: { type: string }) =>
    entity.type === 'channel_thread',
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));

import { useChannelByIdQuery } from '@channel/Channel/channel-entity';
import {
  useCachedChannelsByIds,
  useChannelsByIdsQuery,
} from '@queries/channel/by-ids';
import {
  fetchChannelGroupIds,
  resolveReferencedChannels,
  useChannelsSources,
} from './queries';

const channelEntity = (id: string) =>
  ({
    id,
    type: 'channel',
    name: id,
    ownerId: 'viewer',
    channelType: 'team',
  }) as ChannelEntity;

describe('built-in section notification membership', () => {
  it('keeps joined channels in their section and excludes custom-section assignments', async () => {
    fetchAllChannels.mockResolvedValue([
      {
        id: 'private',
        channel_type: 'private',
        is_participant: true,
        created_at: '',
        updated_at: '',
        owner_id: '',
        auto_join_team: false,
        participants: [],
        latest_message: null,
      },
      {
        id: 'assigned',
        channel_type: 'private',
        is_participant: true,
        created_at: '',
        updated_at: '',
        owner_id: '',
        auto_join_team: false,
        participants: [],
        latest_message: null,
      },
      {
        id: 'team',
        channel_type: 'team',
        is_participant: true,
        created_at: '',
        updated_at: '',
        owner_id: '',
        auto_join_team: false,
        participants: [],
        latest_message: null,
      },
      {
        id: 'unjoined',
        channel_type: 'team',
        is_participant: false,
        created_at: '',
        updated_at: '',
        owner_id: '',
        auto_join_team: false,
        participants: [],
        latest_message: null,
      },
      {
        id: 'dm',
        channel_type: 'direct_message',
        is_participant: true,
        created_at: '',
        updated_at: '',
        owner_id: '',
        auto_join_team: false,
        participants: [],
        latest_message: null,
      },
    ]);
    const signal = new AbortController().signal;

    expect(
      await fetchChannelGroupIds('channels', ['assigned'], signal)
    ).toEqual(['private']);
    expect(
      await fetchChannelGroupIds('team_channels', ['assigned'], signal)
    ).toEqual(['team']);
    expect(await fetchChannelGroupIds('direct_messages', [], signal)).toEqual([
      'dm',
    ]);
    expect(fetchAllChannels).toHaveBeenLastCalledWith(signal);
  });
});
describe('channel list query selection', () => {
  it('bounds every list', () => {
    useSoupAstItemsQuery.mockClear();
    const dispose = createRoot((dispose) => {
      useChannelsSources(
        () => true,
        () => 'updated_at'
      );
      return dispose;
    });
    try {
      // Five channel lists, then the Threads rail's threads and their channels.
      expect(useSoupAstItemsQuery).toHaveBeenCalledTimes(7);
      for (const [, options] of useSoupAstItemsQuery.mock.calls.slice(0, 5)) {
        expect(options?.().graphqlProjection).toBe('channel-list');
        expect(options?.().staleTime).toBe(30_000);
      }
      for (const [, options] of useSoupAstItemsQuery.mock.calls.slice(5, 7)) {
        expect(options?.().staleTime).toBe(30_000);
      }
      // The Threads rail's channels, fetched by id, are rail rows too.
      const [, channelsByIdOptions] = useSoupAstItemsQuery.mock.calls[6];
      expect(channelsByIdOptions?.().graphqlProjection).toBe('channel-list');
    } finally {
      dispose();
    }
  });

  it('opens a conversation through the unread-only detail query', () => {
    useSoupAstItemsQuery.mockClear();
    createChannelDetailQuery.mockClear();
    const { dispose, query } = createRoot((dispose) => ({
      dispose,
      query: useChannelByIdQuery(
        () => 'channel-id',
        () => true
      ),
    }));
    try {
      const [channelId, enabled] = createChannelDetailQuery.mock.calls[0];
      expect(channelId()).toBe('channel-id');
      expect(enabled()).toBe(true);
      expect(useSoupAstItemsQuery).not.toHaveBeenCalled();
      expect(query.isEnabled).toBe(true);
    } finally {
      dispose();
    }
  });
});

describe('channels resolved by id', () => {
  it('compiles each by-ID batch once until its membership changes', () => {
    useSoupAstItemsQuery.mockClear();
    const { dispose, setIds, reads } = createRoot((dispose) => {
      const [ids, setIds] = createSignal(
        Array.from({ length: 500 }, (_, index) => `channel-${index}`)
      );
      const reads = vi.fn(ids);
      useChannelsByIdsQuery(reads);
      return { dispose, setIds, reads };
    });
    try {
      const [args] = useSoupAstItemsQuery.mock.calls[0];
      const initial = args();
      for (let read = 0; read < 20; read += 1) args();
      expect(reads).toHaveBeenCalledTimes(1);
      setIds(['replacement']);
      expect(args()).not.toBe(initial);
      expect(args().params.limit).toBe(1);
      expect(reads).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
    }
  });

  const resolved = [channelEntity('design'), channelEntity('support')];
  const settled = {
    isEnabled: true,
    isPending: false,
    error: undefined,
    data: undefined,
  };

  it('replaces the previous answer, dropping channels the lookup stops returning', () => {
    expect(
      resolveReferencedChannels(resolved, {
        ...settled,
        data: {
          entities: [
            channelEntity('design'),
            { id: 'note', type: 'document' } as never,
          ],
        },
      })
    ).toEqual([channelEntity('design')]);
  });

  it.each(['disabled', 'pending', 'failed'] as const)(
    'keeps the previous answer without reading %s query data',
    (state) => {
      expect(
        resolveReferencedChannels(resolved, {
          isEnabled: state !== 'disabled',
          isPending: state === 'pending',
          error: state === 'failed' ? new Error('page failed') : undefined,
          get data(): { entities: ChannelEntity[] } {
            throw new Error('An unavailable query resource was read');
          },
        })
      ).toBe(resolved);
    }
  );

  it('retains resolved rows while a changed lookup is pending and updates when it settles', () => {
    const { dispose, result, setPending, setEntities } = createRoot(
      (dispose) => {
        const [pending, setPending] = createSignal(false);
        const [entities, setEntities] = createSignal(resolved);
        const query = {
          ...settled,
          get isPending() {
            return pending();
          },
          get data() {
            if (pending()) throw new Error('A pending query resource was read');
            return { entities: entities() };
          },
        };
        const result = createMemo<ChannelEntity[]>(
          (previous) => resolveReferencedChannels(previous, query),
          []
        );
        return { dispose, result, setPending, setEntities };
      }
    );
    try {
      const previous = result();
      setPending(true);
      setEntities([channelEntity('support')]);
      expect(result()).toBe(previous);
      setPending(false);
      expect(result()).toEqual([channelEntity('support')]);
    } finally {
      dispose();
    }
  });

  it('retains section members during notification refresh without reading pending data', () => {
    const { dispose, result, setPending, setEntities, setIds } = createRoot(
      (dispose) => {
        const [pending, setPending] = createSignal(false);
        const [entities, setEntities] = createSignal(resolved);
        const [ids, setIds] = createSignal(['design', 'support']);
        useSoupAstItemsQuery.mockImplementation(() => ({
          isEnabled: true,
          isLoading: false,
          get isPending() {
            return pending();
          },
          get data() {
            if (pending()) throw new Error('A pending query resource was read');
            return { entities: entities() };
          },
        }));
        const result = useCachedChannelsByIds(ids, () => true);
        return { dispose, result, setPending, setEntities, setIds };
      }
    );
    try {
      expect(result.channels()).toEqual(resolved);
      setPending(true);
      expect(result.channels()).toEqual(resolved);
      expect([...result.pendingIds()]).toEqual([]);
      setEntities([channelEntity('support')]);
      setPending(false);
      expect(result.channels()).toEqual([channelEntity('support')]);
      setPending(true);
      setIds(['another-channel']);
      expect(result.channels()).toEqual([]);
    } finally {
      dispose();
      useSoupAstItemsQuery.mockReset();
    }
  });
  it('keeps the previous answer when a settled lookup has no data', () => {
    expect(resolveReferencedChannels(resolved, settled)).toBe(resolved);
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
