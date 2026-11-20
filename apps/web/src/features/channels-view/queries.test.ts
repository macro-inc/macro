import type { ChannelEntity } from '@entity/types/entity';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { createRoot, createSignal, onCleanup } from 'solid-js';
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
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user-1',
  useIsAuthenticated: () => () => true,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

import { useChannelByIdQuery } from '@channel/Channel/channel-entity';
import { resetQueryAccountSession } from '@queries/auth/account-scope';
import { authKeys } from '@queries/auth/keys';
import {
  CHANNEL_LOOKUP_BATCH_SIZE,
  useCachedChannelsByIds,
} from '@queries/channel/by-ids';
import { queryClient } from '@queries/client';
import {
  fetchChannelGroupIds,
  THREAD_CHANNELS_LIMIT,
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
      // Five channel lists, then the Threads rail's threads. Their channels
      // are looked up only once a thread names one.
      expect(useSoupAstItemsQuery).toHaveBeenCalledTimes(6);
      for (const [, options] of useSoupAstItemsQuery.mock.calls.slice(0, 5)) {
        expect(options?.().graphqlProjection).toBe('channel-list');
        expect(options?.().staleTime).toBe(30_000);
      }
      const [threadArgs, threadOptions] = useSoupAstItemsQuery.mock.calls[5];
      expect(threadArgs().params.limit).toBe(THREAD_CHANNELS_LIMIT);
      expect(threadOptions?.().staleTime).toBe(30_000);
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
  it('asks for each batch of IDs in one request that cannot leave a next page', () => {
    useSoupAstItemsQuery.mockClear();
    const ids = Array.from(
      { length: CHANNEL_LOOKUP_BATCH_SIZE + 1 },
      (_, index) => `channel-${String(index).padStart(4, '0')}`
    );
    const dispose = createRoot((dispose) => {
      useCachedChannelsByIds(
        () => ids,
        () => true
      );
      return dispose;
    });
    try {
      const batches = useSoupAstItemsQuery.mock.calls.map(
        ([args, options]) => ({
          args: args(),
          cacheFirst: options?.().graphqlCacheFirstEntities?.length,
        })
      );
      // Soup returns a cursor whenever a page is full, so a lookup asks for
      // one row more than it has IDs, within Soup's 500-row page.
      expect(batches.map((batch) => batch.args.params.limit)).toEqual([500, 2]);
      expect(batches.map((batch) => batch.cacheFirst)).toEqual([499, 1]);
    } finally {
      dispose();
    }
  });

  const resolved = [channelEntity('design'), channelEntity('support')];

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
        get hasPageData() {
          return !pending();
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
  it('reads one bounded page of threads and leaves further pages to scrolling', async () => {
    const fetchNextPage = vi.fn(async () => {});
    const threadLimits: (number | null | undefined)[] = [];
    useSoupAstItemsQuery.mockImplementation((args) => {
      const { params, body } = args();
      if (JSON.stringify(body.cthf).includes('Participant'))
        threadLimits.push(params.limit);
      return {
        isEnabled: true,
        isPending: false,
        isLoading: false,
        isFetching: false,
        error: null,
        hasNextPage: true,
        fetchNextPage,
        data: { entities: [] },
      } as never;
    });
    const { sources, dispose } = createRoot((dispose) => ({
      dispose,
      sources: useChannelsSources(
        (scope) => scope === 'threads',
        () => 'updated_at'
      ),
    }));
    try {
      expect(threadLimits).toEqual([THREAD_CHANNELS_LIMIT]);
      expect(fetchNextPage).not.toHaveBeenCalled();
      expect(sources.threads.hasMore()).toBe(true);
      await sources.threads.loadMore();
      expect(fetchNextPage).toHaveBeenCalledOnce();
    } finally {
      dispose();
      useSoupAstItemsQuery.mockReset();
    }
  });

  it('shows cached thread channels while the missing ones are still fetched', () => {
    const { sources, dispose, setFetched } = createRoot((dispose) => {
      const [fetched, setFetched] = createSignal(false);
      useSoupAstItemsQuery.mockImplementation((args, options) => {
        const isThreadQuery = JSON.stringify(args().body.cthf).includes(
          'Participant'
        );
        if (isThreadQuery) {
          return {
            isEnabled: true,
            isPending: false,
            isLoading: false,
            isFetching: false,
            data: {
              entities: [
                { type: 'channel_thread', id: 't1', channelId: 'cached' },
                { type: 'channel_thread', id: 't2', channelId: 'missing' },
              ],
            },
          } as never;
        }
        // The lookup names its channels, so Soup selects cached ones locally.
        const lookup = options?.().graphqlCacheFirstEntities;
        if (!lookup) return { isEnabled: false, isPending: true } as never;
        expect(lookup).toEqual([
          { entityType: 'CHANNEL', entityId: 'cached' },
          { entityType: 'CHANNEL', entityId: 'missing' },
        ]);
        return {
          isEnabled: true,
          isPending: false,
          isLoading: false,
          get isFetching() {
            return !fetched();
          },
          get hasPageData() {
            return fetched();
          },
          get data() {
            return {
              entities: fetched()
                ? [channelEntity('cached'), channelEntity('missing')]
                : [channelEntity('cached')],
            };
          },
        } as never;
      });
      return {
        dispose,
        setFetched,
        sources: useChannelsSources(
          (scope) => scope === 'threads',
          () => 'updated_at'
        ),
      };
    });
    try {
      expect(sources.threads.items().map(({ id }) => id)).toEqual(['cached']);
      expect(sources.threads.isLoading()).toBe(false);
      setFetched(true);
      expect(
        sources.threads
          .items()
          .map(({ id }) => id)
          .sort()
      ).toEqual(['cached', 'missing']);
    } finally {
      dispose();
      useSoupAstItemsQuery.mockReset();
    }
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
        get hasPageData() {
          return !pending();
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
  it('retains shared cached rows when an offline partial index has no page', () => {
    useSoupAstItemsQuery.mockImplementation(() => ({
      isEnabled: true,
      isPending: false,
      isLoading: false,
      isFetching: false,
      hasPageData: false,
      data: { entities: [] },
    }));
    const dispose = createRoot((dispose) => {
      const sources = useChannelsSources(
        (scope) => scope === 'team_channels',
        () => 'updated_at',
        () => [channelEntity('cached')]
      );
      expect(sources.team_channels.items().map(({ id }) => id)).toEqual([
        'cached',
      ]);
      expect(sources.team_channels.isLoading()).toBe(false);
      return dispose;
    });
    dispose();
    useSoupAstItemsQuery.mockReset();
  });

  it('merges partial local rows without shrinking the seed before a page answers', () => {
    const { sources, dispose, setLocal, setHasPage } = createRoot((dispose) => {
      const [local, setLocal] = createSignal([channelEntity('local')]);
      const [hasPage, setHasPage] = createSignal(false);
      useSoupAstItemsQuery.mockImplementation(() => ({
        isEnabled: true,
        isPending: false,
        isLoading: false,
        get hasPageData() {
          return hasPage();
        },
        get data() {
          return { entities: local() };
        },
      }));
      return {
        sources: useChannelsSources(
          (scope) => scope === 'team_channels',
          () => 'updated_at',
          () => [channelEntity('local'), channelEntity('cached')]
        ),
        dispose,
        setLocal,
        setHasPage,
      };
    });
    try {
      expect(sources.team_channels.items().map(({ id }) => id)).toEqual([
        'local',
        'cached',
      ]);
      setLocal([]);
      expect(sources.team_channels.items().map(({ id }) => id)).toEqual([
        'local',
        'cached',
      ]);
      setHasPage(true);
      expect(sources.team_channels.items()).toEqual([]);
    } finally {
      dispose();
      useSoupAstItemsQuery.mockReset();
    }
  });

  it('does not mark references unavailable until a page confirms their absence', () => {
    const { references, dispose, setHasPage } = createRoot((dispose) => {
      const [hasPage, setHasPage] = createSignal(false);
      useSoupAstItemsQuery.mockImplementation(() => ({
        isEnabled: true,
        isPending: false,
        isLoading: false,
        isFetching: false,
        get hasPageData() {
          return hasPage();
        },
        data: { entities: [] },
      }));
      return {
        references: useCachedChannelsByIds(
          () => ['missing'],
          () => true
        ),
        dispose,
        setHasPage,
      };
    });
    try {
      expect([...references.unavailableIds()]).toEqual([]);
      setHasPage(true);
      expect([...references.unavailableIds()]).toEqual(['missing']);
    } finally {
      dispose();
      useSoupAstItemsQuery.mockReset();
    }
  });
  it('retires the complete query graph across same-viewer reauthentication', async () => {
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      id: 'user-1',
      authenticated: true,
    });
    let session = 0;
    const disposedQueries: number[] = [];
    const refreshes = vi.fn();
    const {
      sources,
      references,
      dispose,
      setCached,
      setOldRows,
      setFreshPending,
      setEnabled,
      setSort,
    } = createRoot((dispose) => {
      const [cached, setCached] = createSignal<ChannelEntity[]>([]);
      const [oldRows, setOldRows] = createSignal([channelEntity('old')]);
      const [freshPending, setFreshPending] = createSignal(true);
      const [enabled, setEnabled] = createSignal(true);
      const [sort, setSort] = createSignal<'updated_at' | 'created_at'>(
        'updated_at'
      );
      useSoupAstItemsQuery.mockImplementation(() => {
        const querySession = session;
        const id = useSoupAstItemsQuery.mock.calls.length;
        onCleanup(() => disposedQueries.push(id));
        return {
          isEnabled: true,
          get isPending() {
            return querySession > 0 && freshPending();
          },
          get isLoading() {
            return querySession > 0 && freshPending();
          },
          get isFetching() {
            return querySession > 0 && freshPending();
          },
          get hasPageData() {
            return querySession === 0 || !freshPending();
          },
          refresh: async () => {
            refreshes(querySession);
          },
          get data() {
            if (querySession === 0) return { entities: oldRows() };
            if (freshPending())
              throw new Error('A pending query resource was read');
            return { entities: [channelEntity('fresh')] };
          },
        };
      });
      return {
        sources: useChannelsSources(enabled, sort, cached),
        references: useCachedChannelsByIds(
          () => ['old'],
          () => true
        ),
        dispose,
        setCached,
        setOldRows,
        setFreshPending,
        setEnabled,
        setSort,
      };
    });
    const confirmLogin = () =>
      queryClient.fetchQuery({
        queryKey: authKeys.userInfo.queryKey,
        queryFn: async () => ({ id: 'user-1', authenticated: true }),
        staleTime: 0,
      });
    const refresh = sources.team_channels.refresh;
    try {
      expect(sources.team_channels.items().map(({ id }) => id)).toEqual([
        'old',
      ]);
      expect(references.channels().map(({ id }) => id)).toEqual(['old']);
      const initialQueries = useSoupAstItemsQuery.mock.calls.length;
      await resetQueryAccountSession();
      expect(
        Object.values(sources).every((source) => source.items().length === 0)
      ).toBe(true);
      expect(references.channels()).toEqual([]);
      expect(disposedQueries).toHaveLength(initialQueries);
      await refresh();
      expect(refreshes).not.toHaveBeenCalled();
      queryClient.setQueryData(authKeys.userInfo.queryKey, {
        id: 'user-1',
        authenticated: true,
      });
      expect(useSoupAstItemsQuery.mock.calls).toHaveLength(initialQueries);
      session = 1;
      await confirmLogin();
      expect(useSoupAstItemsQuery.mock.calls.length).toBeGreaterThan(
        initialQueries
      );
      const currentQueries = useSoupAstItemsQuery.mock.calls.length;
      expect(sources.team_channels.items()).toEqual([]);
      expect(references.channels()).toEqual([]);
      setOldRows([channelEntity('late-old')]);
      expect(sources.team_channels.items()).toEqual([]);
      setCached([channelEntity('cached-in-new-session')]);
      expect(sources.team_channels.items().map(({ id }) => id)).toEqual([
        'cached-in-new-session',
      ]);
      setFreshPending(false);
      expect(sources.team_channels.items().map(({ id }) => id)).toEqual([
        'fresh',
      ]);
      setSort('created_at');
      setEnabled(false);
      setEnabled(true);
      expect(useSoupAstItemsQuery.mock.calls).toHaveLength(currentQueries);
      await refresh();
      expect(refreshes).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      dispose();
      await confirmLogin();
      useSoupAstItemsQuery.mockReset();
      queryClient.clear();
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
        hasPageData: true,
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
