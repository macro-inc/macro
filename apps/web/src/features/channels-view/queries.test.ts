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
  it('distinguishes pending, failed, and successfully omitted referenced channels', async () => {
    const refresh = vi.fn(async () => {});
    const { result, dispose, setPending, setError } = createRoot((dispose) => {
      const [pending, setPending] = createSignal(true);
      const [error, setError] = createSignal<Error>();
      useSoupAstItemsQuery.mockImplementation(() => ({
        isEnabled: true,
        get isPending() {
          return pending();
        },
        get isLoading() {
          return pending();
        },
        get isFetching() {
          return pending();
        },
        get fetchError() {
          return error();
        },
        hasNextPage: false,
        refresh,
        get data() {
          if (pending()) throw new Error('A pending query resource was read');
          return { entities: [channelEntity('resolved')] };
        },
      }));
      return {
        result: useCachedChannelsByIds(
          () => ['resolved', 'missing'],
          () => true
        ),
        dispose,
        setPending,
        setError,
      };
    });
    try {
      expect([...result.pendingIds()]).toEqual(['missing', 'resolved']);
      expect([...result.unavailableIds()]).toEqual([]);
      setPending(false);
      expect(result.channels().map(({ id }) => id)).toEqual(['resolved']);
      expect([...result.unavailableIds()]).toEqual(['missing']);
      setError(new Error('offline'));
      expect([...result.unavailableIds()]).toEqual([]);
      expect([...result.failedIds()]).toEqual(['missing']);
      expect(result.error()).toBeInstanceOf(Error);
      await result.retry();
      expect(refresh).toHaveBeenCalledOnce();
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

describe('channel sidebar cache hydration', () => {
  it('renders the shared cached channel list while Soup is still loading', () => {
    useSoupAstItemsQuery.mockImplementation(() => ({
      isEnabled: true,
      isPending: true,
      isLoading: true,
      isFetching: true,
      get data(): { entities: ChannelEntity[] } {
        throw new Error('A pending query resource was read');
      },
    }));
    const { sources, dispose } = createRoot((dispose) => ({
      dispose,
      sources: useChannelsSources(
        (scope) => scope === 'team_channels',
        () => 'updated_at',
        () => [channelEntity('cached')]
      ),
    }));
    try {
      expect(
        sources.team_channels.items().map((channel) => channel.id)
      ).toEqual(['cached']);
      expect(sources.team_channels.isLoading()).toBe(false);
    } finally {
      dispose();
      useSoupAstItemsQuery.mockReset();
    }
  });
  it('hydrates a reload before Soup settles and lets an empty server page replace the seed', () => {
    const { sources, dispose, restore, settle } = createRoot((dispose) => {
      const [cached, restore] = createSignal<ChannelEntity[]>([]);
      const [pending, setPending] = createSignal(true);
      useSoupAstItemsQuery.mockImplementation(() => ({
        isEnabled: true,
        get isPending() {
          return pending();
        },
        get isLoading() {
          return pending();
        },
        get isFetching() {
          return pending();
        },
        get data() {
          if (pending()) throw new Error('A pending query resource was read');
          return { entities: [] };
        },
      }));
      const sources = useChannelsSources(
        (scope) => scope === 'team_channels',
        () => 'updated_at',
        cached
      );
      return { sources, dispose, restore, settle: () => setPending(false) };
    });
    try {
      expect(sources.team_channels.items()).toEqual([]);
      expect(sources.team_channels.isLoading()).toBe(true);
      restore([channelEntity('cached')]);
      expect(sources.team_channels.items().map(({ id }) => id)).toEqual([
        'cached',
      ]);
      expect(sources.team_channels.isLoading()).toBe(false);
      settle();
      expect(sources.team_channels.items()).toEqual([]);
      expect(sources.team_channels.isLoading()).toBe(false);
      restore([channelEntity('stale')]);
      expect(sources.team_channels.items()).toEqual([]);
    } finally {
      dispose();
      useSoupAstItemsQuery.mockReset();
    }
  });

  it('bounds the cached seed and excludes channels outside the viewer membership and section', () => {
    useSoupAstItemsQuery.mockImplementation(() => ({
      isEnabled: true,
      isPending: true,
      isLoading: true,
      data: { entities: [] },
    }));
    const { sources, dispose } = createRoot((dispose) => ({
      dispose,
      sources: useChannelsSources(
        (scope) => scope === 'team_channels',
        () => 'updated_at',
        () => [
          { ...channelEntity('left'), isParticipant: false },
          { ...channelEntity('private'), channelType: 'private' },
          ...Array.from({ length: 105 }, (_, index) => ({
            ...channelEntity(`channel-${index}`),
            updatedAt: new Date(index * 1000).toISOString(),
          })),
        ]
      ),
    }));
    try {
      expect(sources.team_channels.items()).toHaveLength(100);
      expect(sources.team_channels.items()[0].id).toBe('channel-104');
      expect(sources.team_channels.items().at(-1)?.id).toBe('channel-5');
    } finally {
      dispose();
      useSoupAstItemsQuery.mockReset();
    }
  });
});
describe('channel list failures', () => {
  const failedQuery = (entities: ChannelEntity[]) =>
    ({
      isEnabled: true,
      isPending: false,
      isLoading: false,
      isFetching: false,
      // Offline, the live query hides a network error behind its local cache
      // projection, which is empty when the list was never loaded.
      error: null,
      fetchError: new Error('network'),
      data: { entities },
    }) as never;

  it('reports a failed fetch when no conversations are listed', () => {
    useSoupAstItemsQuery.mockImplementation(() => failedQuery([]));
    const dispose = createRoot((dispose) => {
      const sources = useChannelsSources(
        (scope) => scope === 'direct_messages',
        () => 'updated_at'
      );
      expect(sources.direct_messages.items()).toEqual([]);
      expect(sources.direct_messages.error()).toBeInstanceOf(Error);
      return dispose;
    });
    dispose();
    useSoupAstItemsQuery.mockReset();
  });

  it('keeps a shared-list seed and offers Retry when the first Soup page fails', () => {
    useSoupAstItemsQuery.mockImplementation(() => failedQuery([]));
    const dispose = createRoot((dispose) => {
      const sources = useChannelsSources(
        (scope) => scope === 'team_channels',
        () => 'updated_at',
        () => [channelEntity('cached')]
      );
      expect(sources.team_channels.items().map(({ id }) => id)).toEqual([
        'cached',
      ]);
      expect(sources.team_channels.error()).toBeInstanceOf(Error);
      return dispose;
    });
    dispose();
    useSoupAstItemsQuery.mockReset();
  });

  it('does not revive a seed after a confirmed empty page subsequently fails to refresh', () => {
    const { sources, dispose, fail } = createRoot((dispose) => {
      const [error, fail] = createSignal<Error>();
      useSoupAstItemsQuery.mockImplementation(() => ({
        isEnabled: true,
        isPending: false,
        isLoading: false,
        get fetchError() {
          return error();
        },
        data: { entities: [] },
      }));
      return {
        sources: useChannelsSources(
          (scope) => scope === 'team_channels',
          () => 'updated_at',
          () => [channelEntity('cached')]
        ),
        dispose,
        fail,
      };
    });
    try {
      expect(sources.team_channels.items()).toEqual([]);
      fail(new Error('offline'));
      expect(sources.team_channels.items()).toEqual([]);
    } finally {
      dispose();
      useSoupAstItemsQuery.mockReset();
    }
  });

  it('keeps cached conversations listed through a failed fetch', () => {
    useSoupAstItemsQuery.mockImplementation(() =>
      failedQuery([channelEntity('eng')])
    );
    const dispose = createRoot((dispose) => {
      const sources = useChannelsSources(
        (scope) => scope === 'team_channels',
        () => 'updated_at'
      );
      expect(sources.team_channels.items().map((c) => c.id)).toEqual(['eng']);
      expect(sources.team_channels.error()).toBeUndefined();
      return dispose;
    });
    dispose();
    useSoupAstItemsQuery.mockReset();
  });
});
