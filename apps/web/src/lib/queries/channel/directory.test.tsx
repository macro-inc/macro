/**
 * @vitest-environment jsdom
 */

import type {
  CacheChangeListener,
  CacheGenerationChange,
} from '@graphql-cache/host/types';
import type {
  ChannelDirectoryFieldsFragment,
  ChannelDirectoryPageQuery,
} from '@service-storage/graphql/generated/graphql';
import type {
  GraphqlSoupHydrationPage,
  GraphqlSoupInput,
} from '@service-storage/graphql-soup';
import { render } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/solid-query';
import type { Client } from '@urql/core';
import { createRenderEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initialSoupBackfillCheckpoint,
  markSoupBackfillLaneFailed,
  saveSoupBackfillCheckpoint,
} from '../soup/backfill-checkpoint';
import {
  type ByIdOutcome,
  type ChannelDirectory,
  channelDirectoryPagesQueryOptions,
  channelDirectoryState,
  createByIdReader,
  createCachedChannelDirectory,
  createMemoryChannelDirectory,
  fetchCurrentDirectoryPages,
  fetchJoinedChannels,
  lookupChannel,
  refreshChannelDirectory,
  settledChannelLookup,
  staticChannelDirectory,
} from './directory';
import type { DirectoryChannel } from './directory-core';
import { CHANNEL_DIRECTORY_CHECKPOINT_ID } from './directory-lane';
import { channelName, channelUuid } from './tests/channel-uuid';
import { directoryChannel as channelWithId } from './tests/directory-channel';
import {
  fakeChannelCache,
  channelRecord as recordWithId,
} from './tests/directory-fixtures';

// Channels are named by readable test names; their ids are UUIDs, as the
// server's are, since the directory never reads an id it cannot parse.
const channelRecord = (
  name: string,
  overrides?: Parameters<typeof recordWithId>[1]
) => recordWithId(channelUuid(name), overrides);
const directoryChannel = (
  name: string,
  overrides?: Parameters<typeof channelWithId>[1]
) => channelWithId(channelUuid(name), overrides);

import { stampCachedChannelView } from './viewed-at';

const VIEWER = 'macro|viewer@example.com';
const PAGE_SIZE = 2;
// Views, in order.
const VIEWED_0 = '2026-11-20T10:00:00Z';
const VIEWED_1 = '2026-11-20T11:00:00Z';
const VIEWED_2 = '2026-11-20T12:00:00Z';
const VIEWED_3 = '2026-11-20T13:00:00Z';

const disposers: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/** The ids a by-id read names, or undefined for a lane page. */
function namedIds(input: GraphqlSoupInput): string[] | undefined {
  const ids = [...JSON.stringify(input).matchAll(/"channelId":"([^"]+)"/g)].map(
    ([, id]) => id
  );
  return ids.length > 0 ? ids : undefined;
}

type FakeNetworkOptions = {
  /** Holds lane pages until `release`. */
  holdPages?: boolean;
  /** Lane page reads to fail before they answer. */
  failingPages?: number;
};

/**
 * The server's channel directory query over `channels`: the lane in pages of
 * two, or the channels a by-id read names.
 */
function fakeNetwork(
  channels: ChannelDirectoryFieldsFragment[],
  options: FakeNetworkOptions = {}
) {
  let release!: () => void;
  const released = new Promise<void>((done) => {
    release = done;
  });
  if (!options.holdPages) release();
  let failures = options.failingPages ?? 0;
  const inputs: GraphqlSoupInput[] = [];

  const answer = async (
    input: GraphqlSoupInput
  ): Promise<{ data?: ChannelDirectoryPageQuery; error?: Error }> => {
    inputs.push(input);
    const named = namedIds(input);
    if (named)
      return page(
        channels.filter(({ id }) => named.includes(id)),
        null
      );
    await released;
    if (failures > 0) {
      failures -= 1;
      return { error: new Error('offline') };
    }
    const joined = channels.filter(({ isParticipant }) => isParticipant);
    const start = input.continuation ? Number(input.continuation.cursor) : 0;
    const end = start + PAGE_SIZE;
    return page(
      joined.slice(start, end),
      end < joined.length ? String(end) : null
    );
  };

  const query = vi.fn(
    (_document: unknown, variables: { input: GraphqlSoupInput }) => ({
      toPromise: () => answer(variables.input),
    })
  );
  return { client: fakeClient(query), query, inputs, release };
}

function page(
  items: ChannelDirectoryFieldsFragment[],
  nextCursor: string | null
): { data: ChannelDirectoryPageQuery } {
  return {
    data: {
      __typename: 'Query',
      user: { __typename: 'GraphqlUser', soup: { items, nextCursor } },
    } as unknown as ChannelDirectoryPageQuery,
  };
}

/** A stand-in for the urql client: only `query(...).toPromise()` is read. */
function fakeClient(
  query: (...args: never[]) => unknown
): Pick<Client, 'query'> {
  return { query } as unknown as Pick<Client, 'query'>;
}

/** By-id outcomes keyed by test name, keyed by id. */
const byName = (outcomes: Record<string, ByIdOutcome>) =>
  Object.fromEntries(
    Object.entries(outcomes).map(([name, outcome]) => [
      channelUuid(name),
      outcome,
    ])
  );

const ids = (channels: readonly DirectoryChannel[]) =>
  channels.map(({ id }) => channelName(id));

/** The view a lookup shows, or its status when it found nothing. */
function viewedAt(directory: ChannelDirectory, name: string) {
  const lookup = directory.lookup(channelUuid(name));
  return lookup.status === 'loaded' ? lookup.channel.viewedAt : lookup.status;
}

describe('lookupChannel', () => {
  const joined = directoryChannel('joined');
  const unjoined = directoryChannel('unjoined', { isParticipant: false });

  it('answers a joined record and refuses an unjoined one', () => {
    const state = channelDirectoryState([joined, unjoined], [], false);
    expect(lookupChannel(state, byName({}), channelUuid('joined'))).toEqual({
      status: 'loaded',
      channel: joined,
    });
    expect(lookupChannel(state, byName({}), channelUuid('unjoined'))).toEqual({
      status: 'missing',
    });
  });

  it('waits on a partial directory unless a by-id read found nothing', () => {
    const state = channelDirectoryState([joined], [], false);
    expect(lookupChannel(state, byName({}), channelUuid('other')).status).toBe(
      'pending'
    );
    expect(
      lookupChannel(state, byName({ other: 'absent' }), channelUuid('other'))
        .status
    ).toBe('missing');
    expect(
      lookupChannel(state, byName({ other: 'failed' }), channelUuid('other'))
        .status
    ).toBe('pending');
  });

  it('answers missing at once for an id no channel can have', () => {
    const state = channelDirectoryState([joined], [], false);
    expect(lookupChannel(state, {}, 'not-a-channel').status).toBe('missing');
  });

  it('waits for a record the complete directory holds without every field', () => {
    const state = channelDirectoryState([joined], [channelUuid('thin')], true);
    expect(lookupChannel(state, byName({}), channelUuid('thin')).status).toBe(
      'pending'
    );
    // Returned but still not in the directory: not a joined channel.
    expect(
      lookupChannel(state, byName({ thin: 'returned' }), channelUuid('thin'))
        .status
    ).toBe('missing');
    expect(lookupChannel(state, byName({}), channelUuid('other')).status).toBe(
      'missing'
    );
  });
});

describe('by-id reader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  type Read = Parameters<typeof createByIdReader>[0];
  /** A reader whose ids, requested, read and answered, are test names. */
  function mountReader(read: Read) {
    const reader = createRoot((dispose) => {
      disposers.push(dispose);
      return createByIdReader(async (ids, signal) => {
        const found = await read(ids.map(channelName), signal);
        return {
          returned:
            found.returned && new Set([...found.returned].map(channelUuid)),
          unreadable: found.unreadable?.map(channelUuid),
        };
      });
    });
    return {
      request: (name: string) => reader.request(channelUuid(name)),
      outcomes: () =>
        Object.fromEntries(
          Object.entries(reader.outcomes()).map(([id, outcome]) => [
            channelName(id),
            outcome,
          ])
        ),
    };
  }

  it('never names an id the server cannot parse in a read', async () => {
    const read = vi.fn<Read>(async (ids) => ({ returned: new Set(ids) }));
    const reader = createRoot((dispose) => {
      disposers.push(dispose);
      return createByIdReader(read);
    });
    expect(reader.request('not-a-channel')).toBe(false);
    reader.request(channelUuid('a'));
    await vi.advanceTimersByTimeAsync(100);
    expect(read.mock.calls.map(([ids]) => ids)).toEqual([[channelUuid('a')]]);
  });

  it('reads a failed id again within the cooldown while others keep failing', async () => {
    const read = vi.fn<Read>(async () => {
      throw new Error('offline');
    });
    const reader = mountReader(read);
    reader.request('a');
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    expect(reader.outcomes().a).toBe('failed');

    // Another channel fails every ten seconds.
    for (const id of ['b', 'c', 'd']) {
      await vi.advanceTimersByTimeAsync(10_000);
      reader.request(id);
    }
    await vi.advanceTimersByTimeAsync(1_000);

    expect(reader.outcomes().a).toBeUndefined();
    expect(reader.request('a')).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    // Two attempts each time.
    expect(read.mock.calls.filter(([ids]) => ids.includes('a'))).toHaveLength(
      4
    );
  });

  it('reads at most two batches at a time', async () => {
    const answers: (() => void)[] = [];
    const read = vi.fn<Read>(
      (ids) =>
        new Promise((resolve) => {
          answers.push(() => resolve({ returned: new Set(ids) }));
        })
    );
    const reader = mountReader(read);
    for (let i = 0; i < 250; i += 1) reader.request(`c${i}`);
    await vi.advanceTimersByTimeAsync(100);
    expect(read.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100]);

    answers.shift()?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(read.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 50]);
    expect(reader.request('c0')).toBe(false);
  });

  it('reads again the ids a read without evidence lists as unreadable', async () => {
    const read = vi.fn<Read>(async (ids) => ({
      returned: undefined,
      unreadable: ids.filter((id) => id !== 'seen'),
    }));
    const reader = mountReader(read);
    reader.request('seen');
    reader.request('lost');
    await vi.advanceTimersByTimeAsync(100);

    expect(reader.outcomes()).toEqual({ seen: 'returned', lost: 'failed' });
    expect(read.mock.calls.map(([ids]) => ids)).toEqual([
      ['seen', 'lost'],
      ['lost'],
    ]);
  });
});

describe('fetchJoinedChannels', () => {
  it('pages the lane to its last page, continuing from each cursor', async () => {
    const network = fakeNetwork(
      ['a', 'b', 'c', 'd', 'e'].map((id) => channelRecord(id))
    );

    const channels = await fetchJoinedChannels(network.client);

    expect(ids(channels)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(network.inputs.map((input) => input.continuation?.cursor)).toEqual([
      undefined,
      '2',
      '4',
    ]);
  });

  it('keeps one copy of a channel that two pages return', async () => {
    const pages = [
      page([channelRecord('a'), channelRecord('b')], '1'),
      page([channelRecord('b', { name: 'moved' }), channelRecord('c')], null),
    ];
    const client = fakeClient(
      vi.fn(() => ({ toPromise: async () => pages.shift() ?? {} }))
    );

    const channels = await fetchJoinedChannels(client);

    expect(ids(channels)).toEqual(['a', 'b', 'c']);
    expect(channels[1]?.name).toBe('moved');
  });

  it('stops when aborted', async () => {
    const network = fakeNetwork([channelRecord('a')]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchJoinedChannels(network.client, controller.signal)
    ).rejects.toThrow();
    expect(network.query).not.toHaveBeenCalled();
  });
});

describe('staticChannelDirectory', () => {
  it('is complete and answers from its channels as they change', async () => {
    const [channels, setChannels] = createSignal<readonly DirectoryChannel[]>([
      directoryChannel('a'),
    ]);
    const directory = createRoot((dispose) => {
      disposers.push(dispose);
      return staticChannelDirectory(channels);
    });

    expect(directory.complete()).toBe(true);
    expect(directory.lookup(channelUuid('b')).status).toBe('missing');
    setChannels([directoryChannel('a'), directoryChannel('b')]);
    expect(directory.lookup(channelUuid('b')).status).toBe('loaded');
    expect(ids(await directory.readComplete())).toEqual(['a', 'b']);
  });
});

/** Mounts the in-memory directory under a query client that never retries. */
function mountMemoryDirectory(
  network: Pick<ReturnType<typeof fakeNetwork>, 'client'>,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
) {
  let directory!: ChannelDirectory;
  const view = render(() => (
    <QueryClientProvider client={queryClient}>
      {(() => {
        directory = createMemoryChannelDirectory({
          userId: VIEWER,
          client: () => network.client,
          queryClient,
        });
        return null;
      })()}
    </QueryClientProvider>
  ));
  disposers.push(() => {
    view.unmount();
    queryClient.clear();
  });
  return directory;
}

describe('in-memory channel directory', () => {
  it('reads the channel on screen by id while the pages load, then is complete', async () => {
    const network = fakeNetwork(
      ['a', 'b', 'c', 'd'].map((id) => channelRecord(id)),
      { holdPages: true }
    );
    const directory = mountMemoryDirectory(network);

    expect(directory.lookup(channelUuid('c')).status).toBe('pending');
    await vi.waitFor(() =>
      expect(directory.lookup(channelUuid('c')).status).toBe('loaded')
    );
    expect(directory.complete()).toBe(false);
    expect(ids(directory.channels())).toEqual(['c']);

    network.release();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels())).toEqual(['a', 'b', 'c', 'd']);
    expect(directory.lookup(channelUuid('zzz')).status).toBe('missing');
  });

  it('marks a channel the server does not return as missing before the pages land', async () => {
    const network = fakeNetwork([channelRecord('a')], { holdPages: true });
    const directory = mountMemoryDirectory(network);

    expect(directory.lookup(channelUuid('gone')).status).toBe('pending');
    await vi.waitFor(() =>
      expect(directory.lookup(channelUuid('gone')).status).toBe('missing')
    );
  });

  it('fails when a page fails and reads again on retry', async () => {
    const network = fakeNetwork([channelRecord('a')], { failingPages: 1 });
    const directory = mountMemoryDirectory(network);

    await vi.waitFor(() => expect(directory.failed()).toBe(true));
    expect(directory.complete()).toBe(false);

    directory.retry();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(directory.failed()).toBe(false);
  });

  it('reads every joined channel for a caller that needs them all', async () => {
    const network = fakeNetwork([
      channelRecord('a'),
      channelRecord('b'),
      channelRecord('c'),
    ]);
    const directory = mountMemoryDirectory(network);

    expect(ids(await directory.readComplete())).toEqual(['a', 'b', 'c']);
  });

  it('shows a recorded view over the by-id read and the pages read before it', async () => {
    const network = fakeNetwork([channelRecord('a', { viewedAt: VIEWED_0 })], {
      holdPages: true,
    });
    const directory = mountMemoryDirectory(network);
    await vi.waitFor(() => expect(viewedAt(directory, 'a')).toBe(VIEWED_0));

    directory.recordView(channelUuid('a'), VIEWED_2);
    expect(viewedAt(directory, 'a')).toBe(VIEWED_2);

    network.release();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(viewedAt(directory, 'a')).toBe(VIEWED_2);
    expect((await directory.readComplete())[0]?.viewedAt).toBe(VIEWED_2);

    directory.recordView(channelUuid('a'), VIEWED_1);
    expect(viewedAt(directory, 'a')).toBe(VIEWED_2);
  });

  it('keeps a recorded view through a refetch that read an older one', async () => {
    const channels = [channelRecord('a', { viewedAt: VIEWED_0 })];
    const network = fakeNetwork(channels);
    const directory = mountMemoryDirectory(network);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    directory.recordView(channelUuid('a'), VIEWED_2);

    const before = network.inputs.length;
    directory.retry();
    await vi.waitFor(() =>
      expect(network.inputs.length).toBeGreaterThan(before)
    );
    await new Promise((done) => setTimeout(done, 20));
    expect(viewedAt(directory, 'a')).toBe(VIEWED_2);

    // A later view from elsewhere shows as the server returns it.
    channels[0] = channelRecord('a', { viewedAt: VIEWED_3 });
    directory.retry();
    await vi.waitFor(() => expect(viewedAt(directory, 'a')).toBe(VIEWED_3));
  });
});

type CachedDirectoryOptions = {
  viewer?: string;
  generation?: string;
  fetchAll?: () => Promise<readonly DirectoryChannel[]>;
  /** The network's joined channels, paged once the lane gave up. */
  pageAll?: (signal: AbortSignal) => Promise<readonly DirectoryChannel[]>;
  /** Ids a by-id read returns without a readable record. */
  unreadable?: readonly string[];
  /** By-id reads answer once this settles. */
  byIdGate?: Promise<void>;
};

const CACHE_SESSION = 'session-1';

/** Mounts the cached directory over a fake cache whose by-id reads land the
 * named records from `server`. The viewer and storage generation it reports
 * can change, and a listing can be held after it has read the records, to
 * change things while a scan is under way. */
function mountCachedDirectory(
  server: ChannelDirectoryFieldsFragment[],
  options: CachedDirectoryOptions = {}
) {
  const cache = fakeChannelCache();
  let viewer = options.viewer ?? VIEWER;
  let generation = options.generation ?? 'g1';
  let hold: Promise<void> | undefined;
  const changeListeners: CacheChangeListener[] = [];
  const generationListeners: ((change: CacheGenerationChange) => void)[] = [];
  const search = cache.host.search;
  const host = {
    ...cache.host,
    search: vi.fn(async (...args: Parameters<typeof search>) => {
      const listed = await search(...args);
      await hold;
      return listed;
    }),
    currentStorageGeneration: vi.fn(async () => generation),
    readQuery: vi.fn(async () => ({
      kind: 'hit' as const,
      data: { user: { id: viewer } },
    })),
    onCacheChanged: (listener: CacheChangeListener) => {
      changeListeners.push(listener);
      return () => changeListeners.splice(changeListeners.indexOf(listener), 1);
    },
    onCacheGenerationChanged: (
      listener: (change: CacheGenerationChange) => void
    ) => {
      generationListeners.push(listener);
      return () =>
        generationListeners.splice(generationListeners.indexOf(listener), 1);
    },
  };
  const hydrate = vi.fn(
    async (input: GraphqlSoupInput): Promise<GraphqlSoupHydrationPage> => {
      await options.byIdGate;
      const named = namedIds(input) ?? [];
      const found = server.filter(({ id }) => named.includes(id));
      for (const record of found)
        cache.put(record, {
          incomplete: options.unreadable?.map(channelUuid).includes(record.id),
        });
      return { nextCursor: null, entityIds: found.map(({ id }) => id) };
    }
  );
  const fetchAll = vi.fn(options.fetchAll ?? (async () => []));
  const pageAll = vi.fn<
    (signal: AbortSignal) => Promise<readonly DirectoryChannel[]>
  >(options.pageAll ?? (async () => []));
  const stampView = vi.fn((channelId: string, viewedAt: string) =>
    stampCachedChannelView(host, channelId, viewedAt, CACHE_SESSION)
  );
  const directory = createRoot((dispose) => {
    disposers.push(dispose);
    return createCachedChannelDirectory({
      host,
      userId: VIEWER,
      hydrate,
      fetchAll,
      pageAll,
      stampView,
    });
  });
  return {
    cache,
    host,
    directory,
    hydrate,
    fetchAll,
    pageAll,
    stampView,
    /** The view the cached record holds. */
    cachedViewedAt(name: string) {
      return (
        cache.records.get(`GraphqlSoupChannel:${channelUuid(name)}`)?.record ??
        {}
      ).viewedAt;
    },
    /** Holds every listing's answer until the returned release is called. */
    holdListings() {
      let release!: () => void;
      hold = new Promise((done) => {
        release = done;
      });
      return () => {
        hold = undefined;
        release();
      };
    },
    setViewer(next: string) {
      viewer = next;
    },
    resetStorage(next: string) {
      generation = next;
      for (const listener of [...generationListeners])
        listener({ storage: 'reset' } as CacheGenerationChange);
    },
    /** A new cache engine over the same storage, which reads again. */
    reopen() {
      for (const listener of [...generationListeners])
        listener({ storage: 'preserved' } as CacheGenerationChange);
    },
  };
}

/** Records that a pass of the channel lane finished in `generation`. */
function completeLane(generation: string) {
  saveSoupBackfillCheckpoint(
    {
      ...initialSoupBackfillCheckpoint(VIEWER, generation),
      completed: true,
      completedAt: '2026-11-20T00:00:00Z',
    },
    CHANNEL_DIRECTORY_CHECKPOINT_ID
  );
}

/** Every (complete, joined ids) the directory showed, in order. */
function recordStates(directory: ChannelDirectory) {
  const seen: { complete: boolean; ids: string[] }[] = [];
  createRoot((dispose) => {
    disposers.push(dispose);
    createRenderEffect(() =>
      seen.push({
        complete: directory.complete(),
        ids: ids(directory.channels()),
      })
    );
  });
  return seen;
}

describe('cached channel directory', () => {
  it('is partial until the lane finishes a pass in this storage generation', async () => {
    const { cache, directory } = mountCachedDirectory([]);
    cache.put(channelRecord('a'));
    cache.put(channelRecord('left', { isParticipant: false }));
    // Mounted before the records landed: reread on the next refresh.
    completeLane('g0');

    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['a']));
    expect(directory.complete()).toBe(false);
    expect(directory.lookup(channelUuid('left')).status).toBe('missing');

    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(directory.failed()).toBe(false);
  });

  it('never calls a scan complete that started before the lane finished', async () => {
    const { cache, directory, holdListings, host, reopen } =
      mountCachedDirectory([]);
    cache.put(channelRecord('a'));
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['a']));
    const seen = recordStates(directory);

    // A scan has listed the records when the lane's last page lands.
    const release = holdListings();
    const listings = host.search.mock.calls.length;
    reopen();
    await vi.waitFor(() =>
      expect(host.search.mock.calls.length).toBeGreaterThan(listings)
    );
    cache.put(channelRecord('last'));
    completeLane('g1');
    release();

    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(seen.filter(({ complete }) => complete)).toEqual(
      seen
        .filter(({ complete }) => complete)
        .map(() => ({ complete: true, ids: ['a', 'last'] }))
    );
  });

  it('drops a scan when the cache changed hands while it ran', async () => {
    const { cache, directory, holdListings, setViewer, host, reopen } =
      mountCachedDirectory([]);
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    const seen = recordStates(directory);

    // The next viewer's records land while a scan is under way.
    const release = holdListings();
    const listings = host.search.mock.calls.length;
    cache.put(channelRecord('theirs'));
    reopen();
    await vi.waitFor(() =>
      expect(host.search.mock.calls.length).toBeGreaterThan(listings)
    );
    setViewer('macro|someone-else@example.com');
    release();

    await vi.waitFor(() => expect(directory.complete()).toBe(false));
    expect(directory.channels()).toEqual([]);
    expect(seen.flatMap((state) => state.ids)).not.toContain('theirs');
  });

  it('retires what it read when the storage resets, and reads the new one', async () => {
    const { cache, directory, resetStorage } = mountCachedDirectory([]);
    cache.put(channelRecord('a'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    cache.records.clear();
    cache.put(channelRecord('fresh'));
    resetStorage('g2');

    expect(directory.complete()).toBe(false);
    await vi.waitFor(() =>
      expect(ids(directory.channels())).toEqual(['fresh'])
    );
    expect(directory.complete()).toBe(false);
    completeLane('g2');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
  });

  it('answers a mistyped channel link as missing and reads only real ids', async () => {
    const { directory, hydrate } = mountCachedDirectory([channelRecord('a')]);

    expect(directory.lookup('not-a-channel').status).toBe('missing');
    expect(directory.lookup(channelUuid('a')).status).toBe('pending');
    await vi.waitFor(() =>
      expect(directory.lookup(channelUuid('a')).status).toBe('loaded')
    );
    expect(hydrate.mock.calls.map(([input]) => namedIds(input))).toEqual([
      [channelUuid('a')],
    ]);
  });

  it('reads a pending channel by id and answers once its record is cached', async () => {
    const { directory, hydrate } = mountCachedDirectory([
      channelRecord('late', { name: 'Late' }),
    ]);

    expect(directory.lookup(channelUuid('late')).status).toBe('pending');
    await vi.waitFor(() =>
      expect(directory.lookup(channelUuid('late'))).toMatchObject({
        status: 'loaded',
        channel: { name: 'Late' },
      })
    );
    expect(directory.lookup(channelUuid('never')).status).toBe('pending');
    await vi.waitFor(() =>
      expect(directory.lookup(channelUuid('never')).status).toBe('missing')
    );
    expect(hydrate).toHaveBeenCalledTimes(2);
  });

  it('reads only the records a by-id read wrote, not the whole listing', async () => {
    const { directory, host } = mountCachedDirectory([
      channelRecord('late', { name: 'Late' }),
    ]);
    await vi.waitFor(() => expect(host.search).toHaveBeenCalled());
    await vi.waitFor(() => expect(host.readQuery).toHaveBeenCalled());
    const listings = host.search.mock.calls.length;

    expect(directory.lookup(channelUuid('late')).status).toBe('pending');
    await vi.waitFor(() =>
      expect(directory.lookup(channelUuid('late')).status).toBe('loaded')
    );

    expect(host.search).toHaveBeenCalledTimes(listings);
    expect(host.readRecordsByKeys).toHaveBeenLastCalledWith(
      expect.objectContaining({
        keys: [`GraphqlSoupChannel:${channelUuid('late')}`],
      })
    );
  });

  it('reads a returned channel again when its record cannot be read', async () => {
    const { directory, hydrate } = mountCachedDirectory(
      [channelRecord('thin')],
      { unreadable: ['thin'] }
    );

    expect(directory.lookup(channelUuid('thin')).status).toBe('pending');
    // Read once more, then given up on for a while.
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    // Neither answered: still waiting, not missing.
    expect(directory.lookup(channelUuid('thin')).status).toBe('pending');
  });

  it('keeps waiting on a channel a by-id read gave no evidence for', async () => {
    const network = [directoryChannel('thin')];
    const { cache, directory, hydrate, fetchAll } = mountCachedDirectory([], {
      fetchAll: async () => network,
    });
    // A page that reached its limit without the channel.
    hydrate.mockImplementation(async () => ({
      nextCursor: 'more',
      entityIds: [],
    }));
    cache.put(channelRecord('thin'), { incomplete: true });
    completeLane('g1');

    // Complete once both reads gave up, so the cache answers offline.
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(hydrate).toHaveBeenCalledTimes(2);
    expect(directory.lookup(channelUuid('thin')).status).toBe('pending');
    // But not proven: a full read still asks the network.
    expect(ids(await directory.readComplete())).toEqual(['thin']);
    expect(fetchAll).toHaveBeenCalledOnce();
  });

  it('stays partial until each record that lacks a field was read by id', async () => {
    let release!: () => void;
    const byIdGate = new Promise<void>((done) => {
      release = done;
    });
    const { cache, directory, hydrate, fetchAll } = mountCachedDirectory(
      [channelRecord('thin')],
      {
        byIdGate,
        fetchAll: async () => [directoryChannel('a'), directoryChannel('thin')],
      }
    );
    cache.put(channelRecord('a'));
    // A joined channel another query cached without every directory field.
    cache.put(channelRecord('thin'), { incomplete: true });
    completeLane('g1');

    await vi.waitFor(() => expect(hydrate).toHaveBeenCalled());
    expect(ids(directory.channels())).toEqual(['a']);
    expect(directory.complete()).toBe(false);
    expect(ids(await directory.readComplete()).sort()).toEqual(['a', 'thin']);
    expect(fetchAll).toHaveBeenCalledOnce();

    release();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels()).sort()).toEqual(['a', 'thin']);
    expect(ids(await directory.readComplete()).sort()).toEqual(['a', 'thin']);
    expect(fetchAll).toHaveBeenCalledOnce();
  });

  it('reads every incomplete record, 500 new ones a read, past ones already read', async () => {
    const { cache, directory, hydrate } = mountCachedDirectory([]);
    hydrate.mockImplementation(async () => ({
      nextCursor: null,
      entityIds: [],
    }));
    for (let i = 0; i < 600; i += 1)
      cache.put(channelRecord(`i${String(i).padStart(3, '0')}`), {
        incomplete: true,
      });
    completeLane('g1');
    const named = () =>
      new Set(hydrate.mock.calls.flatMap(([input]) => namedIds(input) ?? []));

    // The rereads after the first answers queue the rest, and the directory
    // is complete only once all of them answered.
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(named().size).toBe(600);
  });

  it('reads every channel from the network until complete, then from the cache', async () => {
    const network = [directoryChannel('a'), directoryChannel('b')];
    const { cache, directory, fetchAll } = mountCachedDirectory([], {
      fetchAll: async () => network,
    });

    expect(ids(await directory.readComplete())).toEqual(['a', 'b']);
    expect(fetchAll).toHaveBeenCalledOnce();

    cache.put(channelRecord('a'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(await directory.readComplete())).toEqual(['a']);
    expect(fetchAll).toHaveBeenCalledOnce();
  });

  it('completes from the network once the lane gives up', async () => {
    const { cache, directory, pageAll } = mountCachedDirectory(
      [channelRecord('b')],
      { pageAll: async () => [directoryChannel('a'), directoryChannel('b')] }
    );
    cache.put(channelRecord('a', { name: 'cached a' }));
    // Cached when the viewer lost it, and no removal reached the cache.
    cache.put(channelRecord('stale'));
    await vi.waitFor(() =>
      expect(ids(directory.channels())).toEqual(['a', 'stale'])
    );
    expect(directory.complete()).toBe(false);

    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');

    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(pageAll).toHaveBeenCalledOnce();
    // Unchanged since the network read them, the cached rows are older.
    expect(directory.channels().map(({ name }) => name)).toEqual([
      'channel a',
      'channel b',
    ]);
    expect(directory.lookup(channelUuid('stale')).status).toBe('missing');
    expect(ids(await directory.readComplete())).toEqual(['a', 'b']);
    expect(directory.lookup(channelUuid('zzz')).status).toBe('missing');
    expect(directory.failed()).toBe(false);
  });

  it('follows what the cache changes after the network read began', async () => {
    let answer!: (channels: DirectoryChannel[]) => void;
    const { cache, directory, reopen } = mountCachedDirectory(
      [channelRecord('joined')],
      {
        pageAll: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      }
    );
    cache.put(channelRecord('kept'));
    cache.put(channelRecord('removed'));
    cache.put(channelRecord('left'));
    await vi.waitFor(() => expect(directory.channels()).toHaveLength(3));
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(answer).toBeDefined());

    // While the pages are read: a removal, a leave, a join and a rename.
    cache.records.delete(`GraphqlSoupChannel:${channelUuid('removed')}`);
    cache.put(channelRecord('left', { isParticipant: false }), {
      sourceHash: 'left-2',
    });
    cache.put(channelRecord('joined'));
    reopen();
    await vi.waitFor(() =>
      expect(ids(directory.channels()).sort()).toEqual(['joined', 'kept'])
    );
    answer([
      directoryChannel('kept'),
      directoryChannel('removed'),
      directoryChannel('left'),
    ]);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    // The join, which the pages did not list, once a by-id read returns it.
    await vi.waitFor(() =>
      expect(ids(directory.channels()).sort()).toEqual(['joined', 'kept'])
    );

    // And after the pages landed.
    cache.put(channelRecord('kept', { name: 'renamed' }), {
      sourceHash: 'kept-2',
    });
    cache.records.delete(`GraphqlSoupChannel:${channelUuid('joined')}`);
    reopen();
    await vi.waitFor(() =>
      expect(directory.channels().map(({ name }) => name)).toEqual(['renamed'])
    );
    expect(ids(await directory.readComplete())).toEqual(['kept']);
  });

  it('leaves out a cached channel the network did not list, though the cache rewrote it', async () => {
    let answer!: (channels: DirectoryChannel[]) => void;
    const { cache, directory, reopen } = mountCachedDirectory(
      [channelRecord('kept')],
      {
        pageAll: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      }
    );
    cache.put(channelRecord('kept'));
    // Cached when the viewer lost it, and no removal reached the cache.
    cache.put(channelRecord('stale'));
    await vi.waitFor(() => expect(directory.channels()).toHaveLength(2));
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(answer).toBeDefined());

    // A view stamp, or another query's page, rewrites the stale record
    // while the pages are read.
    cache.put(channelRecord('stale', { viewedAt: VIEWED_2 }), {
      sourceHash: 'stale-2',
    });
    reopen();
    await vi.waitFor(() => expect(viewedAt(directory, 'stale')).toBe(VIEWED_2));
    answer([directoryChannel('kept')]);

    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['kept']));
    expect(directory.lookup(channelUuid('stale')).status).toBe('missing');
  });

  it('leaves out a listed channel the cache never held once a by-id read finds it gone', async () => {
    let release!: () => void;
    const byIdGate = new Promise<void>((done) => {
      release = done;
    });
    const { directory } = mountCachedDirectory([channelRecord('a')], {
      byIdGate,
      pageAll: async () => [
        directoryChannel('a'),
        directoryChannel('gone', { channelType: 'private' }),
      ],
    });
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');

    // As the pages listed them until a read says otherwise.
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels()).sort()).toEqual(['a', 'gone']);

    // Deleted after its page was read, while the cache held no record a
    // removal could reach.
    release();
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['a']));
    expect(directory.lookup(channelUuid('gone')).status).toBe('missing');
    expect(ids(await directory.readComplete())).toEqual(['a']);
  });

  it('does not take a pass an earlier build recorded as one that reconciled the cache', async () => {
    const { cache, directory } = mountCachedDirectory([]);
    cache.put(channelRecord('a'));
    // That build recorded a pass complete even when it removed nothing.
    saveSoupBackfillCheckpoint(
      {
        ...initialSoupBackfillCheckpoint(VIEWER, 'g1'),
        completed: true,
        completedAt: '2026-11-19T00:00:00Z',
      },
      'channel-directory'
    );
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['a']));
    expect(directory.complete()).toBe(false);

    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
  });

  it('answers from the cache alone once the lane finishes a pass', async () => {
    const { cache, directory } = mountCachedDirectory([], {
      // By-id reads would write the listed channels into the cache.
      byIdGate: new Promise(() => {}),
      pageAll: async () => [directoryChannel('a'), directoryChannel('b')],
    });
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() =>
      expect(ids(directory.channels())).toEqual(['a', 'b'])
    );

    cache.put(channelRecord('a'));
    completeLane('g1');
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['a']));
    expect(directory.complete()).toBe(true);
  });

  it('fails when the lane gave up and the network fails too, until retried', async () => {
    let attempt = 0;
    const { directory, pageAll } = mountCachedDirectory([channelRecord('a')], {
      pageAll: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('offline');
        return [directoryChannel('a')];
      },
    });
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');

    await vi.waitFor(() => expect(directory.failed()).toBe(true));
    expect(directory.complete()).toBe(false);

    directory.retry();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(directory.failed()).toBe(false);
    expect(ids(directory.channels())).toEqual(['a']);
    expect(pageAll).toHaveBeenCalledTimes(2);
  });

  it('stops paging the network once the lane finishes a pass during the walk', async () => {
    const { cache, directory, pageAll } = mountCachedDirectory([], {
      pageAll: () => new Promise(() => {}),
    });
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(pageAll).toHaveBeenCalledOnce());
    const walk = pageAll.mock.calls[0]?.[0];

    cache.put(channelRecord('a'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    expect(walk?.aborted).toBe(true);
  });

  it('stops failing once the lane finishes a pass after the network failed', async () => {
    const { cache, directory } = mountCachedDirectory([], {
      pageAll: async () => {
        throw new Error('offline');
      },
    });
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(directory.failed()).toBe(true));

    cache.put(channelRecord('a'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(directory.failed()).toBe(false);
    expect(ids(directory.channels())).toEqual(['a']);
  });

  it('shows a recorded view at once and writes it onto the cached record', async () => {
    const { cache, cachedViewedAt, directory } = mountCachedDirectory([]);
    cache.put(channelRecord('a', { viewedAt: VIEWED_0 }));
    completeLane('g1');
    await vi.waitFor(() => expect(viewedAt(directory, 'a')).toBe(VIEWED_0));

    directory.recordView(channelUuid('a'), VIEWED_2);
    expect(viewedAt(directory, 'a')).toBe(VIEWED_2);
    await vi.waitFor(() => expect(cachedViewedAt('a')).toBe(VIEWED_2));
    expect(ids(await directory.readComplete())).toEqual(['a']);
    expect((await directory.readComplete())[0]?.viewedAt).toBe(VIEWED_2);
  });

  it('writes a recorded view again over an older record that replaced it', async () => {
    const { cache, cachedViewedAt, directory, reopen, stampView } =
      mountCachedDirectory([]);
    cache.put(channelRecord('a', { viewedAt: VIEWED_0 }));
    completeLane('g1');
    await vi.waitFor(() => expect(viewedAt(directory, 'a')).toBe(VIEWED_0));
    directory.recordView(channelUuid('a'), VIEWED_2);
    await vi.waitFor(() => expect(cachedViewedAt('a')).toBe(VIEWED_2));

    // A soup page read before the view lands after it.
    cache.put(channelRecord('a', { viewedAt: VIEWED_0, name: 'renamed' }), {
      sourceHash: 'a-older',
    });
    reopen();
    await vi.waitFor(() =>
      expect(directory.lookup(channelUuid('a'))).toMatchObject({
        channel: { name: 'renamed', viewedAt: VIEWED_2 },
      })
    );
    await vi.waitFor(() => expect(cachedViewedAt('a')).toBe(VIEWED_2));

    // Once over each older record: the write it made reads back later.
    const writes = stampView.mock.calls.length;
    reopen();
    await new Promise((done) => setTimeout(done, 50));
    expect(stampView).toHaveBeenCalledTimes(writes);
  });

  it('shows and writes a view recorded before the channel was cached', async () => {
    const server = [channelRecord('a', { viewedAt: VIEWED_0 })];
    const { cachedViewedAt, directory } = mountCachedDirectory(server);

    directory.recordView(channelUuid('a'), VIEWED_2);
    // The lane has not reached it; its by-id read lands the older record.
    await vi.waitFor(() => expect(viewedAt(directory, 'a')).toBe(VIEWED_2));
    await vi.waitFor(() => expect(cachedViewedAt('a')).toBe(VIEWED_2));
  });

  it("answers nothing from another viewer's cache", async () => {
    const { cache, directory, host } = mountCachedDirectory([], {
      viewer: 'macro|someone-else@example.com',
    });
    cache.put(channelRecord('theirs'));
    completeLane('g1');

    // The scope check has answered before the listing would run.
    await vi.waitFor(() => expect(host.readQuery).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(host.currentStorageGeneration).toHaveBeenCalled()
    );
    await new Promise((done) => setTimeout(done, 50));
    expect(host.search).not.toHaveBeenCalled();
    expect(directory.channels()).toEqual([]);
    expect(directory.complete()).toBe(false);
  });
});

/** A network whose first walk answers `first` once released, and every
 * later one `later`. */
function changingNetwork(
  first: ChannelDirectoryFieldsFragment[],
  later: ChannelDirectoryFieldsFragment[]
) {
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  let walks = 0;
  const client = fakeClient(() => ({
    toPromise: async () => {
      walks += 1;
      if (walks > 1) return page(later, null);
      await held;
      return page(first, null);
    },
  }));
  return { client, release, walks: () => walks };
}

describe('refreshChannelDirectory', () => {
  it('gives a full read the pages after a write that landed during it', async () => {
    const network = changingNetwork(
      [channelRecord('a')],
      [channelRecord('a'), channelRecord('b')]
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const directory = mountMemoryDirectory(network, queryClient);
    const complete = directory.readComplete();
    await vi.waitFor(() => expect(network.walks()).toBe(1));

    const refreshed = refreshChannelDirectory(queryClient);
    network.release();
    await refreshed;

    expect(ids(await complete)).toEqual(['a', 'b']);
  });

  it('reads again for a read nobody observes when a write lands during it', async () => {
    const network = changingNetwork(
      [channelRecord('a')],
      [channelRecord('a'), channelRecord('b')]
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    disposers.push(() => queryClient.clear());
    const options = channelDirectoryPagesQueryOptions(
      VIEWER,
      () => network.client
    );
    const read = fetchCurrentDirectoryPages(queryClient, options);
    await vi.waitFor(() => expect(network.walks()).toBe(1));

    const refreshed = refreshChannelDirectory(queryClient);
    network.release();
    await refreshed;

    expect(ids(await read)).toEqual(['a', 'b']);
    expect(network.walks()).toBe(2);
    // Later reads use the cached pages again.
    expect(ids(await fetchCurrentDirectoryPages(queryClient, options))).toEqual(
      ['a', 'b']
    );
    expect(network.walks()).toBe(2);
  });

  it('reads until no write landed during the read', async () => {
    const releases: (() => void)[] = [];
    let walks = 0;
    const client = fakeClient(() => ({
      toPromise: async () => {
        walks += 1;
        const walk = walks;
        await new Promise<void>((done) => releases.push(done));
        // Each read sees one more channel than the one before.
        return page(
          Array.from({ length: walk }, (_, index) =>
            channelRecord(`c${index}`)
          ),
          null
        );
      },
    }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    disposers.push(() => queryClient.clear());
    const read = fetchCurrentDirectoryPages(
      queryClient,
      channelDirectoryPagesQueryOptions(VIEWER, () => client)
    );

    // A write lands during each of the first three reads.
    for (let walk = 1; walk <= 3; walk += 1) {
      await vi.waitFor(() => expect(walks).toBe(walk));
      const refreshed = refreshChannelDirectory(queryClient);
      releases[walk - 1]?.();
      await refreshed;
    }
    await vi.waitFor(() => expect(walks).toBe(4));
    releases[3]?.();

    expect(ids(await read)).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(walks).toBe(4);
  });

  it('reads again after a first read that was in flight during the change', async () => {
    const network = fakeNetwork([channelRecord('a')], { holdPages: true });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    disposers.push(() => queryClient.clear());
    const options = channelDirectoryPagesQueryOptions(
      VIEWER,
      () => network.client
    );
    const observer = new QueryObserver(queryClient, options);
    disposers.push(observer.subscribe(() => undefined));
    await vi.waitFor(() => expect(network.inputs).toHaveLength(1));

    const refreshed = refreshChannelDirectory(queryClient);
    network.release();
    await refreshed;

    // The first walk, then one that started after the change.
    expect(network.inputs).toHaveLength(2);
    expect(queryClient.getQueryState(options.queryKey)?.isInvalidated).toBe(
      false
    );
  });
});

describe('settledChannelLookup', () => {
  function lookingUp() {
    const [lookup, setLookup] = createSignal<
      ReturnType<ChannelDirectory['lookup']>
    >({ status: 'pending' });
    return { directory: { lookup: () => lookup() }, setLookup };
  }

  it('waits for a pending lookup to answer', async () => {
    const { directory, setLookup } = lookingUp();
    const settled = createRoot((dispose) => {
      disposers.push(dispose);
      return settledChannelLookup(directory, 'a', 1_000);
    });
    setLookup({ status: 'loaded', channel: directoryChannel('a') });
    expect(await settled).toMatchObject({
      status: 'loaded',
      channel: { name: 'channel a' },
    });
  });

  it('answers pending when the lookup does not settle in time', async () => {
    const { directory } = lookingUp();
    const settled = createRoot((dispose) => {
      disposers.push(dispose);
      return settledChannelLookup(directory, 'a', 20);
    });
    expect(await settled).toEqual({ status: 'pending' });
  });

  it('answers pending when its owner goes away first', async () => {
    const { directory } = lookingUp();
    const settled = createRoot((dispose) => {
      const promise = settledChannelLookup(directory, 'a', 1_000);
      dispose();
      return promise;
    });
    expect(await settled).toEqual({ status: 'pending' });
  });
});
