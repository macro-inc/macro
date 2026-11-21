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
import { fromPromise, make, pipe, type Source, toPromise } from 'wonka';
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
  pageJoinedChannels,
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

/** A stand-in for the urql client. Like urql's, `query` returns a result
 * source that also has `toPromise`; the stand-in answers with that source,
 * or with `{ toPromise }`, whose answer becomes the source's one result. */
function fakeClient(
  query: (...args: never[]) => unknown
): Pick<Client, 'query'> {
  return {
    query: (...args: never[]) => {
      const answer = query(...args) as
        | Source<unknown>
        | { toPromise: () => Promise<unknown> };
      if (typeof answer === 'function') return answer;
      const source = fromPromise(answer.toPromise());
      return Object.assign(source, {
        toPromise: () => pipe(source, toPromise),
      });
    },
  } as unknown as Pick<Client, 'query'>;
}

/** By-id outcomes keyed by test name, keyed by id. */
const byName = (outcomes: Record<string, ByIdOutcome>) =>
  Object.fromEntries(
    Object.entries(outcomes).map(([name, outcome]) => [
      channelUuid(name),
      outcome,
    ])
  );

/** The channels' fixture names, sorted: these tests check which channels a
 * directory lists; `inDirectoryOrder`'s own tests check their order. */
const ids = (channels: readonly DirectoryChannel[]) =>
  channels.map(({ id }) => channelName(id)).sort();

/** The channels' fixture names in the order the directory lists them. */
const inOrder = (channels: readonly DirectoryChannel[]) =>
  channels.map(({ id }) => channelName(id));

// Three updates, oldest first, for the order tests.
const UPDATED_OLD = '2026-11-01T00:00:00+00:00';
const UPDATED_MID = '2026-11-02T00:00:00+00:00';
const UPDATED_NEW = '2026-11-03T00:00:00+00:00';

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

  it('reads a failed id again after the cooldown unasked, while others keep failing', async () => {
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

    // Two attempts each time, and nobody had to ask again.
    expect(read.mock.calls.filter(([ids]) => ids.includes('a'))).toHaveLength(
      4
    );
    expect(reader.outcomes().a).toBe('failed');
    expect(reader.request('a')).toBe(false);
  });

  it('reads failed ids again only once a hidden tab is shown', async () => {
    const read = vi.fn<Read>(async () => {
      throw new Error('offline');
    });
    const reader = mountReader(read);
    reader.request('a');
    await vi.advanceTimersByTimeAsync(100);
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(90_000);
    expect(read).toHaveBeenCalledTimes(2);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(4);
    visibility.mockRestore();
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

  it('counts the pages the cache wrote once every write settled', async () => {
    const written: ((revision: number | undefined) => void)[] = [];
    const pages = [
      page([channelRecord('a')], '1'),
      page([channelRecord('b')], '2'),
      page([channelRecord('c')], null),
    ].map((answer) => ({
      ...answer,
      extensions: {
        __macroNormalizedCache: {
          source: 'live-network',
          persistence: new Promise<number | undefined>((done) => {
            written.push(done);
          }),
        },
      },
    }));
    const client = fakeClient(
      vi.fn(() => ({ toPromise: async () => pages.shift() ?? {} }))
    );

    const walk = await pageJoinedChannels(client);
    const settled = vi.fn();
    const waiting = (async () => {
      settled(await walk.written);
    })();

    expect(ids(walk.channels)).toEqual(['a', 'b', 'c']);
    expect(walk.pages).toBe(3);
    written[0]?.(4);
    // The cache skipped or failed this page's write.
    written[1]?.(undefined);
    await new Promise((done) => setTimeout(done));
    expect(settled).not.toHaveBeenCalled();
    written[2]?.(5);
    await waiting;
    expect(settled).toHaveBeenCalledExactlyOnceWith(2);
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

  it('ends the page read it waits on when aborted', async () => {
    let ended = false;
    // Like urql's, the request ends only when its subscriber leaves.
    const held = make<never>(() => () => {
      ended = true;
    });
    const client = fakeClient(() =>
      Object.assign(held, { toPromise: () => pipe(held, toPromise) })
    );
    const controller = new AbortController();
    const rejected = expect(
      fetchJoinedChannels(client, controller.signal)
    ).rejects.toThrow();

    controller.abort();

    await vi.waitFor(() => expect(ended).toBe(true));
    await rejected;
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

  it('lists its channels newest update first', () => {
    const directory = createRoot((dispose) => {
      disposers.push(dispose);
      return staticChannelDirectory(() => [
        directoryChannel('old', { updatedAt: UPDATED_OLD }),
        directoryChannel('new', { updatedAt: UPDATED_NEW }),
        directoryChannel('mid', { updatedAt: UPDATED_MID }),
      ]);
    });

    expect(inOrder(directory.channels())).toEqual(['new', 'mid', 'old']);
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
    // Every page it shows was read in this page.
    expect(directory.viewsCurrent()).toBe(true);

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

  it('lists and reads every channel newest update first, across pages', async () => {
    const network = fakeNetwork([
      channelRecord('old', { updatedAt: UPDATED_OLD }),
      channelRecord('new', { updatedAt: UPDATED_NEW }),
      channelRecord('mid', { updatedAt: UPDATED_MID }),
    ]);
    const directory = mountMemoryDirectory(network);

    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(inOrder(directory.channels())).toEqual(['new', 'mid', 'old']);
    expect(inOrder(await directory.readComplete())).toEqual([
      'new',
      'mid',
      'old',
    ]);
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
  /** How many pages the cache wrote of those `pageAll` read, once it
   * wrote them; one at once when left out. */
  written?: Promise<number>;
  /** Ids a by-id read returns without a readable record. */
  unreadable?: readonly string[];
  /** By-id reads answer once this settles. */
  byIdGate?: Promise<void>;
  /** When the page loaded, for `viewsCurrent`. */
  sessionStartedAt?: number;
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
      pageAll: async (signal) => ({
        channels: await pageAll(signal),
        pages: 1,
        written: options.written ?? Promise.resolve(1),
      }),
      stampView,
      sessionStartedAt: options.sessionStartedAt,
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

/** Records the lane's checkpoint as a pass that started at `startedAt`
 * left it: finished, or still paging after an earlier one finished. */
function lanePass(
  generation: string,
  startedAt: string,
  state: 'running' | 'finished',
  earlier = '2026-11-19T00:00:00.000Z'
) {
  const finished = state === 'finished';
  saveSoupBackfillCheckpoint(
    {
      ...initialSoupBackfillCheckpoint(VIEWER, generation),
      completed: finished,
      scanStartedAt: finished ? null : startedAt,
      updatedSince: finished ? startedAt : earlier,
      completedAt: finished ? startedAt : earlier,
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

  it('lists the cached channels newest update first', async () => {
    const { cache, directory } = mountCachedDirectory([]);
    cache.put(channelRecord('old', { updatedAt: UPDATED_OLD }));
    cache.put(channelRecord('new', { updatedAt: UPDATED_NEW }));
    cache.put(channelRecord('mid', { updatedAt: UPDATED_MID }));
    completeLane('g1');

    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(inOrder(directory.channels())).toEqual(['new', 'mid', 'old']);
    expect(inOrder(await directory.readComplete())).toEqual([
      'new',
      'mid',
      'old',
    ]);
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

  describe('views as current as the page', () => {
    const LOADED_AT = '2026-11-21T08:00:00.000Z';

    it('keeps records an earlier pass read stale until a pass that started after the page loaded finishes', async () => {
      const { cache, directory } = mountCachedDirectory([], {
        sessionStartedAt: Date.parse(LOADED_AT),
      });
      cache.put(channelRecord('a'));
      // The last session's pass: complete, but older than this page.
      lanePass('g1', '2026-11-20T08:00:00.000Z', 'finished');
      await vi.waitFor(() => expect(directory.complete()).toBe(true));
      expect(directory.viewsCurrent()).toBe(false);

      // This session's pass is paging: still complete, still not current.
      lanePass('g1', '2026-11-21T08:00:01.000Z', 'running');
      await new Promise((done) => setTimeout(done, 20));
      expect(directory.complete()).toBe(true);
      expect(directory.viewsCurrent()).toBe(false);

      lanePass('g1', '2026-11-21T08:00:01.000Z', 'finished');
      await vi.waitFor(() => expect(directory.viewsCurrent()).toBe(true));
    });

    it('is not current again once the storage resets', async () => {
      const { cache, directory, resetStorage } = mountCachedDirectory([], {
        sessionStartedAt: Date.parse(LOADED_AT),
      });
      cache.put(channelRecord('a'));
      lanePass('g1', '2026-11-21T08:00:01.000Z', 'finished');
      await vi.waitFor(() => expect(directory.viewsCurrent()).toBe(true));

      resetStorage('g2');
      expect(directory.viewsCurrent()).toBe(false);
      lanePass('g2', '2026-11-21T08:05:00.000Z', 'finished');
      await vi.waitFor(() => expect(directory.viewsCurrent()).toBe(true));
    });
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

  it('stays partial while a by-id read gave no evidence for a record that lacks a field', async () => {
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

    // Both reads gave up: the joined channels may lack this one.
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    await new Promise((done) => setTimeout(done, 50));
    expect(directory.complete()).toBe(false);
    expect(directory.lookup(channelUuid('thin')).status).toBe('pending');
    // A full read asks the network.
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

  it('reads a channel by id again when its record loses a field after a read returned it', async () => {
    const { cache, directory, hydrate, reopen } = mountCachedDirectory([
      channelRecord('thin'),
    ]);
    cache.put(channelRecord('a'));
    cache.put(channelRecord('thin'), { incomplete: true });
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels()).sort()).toEqual(['a', 'thin']);
    expect(hydrate).toHaveBeenCalledOnce();

    // Another query writes the record again without a directory field, and
    // the next read of it is held.
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    hydrate.mockImplementationOnce(async () => {
      await held;
      cache.put(channelRecord('thin'), { sourceHash: 'thin-3' });
      return { nextCursor: null, entityIds: [channelUuid('thin')] };
    });
    cache.put(channelRecord('thin'), {
      incomplete: true,
      sourceHash: 'thin-2',
    });
    reopen();

    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    expect(directory.complete()).toBe(false);
    expect(directory.lookup(channelUuid('thin')).status).toBe('pending');

    release();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels()).sort()).toEqual(['a', 'thin']);
  });

  it('reads a channel by id again when its record arrives after a read found it absent', async () => {
    const server: ChannelDirectoryFieldsFragment[] = [];
    const { cache, directory, hydrate, reopen } = mountCachedDirectory(server);
    cache.put(channelRecord('a'));
    // Before the lane finishes, a link to a channel the viewer has not
    // joined yet is read by id.
    expect(directory.lookup(channelUuid('joined')).status).toBe('pending');
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledOnce());
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(directory.lookup(channelUuid('joined')).status).toBe('missing');

    // The viewer joins, and the join's record lands without every field.
    server.push(channelRecord('joined'));
    cache.put(channelRecord('joined'), { incomplete: true });
    reopen();

    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(directory.lookup(channelUuid('joined')).status).toBe('loaded')
    );
    expect(directory.complete()).toBe(true);
    expect(ids(directory.channels()).sort()).toEqual(['a', 'joined']);
  });

  it('reads a channel by id again when its record, lacking a field when a read found it absent, is written again still lacking one', async () => {
    const server: ChannelDirectoryFieldsFragment[] = [];
    const { cache, directory, hydrate, reopen } = mountCachedDirectory(server);
    cache.put(channelRecord('a'));
    // A record of a channel the viewer left, cached without every field.
    cache.put(channelRecord('joined'), {
      incomplete: true,
      sourceHash: 'joined-1',
    });
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(hydrate).toHaveBeenCalledOnce();
    expect(directory.lookup(channelUuid('joined')).status).toBe('missing');

    // The viewer joins again, and the join's record lands still without
    // every field.
    server.push(channelRecord('joined'));
    cache.put(channelRecord('joined'), {
      incomplete: true,
      sourceHash: 'joined-2',
    });
    reopen();

    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(directory.lookup(channelUuid('joined')).status).toBe('loaded')
    );
    expect(directory.complete()).toBe(true);
    expect(ids(directory.channels()).sort()).toEqual(['a', 'joined']);
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

  describe('a lane that stalls', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Saves a page of a pass still under way. */
    const savePage = () =>
      saveSoupBackfillCheckpoint(
        {
          ...initialSoupBackfillCheckpoint(VIEWER, 'g1'),
          nextCursor: 'next',
          pagesFetched: 1,
          scanStartedAt: '2026-11-20T00:00:00Z',
        },
        CHANNEL_DIRECTORY_CHECKPOINT_ID
      );

    it('pages the network once the lane saves nothing for half a minute', async () => {
      const { cache, directory, pageAll } = mountCachedDirectory(
        [channelRecord('b')],
        { pageAll: async () => [directoryChannel('a'), directoryChannel('b')] }
      );
      cache.put(channelRecord('a'));
      await vi.advanceTimersByTimeAsync(29_000);
      expect(ids(directory.channels())).toEqual(['a']);
      expect(pageAll).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(pageAll).toHaveBeenCalledOnce();
      expect(ids(directory.channels())).toEqual(['a', 'b']);
      // The cache held no record of b: complete once its by-id read finds it.
      expect(directory.complete()).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(directory.complete()).toBe(true);
      expect(ids(directory.channels())).toEqual(['a', 'b']);
    });

    it('waits on a lane that keeps saving pages', async () => {
      const { pageAll } = mountCachedDirectory([], {
        pageAll: async () => [directoryChannel('a')],
      });
      for (let page = 0; page < 4; page += 1) {
        await vi.advanceTimersByTimeAsync(20_000);
        savePage();
      }
      expect(pageAll).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(pageAll).toHaveBeenCalledOnce();
    });

    it('waits again for a pass that starts over in new storage', async () => {
      const { pageAll, resetStorage } = mountCachedDirectory([], {
        pageAll: async () => [directoryChannel('a')],
      });
      await vi.advanceTimersByTimeAsync(20_000);
      resetStorage('g2');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(pageAll).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(pageAll).toHaveBeenCalledOnce();
    });

    it('never pages the network for a finished lane while the cache is slow to list it', async () => {
      completeLane('g1');
      const { directory, holdListings, pageAll } = mountCachedDirectory([]);
      const release = holdListings();
      await vi.advanceTimersByTimeAsync(31_000);
      expect(pageAll).not.toHaveBeenCalled();

      release();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(directory.complete()).toBe(true);
      expect(pageAll).not.toHaveBeenCalled();
    });

    it('never pages the network after the lane finished', async () => {
      completeLane('g1');
      const { directory, pageAll } = mountCachedDirectory([]);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(directory.complete()).toBe(true);
      expect(pageAll).not.toHaveBeenCalled();
    });
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
    expect(
      directory
        .channels()
        .map(({ name }) => name)
        .sort()
    ).toEqual(['channel a', 'channel b']);
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
      expect(
        directory
          .channels()
          .map(({ name }) => name)
          .sort()
      ).toEqual(['renamed'])
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

  it('answers pending for a channel the fallback waits on a by-id read to decide', async () => {
    let answer!: (channels: DirectoryChannel[]) => void;
    let open!: () => void;
    const { cache, directory, hydrate, reopen } = mountCachedDirectory(
      [channelRecord('kept')],
      {
        byIdGate: new Promise<void>((done) => {
          open = done;
        }),
        pageAll: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      }
    );
    cache.put(channelRecord('kept'));
    cache.put(channelRecord('stale'));
    await vi.waitFor(() => expect(directory.channels()).toHaveLength(2));
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(answer).toBeDefined());
    cache.put(channelRecord('stale', { viewedAt: VIEWED_2 }), {
      sourceHash: 'stale-2',
    });
    reopen();
    await vi.waitFor(() => expect(viewedAt(directory, 'stale')).toBe(VIEWED_2));
    answer([directoryChannel('kept')]);
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledOnce());
    expect(ids(directory.channels())).toEqual(['kept']);

    // The network left it out, but the cache rewrote it: the viewer may have
    // rejoined it, and the read under way decides.
    expect(directory.lookup(channelUuid('stale')).status).toBe('pending');
    await new Promise((done) => setTimeout(done, 50));
    expect(hydrate).toHaveBeenCalledOnce();

    open();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(directory.lookup(channelUuid('stale')).status).toBe('missing');
  });

  it('reads a channel again that a by-id read found gone once the viewer rejoins it', async () => {
    let answer!: (channels: DirectoryChannel[]) => void;
    const server = [channelRecord('kept')];
    const { cache, directory, hydrate, reopen } = mountCachedDirectory(server, {
      pageAll: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    cache.put(channelRecord('kept'));
    // Cached when the viewer lost it, and no removal reached the cache.
    cache.put(channelRecord('stale'));
    await vi.waitFor(() => expect(directory.channels()).toHaveLength(2));
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(answer).toBeDefined());
    cache.put(channelRecord('stale', { viewedAt: VIEWED_2 }), {
      sourceHash: 'stale-2',
    });
    reopen();
    await vi.waitFor(() => expect(viewedAt(directory, 'stale')).toBe(VIEWED_2));
    answer([directoryChannel('kept')]);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['kept']));
    expect(hydrate).toHaveBeenCalledOnce();

    // The viewer rejoins it while the network's pages are still shown, and
    // the next read is held.
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const read = hydrate.getMockImplementation();
    hydrate.mockImplementationOnce(async (...args) => {
      await held;
      return read!(...args);
    });
    server.push(channelRecord('stale', { name: 'rejoined' }));
    cache.put(channelRecord('stale', { name: 'rejoined' }), {
      sourceHash: 'stale-3',
    });
    reopen();

    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    expect(directory.complete()).toBe(false);
    release();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(
      directory
        .channels()
        .map(({ name }) => name)
        .sort()
    ).toEqual(['channel kept', 'rejoined']);
  });

  it('reads a channel again when the cache shows the viewer rejoined it before a read that found it gone settles', async () => {
    let answer!: (channels: DirectoryChannel[]) => void;
    const server = [channelRecord('kept')];
    const { cache, directory, hydrate, reopen } = mountCachedDirectory(server, {
      pageAll: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    cache.put(channelRecord('kept'));
    // Cached when the viewer lost it, and no removal reached the cache.
    cache.put(channelRecord('stale'));
    await vi.waitFor(() => expect(directory.channels()).toHaveLength(2));
    // The server finds it gone, and its answer is held.
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    hydrate.mockImplementationOnce(async () => {
      await held;
      return { nextCursor: null, entityIds: [] };
    });
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(answer).toBeDefined());
    cache.put(channelRecord('stale', { viewedAt: VIEWED_2 }), {
      sourceHash: 'stale-2',
    });
    reopen();
    await vi.waitFor(() => expect(viewedAt(directory, 'stale')).toBe(VIEWED_2));
    answer([directoryChannel('kept')]);
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledOnce());

    // The viewer rejoins it, and the cache shows that before the answer.
    server.push(channelRecord('stale', { name: 'rejoined' }));
    cache.put(channelRecord('stale', { name: 'rejoined' }), {
      sourceHash: 'stale-3',
    });
    cache.put(channelRecord('kept', { name: 'renamed' }), {
      sourceHash: 'kept-2',
    });
    reopen();
    await vi.waitFor(() =>
      expect(
        directory
          .channels()
          .map(({ name }) => name)
          .sort()
      ).toEqual(['renamed'])
    );
    release();

    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(
      directory
        .channels()
        .map(({ name }) => name)
        .sort()
    ).toEqual(['rejoined', 'renamed']);
  });

  it('leaves out a listed channel deleted after another write left its record without a field', async () => {
    const { cache, directory, reopen } = mountCachedDirectory(
      [channelRecord('kept'), channelRecord('gone')],
      {
        pageAll: async () => [
          directoryChannel('kept'),
          directoryChannel('gone'),
        ],
      }
    );
    cache.put(channelRecord('kept'));
    cache.put(channelRecord('gone'));
    await vi.waitFor(() => expect(directory.channels()).toHaveLength(2));
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    const names = () => directory.channels().map(({ name }) => name);
    expect(names().sort()).toEqual(['channel gone', 'channel kept']);

    // Another query writes it again without a directory field: the network's
    // row stands.
    cache.put(channelRecord('gone'), {
      incomplete: true,
      sourceHash: 'gone-2',
    });
    cache.put(channelRecord('kept', { name: 'renamed' }), {
      sourceHash: 'kept-2',
    });
    reopen();
    await vi.waitFor(() => expect(names()).toContain('renamed'));
    expect(names().sort()).toEqual(['channel gone', 'renamed']);

    // Then the channel is deleted.
    cache.records.delete(`GraphqlSoupChannel:${channelUuid('gone')}`);
    cache.put(channelRecord('kept', { name: 'renamed again' }), {
      sourceHash: 'kept-3',
    });
    reopen();
    await vi.waitFor(() => expect(names()).toContain('renamed again'));
    expect(names()).toEqual(['renamed again']);
    expect(directory.complete()).toBe(true);
  });

  it('waits for a by-id read of a channel first cached without a field after the network walk left it out', async () => {
    let release!: () => void;
    const byIdGate = new Promise<void>((done) => {
      release = done;
    });
    const { cache, directory, reopen, hydrate } = mountCachedDirectory(
      [channelRecord('a'), channelRecord('joined')],
      { byIdGate, pageAll: async () => [directoryChannel('a')] }
    );
    cache.put(channelRecord('a'));
    await vi.waitFor(() => expect(directory.channels()).toHaveLength(1));
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(hydrate).not.toHaveBeenCalled();

    // Joined after the walk read its page, and cached first by a read that
    // lacks a directory field.
    cache.put(channelRecord('joined'), { incomplete: true });
    reopen();
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(1));
    expect(directory.complete()).toBe(false);
    expect(directory.lookup(channelUuid('joined')).status).toBe('pending');

    release();
    await vi.waitFor(() =>
      expect(ids(directory.channels()).sort()).toEqual(['a', 'joined'])
    );
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(directory.lookup(channelUuid('joined')).status).toBe('loaded');
    expect(ids(await directory.readComplete()).sort()).toEqual(['a', 'joined']);
  });

  it.each([
    {
      shape: 'the walk left out',
      listed: false,
      loss: 'its record was removed',
      kept: false,
    },
    {
      shape: 'the walk listed',
      listed: true,
      loss: 'its record was removed',
      kept: false,
    },
    {
      shape: 'the walk left out',
      listed: false,
      loss: 'the cache kept it as a nonmember',
      kept: true,
    },
    {
      shape: 'the walk listed',
      listed: true,
      loss: 'the cache kept it as a nonmember',
      kept: true,
    },
  ])(
    'reads a channel $shape again when it is rejoined without a field after $loss',
    async ({ listed, kept }) => {
      const options: CachedDirectoryOptions = {
        pageAll: async () =>
          listed
            ? [directoryChannel('a'), directoryChannel('x')]
            : [directoryChannel('a')],
      };
      const server = [channelRecord('a'), channelRecord('x')];
      const { cache, directory, reopen, hydrate } = mountCachedDirectory(
        server,
        options
      );
      const names = () =>
        ids(directory.channels())
          .map((id) => channelName(id))
          .sort();
      cache.put(channelRecord('a'));
      if (listed) cache.put(channelRecord('x'));
      await vi.waitFor(() => expect(directory.channels()).not.toHaveLength(0));
      markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
      await vi.waitFor(() => expect(directory.complete()).toBe(true));
      if (!listed) {
        // Joined after the walk read its page: shown once a by-id read
        // returns it.
        cache.put(channelRecord('x'));
        reopen();
      }
      await vi.waitFor(() => expect(names()).toEqual(['a', 'x']));
      await vi.waitFor(() => expect(directory.complete()).toBe(true));
      const readsBefore = hydrate.mock.calls.length;

      // The viewer loses it. A private channel's record is removed; a public
      // or team channel's is updated, and the cache keeps it.
      server[1] = channelRecord('x', { isParticipant: false });
      if (kept) cache.put(server[1], { sourceHash: 'x-left' });
      else cache.records.delete(`GraphqlSoupChannel:${channelUuid('x')}`);
      cache.put(channelRecord('a', { name: 'renamed' }), { sourceHash: 'a-2' });
      reopen();
      await vi.waitFor(() => expect(names()).toEqual(['a']));
      expect(directory.complete()).toBe(true);

      // Then rejoins it, cached first by a read without a directory field.
      let release!: () => void;
      options.byIdGate = new Promise<void>((done) => {
        release = done;
      });
      server[1] = channelRecord('x');
      cache.put(server[1], { incomplete: true, sourceHash: 'x-2' });
      reopen();
      await vi.waitFor(() =>
        expect(hydrate.mock.calls.length).toBeGreaterThan(readsBefore)
      );
      expect(directory.complete()).toBe(false);
      expect(directory.lookup(channelUuid('x')).status).toBe('pending');

      release();
      await vi.waitFor(() => expect(names()).toEqual(['a', 'x']));
      await vi.waitFor(() => expect(directory.complete()).toBe(true));
      expect(directory.lookup(channelUuid('x')).status).toBe('loaded');
      expect(
        ids(await directory.readComplete())
          .map((id) => channelName(id))
          .sort()
      ).toEqual(['a', 'x']);
    }
  );

  it.each([
    { history: 'whole', renamed: false },
    { history: 'whole, then renamed,', renamed: true },
  ])(
    'leaves out a listed channel once a by-id read finds it gone after the cache held it $history and then without a field',
    async ({ renamed }) => {
      const server = [channelRecord('a'), channelRecord('x')];
      const { cache, directory, reopen, hydrate } = mountCachedDirectory(
        server,
        {
          pageAll: async () => [directoryChannel('a'), directoryChannel('x')],
        }
      );
      cache.put(channelRecord('a'));
      cache.put(channelRecord('x'));
      await vi.waitFor(() => expect(directory.channels()).toHaveLength(2));
      markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
      await vi.waitFor(() => expect(directory.complete()).toBe(true));
      expect(hydrate).not.toHaveBeenCalled();
      if (renamed) {
        // A change the cache saw after the walk: its row replaces the walk's.
        server[1] = channelRecord('x', { name: 'renamed' });
        cache.put(server[1], { sourceHash: 'x-renamed' });
        reopen();
        await vi.waitFor(() =>
          expect(directory.channels().map(({ name }) => name)).toContain(
            'renamed'
          )
        );
      }

      // Rewritten without a field, then gone from the server: what the walk
      // or the cache last showed of it no longer holds.
      server.splice(1, 1);
      cache.put(channelRecord('x'), { incomplete: true, sourceHash: 'x-2' });
      reopen();
      await vi.waitFor(() => expect(hydrate).toHaveBeenCalled());
      await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['a']));
      await vi.waitFor(() => expect(directory.complete()).toBe(true));
      await vi.waitFor(() =>
        expect(directory.lookup(channelUuid('x')).status).toBe('missing')
      );
    }
  );

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

    // As the pages listed them until a read says otherwise, and partial
    // until the reads answer.
    await vi.waitFor(() =>
      expect(ids(directory.channels()).sort()).toEqual(['a', 'gone'])
    );
    await new Promise((done) => setTimeout(done, 50));
    expect(directory.complete()).toBe(false);
    // Its lookup answers with the network's row meanwhile, as `channels`
    // shows it.
    expect(directory.lookup(channelUuid('gone'))).toMatchObject({
      status: 'loaded',
      channel: { id: channelUuid('gone') },
    });

    // Deleted after its page was read, while the cache held no record a
    // removal could reach.
    release();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels())).toEqual(['a']);
    expect(directory.lookup(channelUuid('gone')).status).toBe('missing');
    expect(ids(await directory.readComplete())).toEqual(['a']);
  });

  it('settles a read that finds an unlisted channel gone without walking the network rows again', async () => {
    // Counts every read of a network row's id.
    let walked = 0;
    const counted = ({ id, ...rest }: DirectoryChannel) =>
      Object.defineProperty({ ...rest }, 'id', {
        enumerable: true,
        get: () => {
          walked += 1;
          return id;
        },
      }) as DirectoryChannel;
    let answer!: (channels: DirectoryChannel[]) => void;
    let open!: () => void;
    const { cache, directory, hydrate, reopen } = mountCachedDirectory(
      [channelRecord('kept')],
      {
        byIdGate: new Promise<void>((done) => {
          open = done;
        }),
        pageAll: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      }
    );
    cache.put(channelRecord('kept'));
    // Cached when the viewer lost it, and rewritten while the pages are read.
    cache.put(channelRecord('stale'));
    await vi.waitFor(() => expect(directory.channels()).toHaveLength(2));
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(answer).toBeDefined());
    cache.put(channelRecord('stale', { viewedAt: VIEWED_2 }), {
      sourceHash: 'stale-2',
    });
    reopen();
    await vi.waitFor(() => expect(viewedAt(directory, 'stale')).toBe(VIEWED_2));
    answer([counted(directoryChannel('kept'))]);
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledOnce());
    const shown = directory.channels();
    expect(ids(shown)).toEqual(['kept']);
    const reads = cache.host.readRecordsByKeys.mock.calls.length;
    walked = 0;

    // The server finds it gone: no row changes.
    open();

    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(walked).toBe(0);
    expect(cache.host.readRecordsByKeys).toHaveBeenCalledTimes(reads);
    expect(directory.channels()).toBe(shown);
  });

  it('leaves out a channel the network did not list while its by-id reads give no evidence', async () => {
    let answer!: (channels: DirectoryChannel[]) => void;
    const { cache, directory, hydrate, reopen } = mountCachedDirectory([], {
      pageAll: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    // Pages that reached their limit without the channel.
    hydrate.mockImplementation(async () => ({
      nextCursor: 'more',
      entityIds: [],
    }));
    cache.put(channelRecord('kept'));
    // Cached when the viewer lost it, and no removal reached the cache.
    cache.put(channelRecord('stale'));
    await vi.waitFor(() => expect(directory.channels()).toHaveLength(2));
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(answer).toBeDefined());
    // A view stamp rewrites the stale record while the pages are read.
    cache.put(channelRecord('stale', { viewedAt: VIEWED_2 }), {
      sourceHash: 'stale-2',
    });
    reopen();
    await vi.waitFor(() => expect(viewedAt(directory, 'stale')).toBe(VIEWED_2));
    answer([directoryChannel('kept')]);

    // Read once more, then given up on: neither read returned it.
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    await new Promise((done) => setTimeout(done, 50));
    expect(ids(directory.channels())).toEqual(['kept']);
    expect(directory.complete()).toBe(false);
  });

  describe('a confirming read that fails', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('reads again after the cooldown with no cache change, and completes once the network is back', async () => {
      const { directory, hydrate } = mountCachedDirectory(
        [channelRecord('a')],
        {
          pageAll: async () => [
            directoryChannel('a'),
            directoryChannel('gone', { channelType: 'private' }),
          ],
        }
      );
      const read = hydrate.getMockImplementation();
      hydrate.mockImplementation(async () => {
        throw new Error('offline');
      });
      markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(ids(directory.channels()).sort()).toEqual(['a', 'gone']);
      // Read once more, then given up on for now.
      expect(hydrate).toHaveBeenCalledTimes(2);
      expect(directory.complete()).toBe(false);
      expect(directory.failed()).toBe(false);

      // The network is back, and nothing in the cache changes.
      if (read) hydrate.mockImplementation(read);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(hydrate).toHaveBeenCalledTimes(3);
      expect(directory.complete()).toBe(true);
      expect(ids(directory.channels())).toEqual(['a']);
    });

    it('settles a read that changes no row without walking the network rows again', async () => {
      // Counts every read of a network row's id.
      let walked = 0;
      const counted = ({ id, ...rest }: DirectoryChannel) =>
        Object.defineProperty({ ...rest }, 'id', {
          enumerable: true,
          get: () => {
            walked += 1;
            return id;
          },
        }) as DirectoryChannel;
      const { directory, hydrate } = mountCachedDirectory(
        [channelRecord('a')],
        {
          pageAll: async () => [
            counted(directoryChannel('a')),
            counted(directoryChannel('gone', { channelType: 'private' })),
          ],
        }
      );
      hydrate.mockImplementation(async () => {
        throw new Error('offline');
      });
      markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(hydrate).toHaveBeenCalledTimes(2);
      const shown = directory.channels();
      expect(shown).toHaveLength(2);
      walked = 0;

      // Read again and failed again: the rows stay as they are.
      await vi.advanceTimersByTimeAsync(30_000);

      expect(hydrate).toHaveBeenCalledTimes(4);
      expect(walked).toBe(0);
      expect(directory.channels()).toBe(shown);
      expect(directory.complete()).toBe(false);
    });
  });

  describe('a fallback whose pages the cache does not write', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('reads the cache back after waiting ten seconds for the writes', async () => {
      const { directory, hydrate } = mountCachedDirectory(
        [channelRecord('a')],
        {
          written: new Promise(() => {}),
          pageAll: async () => [directoryChannel('a')],
        }
      );
      markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
      await vi.advanceTimersByTimeAsync(9_000);
      expect(directory.channels()).toEqual([]);
      expect(hydrate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);

      expect(hydrate).toHaveBeenCalledOnce();
      expect(ids(directory.channels())).toEqual(['a']);
      expect(directory.complete()).toBe(true);
    });
  });

  it('never calls the rows of a fallback waiting on by-id reads complete as the storage resets', async () => {
    let walks = 0;
    const { directory, hydrate, pageAll, resetStorage } = mountCachedDirectory(
      [channelRecord('a')],
      {
        // The reads that would decide the listed channels never answer.
        byIdGate: new Promise(() => {}),
        pageAll: async (signal) => {
          walks += 1;
          if (walks === 1)
            return [
              directoryChannel('a'),
              directoryChannel('gone', { channelType: 'private' }),
            ];
          return new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason))
          );
        },
      }
    );
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() =>
      expect(ids(directory.channels()).sort()).toEqual(['a', 'gone'])
    );
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalled());
    const seen = recordStates(directory);

    resetStorage('g2');

    await vi.waitFor(() => expect(pageAll).toHaveBeenCalledTimes(2));
    await new Promise((done) => setTimeout(done, 50));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.filter(({ complete }) => complete)).toEqual([]);
    expect(directory.failed()).toBe(false);
  });

  it('pages the network again when the storage resets under the fallback', async () => {
    const { directory, pageAll, resetStorage } = mountCachedDirectory(
      [channelRecord('a')],
      { pageAll: async () => [directoryChannel('a')] }
    );
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(pageAll).toHaveBeenCalledOnce();

    // What the fallback saw of the cache went with the old storage.
    resetStorage('g2');

    await vi.waitFor(() => expect(pageAll).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels())).toEqual(['a']);
  });

  it('pages the network again after a failed fallback once the storage resets', async () => {
    let attempt = 0;
    const { directory, pageAll, resetStorage } = mountCachedDirectory(
      [channelRecord('a')],
      {
        pageAll: async () => {
          attempt += 1;
          if (attempt === 1) throw new Error('offline');
          return [directoryChannel('a')];
        },
      }
    );
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(directory.failed()).toBe(true));

    resetStorage('g2');

    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(directory.failed()).toBe(false);
    expect(pageAll).toHaveBeenCalledTimes(2);
  });

  it('pages the network again when the cache changes hands under the fallback', async () => {
    let walks = 0;
    const { directory, pageAll, reopen, setViewer } = mountCachedDirectory(
      [channelRecord('a')],
      {
        pageAll: async (signal) => {
          walks += 1;
          if (walks === 1) return [directoryChannel('a')];
          // Held, so the test reads what the restart showed.
          return new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason))
          );
        },
      }
    );
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    setViewer('macro|someone-else@example.com');
    reopen();

    await vi.waitFor(() => expect(pageAll).toHaveBeenCalledTimes(2));
    expect(directory.complete()).toBe(false);
  });

  it('reads back what the network walk wrote into the cache before reading any channel by id', async () => {
    let persist!: () => void;
    const written = new Promise<number>((done) => {
      persist = () => done(1);
    });
    const { cache, directory, hydrate } = mountCachedDirectory([], {
      written,
      pageAll: async () => {
        // The cache writes the walk's pages after it answered them.
        setTimeout(() => {
          cache.put(channelRecord('a'));
          cache.put(channelRecord('b'));
          persist();
        });
        return [directoryChannel('a'), directoryChannel('b')];
      },
    });
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');

    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels()).sort()).toEqual(['a', 'b']);
    expect(hydrate).not.toHaveBeenCalled();
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
