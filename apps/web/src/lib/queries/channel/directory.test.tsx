/**
 * @vitest-environment jsdom
 */

import type { CacheChangeListener } from '@graphql-cache/host/types';
import type {
  ChannelDirectoryFieldsFragment,
  ChannelDirectoryPageQuery,
} from '@service-storage/graphql/generated/graphql';
import type {
  GraphqlSoupHydrationPage,
  GraphqlSoupInput,
} from '@service-storage/graphql-soup';
import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { Client } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initialSoupBackfillCheckpoint,
  saveSoupBackfillCheckpoint,
} from '../soup/backfill-checkpoint';
import {
  type ChannelDirectory,
  channelDirectoryState,
  createCachedChannelDirectory,
  createMemoryChannelDirectory,
  fetchJoinedChannels,
  lookupChannel,
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
};

/** Mounts the cached directory over a fake cache whose by-id reads land the
 * named records from `server`. */
function mountCachedDirectory(
  server: ChannelDirectoryFieldsFragment[],
  options: CachedDirectoryOptions = {}
) {
  const cache = fakeChannelCache();
  const listeners: CacheChangeListener[] = [];
  const host = {
    ...cache.host,
    currentStorageGeneration: async () => options.generation ?? 'g1',
    readQuery: vi.fn(async () => ({
      kind: 'hit' as const,
      data: { user: { id: options.viewer ?? VIEWER } },
    })),
    onCacheChanged: (listener: CacheChangeListener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  const hydrate = vi.fn(
    async (input: GraphqlSoupInput): Promise<GraphqlSoupHydrationPage> => {
      const named = namedIds(input) ?? [];
      const found = server.filter(({ id }) => named.includes(id));
      for (const record of found) cache.put(record);
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
  return { cache, directory, hydrate, fetchAll };
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

  it("answers nothing from another viewer's cache", async () => {
    const { cache, directory } = mountCachedDirectory([], {
      viewer: 'macro|someone-else@example.com',
    });
    cache.put(channelRecord('theirs'));
    completeLane('g1');

    await vi.waitFor(() => expect(cache.host.search).not.toHaveBeenCalled());
    expect(directory.channels()).toEqual([]);
    expect(directory.complete()).toBe(false);
  });
});
