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
  type ChannelDirectory,
  channelDirectoryPagesQueryOptions,
  channelDirectoryState,
  createCachedChannelDirectory,
  createMemoryChannelDirectory,
  fetchJoinedChannels,
  lookupChannel,
  refreshChannelDirectory,
  settledChannelLookup,
  staticChannelDirectory,
} from './directory';
import type { DirectoryChannel } from './directory-core';
import { CHANNEL_DIRECTORY_CHECKPOINT_ID } from './directory-lane';
import { directoryChannel } from './tests/directory-channel';
import { channelRecord, fakeChannelCache } from './tests/directory-fixtures';

const VIEWER = 'macro|viewer@example.com';
const PAGE_SIZE = 2;

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

const ids = (channels: readonly DirectoryChannel[]) =>
  channels.map(({ id }) => id);

describe('lookupChannel', () => {
  const joined = directoryChannel('joined');
  const unjoined = directoryChannel('unjoined', { isParticipant: false });

  it('answers a joined record and refuses an unjoined one', () => {
    const state = channelDirectoryState([joined, unjoined], [], false);
    expect(lookupChannel(state, {}, 'joined')).toEqual({
      status: 'loaded',
      channel: joined,
    });
    expect(lookupChannel(state, {}, 'unjoined')).toEqual({
      status: 'missing',
    });
  });

  it('waits on a partial directory unless a by-id read found nothing', () => {
    const state = channelDirectoryState([joined], [], false);
    expect(lookupChannel(state, {}, 'other').status).toBe('pending');
    expect(lookupChannel(state, { other: 'absent' }, 'other').status).toBe(
      'missing'
    );
    expect(lookupChannel(state, { other: 'failed' }, 'other').status).toBe(
      'pending'
    );
  });

  it('waits for a record the complete directory holds without every field', () => {
    const state = channelDirectoryState([joined], ['thin'], true);
    expect(lookupChannel(state, {}, 'thin').status).toBe('pending');
    // Returned but still not in the directory: not a joined channel.
    expect(lookupChannel(state, { thin: 'returned' }, 'thin').status).toBe(
      'missing'
    );
    expect(lookupChannel(state, {}, 'other').status).toBe('missing');
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
    expect(directory.lookup('b').status).toBe('missing');
    setChannels([directoryChannel('a'), directoryChannel('b')]);
    expect(directory.lookup('b').status).toBe('loaded');
    expect(ids(await directory.readComplete())).toEqual(['a', 'b']);
  });
});

/** Mounts the in-memory directory under a query client that never retries. */
function mountMemoryDirectory(network: ReturnType<typeof fakeNetwork>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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

    expect(directory.lookup('c').status).toBe('pending');
    await vi.waitFor(() => expect(directory.lookup('c').status).toBe('loaded'));
    expect(directory.complete()).toBe(false);
    expect(ids(directory.channels())).toEqual(['c']);

    network.release();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels())).toEqual(['a', 'b', 'c', 'd']);
    expect(directory.lookup('zzz').status).toBe('missing');
  });

  it('marks a channel the server does not return as missing before the pages land', async () => {
    const network = fakeNetwork([channelRecord('a')], { holdPages: true });
    const directory = mountMemoryDirectory(network);

    expect(directory.lookup('gone').status).toBe('pending');
    await vi.waitFor(() =>
      expect(directory.lookup('gone').status).toBe('missing')
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
});

type CachedDirectoryOptions = {
  viewer?: string;
  generation?: string;
  fetchAll?: () => Promise<readonly DirectoryChannel[]>;
  /** Ids a by-id read returns without a readable record. */
  unreadable?: readonly string[];
};

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
      const named = namedIds(input) ?? [];
      const found = server.filter(({ id }) => named.includes(id));
      for (const record of found)
        cache.put(record, {
          incomplete: options.unreadable?.includes(record.id),
        });
      return { nextCursor: null, entityIds: found.map(({ id }) => id) };
    }
  );
  const fetchAll = vi.fn(options.fetchAll ?? (async () => []));
  const directory = createRoot((dispose) => {
    disposers.push(dispose);
    return createCachedChannelDirectory({
      host,
      userId: VIEWER,
      hydrate,
      fetchAll,
    });
  });
  return {
    cache,
    host,
    directory,
    hydrate,
    fetchAll,
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
    expect(directory.lookup('left').status).toBe('missing');

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

  it('reads a pending channel by id and answers once its record is cached', async () => {
    const { directory, hydrate } = mountCachedDirectory([
      channelRecord('late', { name: 'Late' }),
    ]);

    expect(directory.lookup('late').status).toBe('pending');
    await vi.waitFor(() =>
      expect(directory.lookup('late')).toMatchObject({
        status: 'loaded',
        channel: { name: 'Late' },
      })
    );
    expect(directory.lookup('never').status).toBe('pending');
    await vi.waitFor(() =>
      expect(directory.lookup('never').status).toBe('missing')
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

    expect(directory.lookup('late').status).toBe('pending');
    await vi.waitFor(() =>
      expect(directory.lookup('late').status).toBe('loaded')
    );

    expect(host.search).toHaveBeenCalledTimes(listings);
    expect(host.readRecordsByKeys).toHaveBeenLastCalledWith(
      expect.objectContaining({ keys: ['GraphqlSoupChannel:late'] })
    );
  });

  it('reads a returned channel again when its record cannot be read', async () => {
    const { directory, hydrate } = mountCachedDirectory(
      [channelRecord('thin')],
      { unreadable: ['thin'] }
    );

    expect(directory.lookup('thin').status).toBe('pending');
    // Read once more, then given up on for a while.
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(2));
    // Neither answered: still waiting, not missing.
    expect(directory.lookup('thin').status).toBe('pending');
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
    const { cache, directory, fetchAll } = mountCachedDirectory([], {
      fetchAll: async () => [directoryChannel('a'), directoryChannel('b')],
    });
    cache.put(channelRecord('a', { name: 'cached a' }));
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['a']));
    expect(directory.complete()).toBe(false);

    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');

    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(fetchAll).toHaveBeenCalledOnce();
    // The cached record follows soup updates, so it wins over the network's.
    expect(directory.channels().map(({ name }) => name)).toEqual([
      'cached a',
      'channel b',
    ]);
    expect(directory.lookup('zzz').status).toBe('missing');
    expect(directory.failed()).toBe(false);
  });

  it('fails when the lane gave up and the network fails too, until retried', async () => {
    let attempt = 0;
    const { directory, fetchAll } = mountCachedDirectory([], {
      fetchAll: async () => {
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
    expect(fetchAll).toHaveBeenCalledTimes(2);
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

describe('refreshChannelDirectory', () => {
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
