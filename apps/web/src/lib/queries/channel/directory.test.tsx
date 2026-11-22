/**
 * @vitest-environment jsdom
 */

import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createCacheSessionExchange } from '@graphql-cache/exchange/session-exchange';
import type {
  CacheChangeListener,
  CacheGenerationChange,
  CacheHost,
} from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import {
  type ChannelDirectoryEntityQuery,
  type ChannelDirectoryFieldsFragment,
  type ChannelDirectoryPageQuery,
  type SoupEntityInput,
  SoupUpdatesDocument,
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
import {
  type Client,
  createClient,
  type Exchange,
  makeResult,
  type Operation,
  type OperationResult,
} from '@urql/core';
import {
  createComputed,
  createRenderEffect,
  createRoot,
  createSignal,
} from 'solid-js';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';
import {
  filter,
  fromPromise,
  make,
  makeSubject,
  map,
  merge,
  mergeMap,
  pipe,
  type Source,
  share,
  subscribe,
  toPromise,
} from 'wonka';
import {
  initialSoupBackfillCheckpoint,
  markSoupBackfillLaneFailed,
  saveSoupBackfillCheckpoint,
} from '../soup/backfill-checkpoint';
import {
  type ByIdOutcome,
  type ChannelDirectory,
  ChannelDirectoryReadUnsettled,
  channelDirectoryPagesQueryOptions,
  channelDirectoryState,
  createByIdReader,
  createCachedChannelDirectory,
  createMemoryChannelDirectory,
  fetchJoinedChannels,
  lookupChannel,
  OWN_WRITE_READ_DEADLINE_MS,
  type PrimaryChannelRead,
  pageJoinedChannels,
  primaryChannelReader,
  refreshChannelDirectory,
  settledChannelLookup,
  staticChannelDirectory,
  walkCurrentJoinedChannels,
} from './directory';
import { type DirectoryChannel, toDirectoryChannel } from './directory-core';
import { CHANNEL_DIRECTORY_CHECKPOINT_ID } from './directory-lane';
import { OWN_WRITE_HOLD_MS, ownChannelWrites } from './own-writes';
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
  /** The channels a read of one channel from the primary sees; the pages'
   * own when left out, so a test can have the pages lag it. */
  primary?: ChannelDirectoryFieldsFragment[];
  /** Reads of one channel to fail before they answer. */
  failingEntityReads?: number;
};

const isEntityInput = (
  input: GraphqlSoupInput | SoupEntityInput
): input is SoupEntityInput => 'entityId' in input;

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

  let entityFailures = options.failingEntityReads ?? 0;
  const entityReads: string[] = [];
  const answerEntity = async ({ entityId }: SoupEntityInput) => {
    entityReads.push(String(entityId));
    if (entityFailures > 0) {
      entityFailures -= 1;
      return { error: new Error('offline') };
    }
    const record = (options.primary ?? channels).find(
      ({ id }) => id === entityId
    );
    return {
      data: {
        __typename: 'Query',
        user: {
          __typename: 'GraphqlUser',
          id: VIEWER,
          soupEntity: record ? structuredClone(record) : null,
        },
      } as unknown as ChannelDirectoryEntityQuery,
    };
  };

  const query = vi.fn(
    (
      _document: unknown,
      variables: { input: GraphqlSoupInput | SoupEntityInput }
    ) => ({
      toPromise: () =>
        isEntityInput(variables.input)
          ? answerEntity(variables.input)
          : answer(variables.input),
    })
  );
  return { client: fakeClient(query), query, inputs, entityReads, release };
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
  type ReaderOptions = Parameters<typeof createByIdReader>[1];
  /** A reader whose ids, requested, read and answered, are test names. */
  function mountReader(read: Read, options?: ReaderOptions) {
    const reader = createRoot((dispose) => {
      disposers.push(dispose);
      return createByIdReader(async (ids, signal) => {
        const found = await read(ids.map(channelName), signal);
        return {
          returned:
            found.returned && new Set([...found.returned].map(channelUuid)),
          unreadable: found.unreadable?.map(channelUuid),
        };
      }, options);
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
      reset: () => reader.reset(),
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

  // Observability rule: work outliving the request keeps its parent across
  // retries, so a slow open shows its failed read and the retry together.
  it('reads in the trace of the view that asked, its retry included', async () => {
    const active: string[] = [];
    const within = <T,>(name: string, work: () => T): T => {
      active.push(name);
      try {
        return work();
      } finally {
        active.pop();
      }
    };
    const spans: {
      parent: string | undefined;
      attrs: Record<string, unknown>;
    }[] = [];
    const span = vi.spyOn(Telemetry, 'span').mockImplementation(((
      name: string,
      operation: (span: unknown) => Promise<unknown>
    ) => {
      const recorded = { parent: active.at(-1), attrs: {} };
      spans.push(recorded);
      return within(name, () =>
        operation({
          setAttr: (key: string, value: unknown) => {
            (recorded.attrs as Record<string, unknown>)[key] = value;
          },
        })
      );
    }) as never);
    onTestFinished(() => span.mockRestore());
    const sentIn: (string | undefined)[] = [];
    let fail = true;
    const read = vi.fn<Read>(async (ids) => {
      sentIn.push(active.at(-1));
      if (fail) {
        fail = false;
        throw new Error('offline');
      }
      return { returned: new Set(ids) };
    });
    const reader = createRoot((dispose) => {
      disposers.push(dispose);
      return createByIdReader(read);
    });
    const view: TraceContext = {
      run: (work) => within('view.channel', work),
    };

    reader.request(channelUuid('a'));
    reader.request(channelUuid('b'), view);
    await vi.advanceTimersByTimeAsync(100);

    // One batch of both, in the view's trace, then its retry there too.
    expect(sentIn).toEqual([
      'channel_directory.by_id',
      'channel_directory.by_id',
    ]);
    expect(spans.map(({ parent }) => parent)).toEqual([
      'view.channel',
      'view.channel',
    ]);
    expect(spans.map(({ attrs }) => attrs)).toEqual([
      expect.objectContaining({
        'channel_directory.requested': 2,
        'channel_directory.retried': 0,
        'channel_directory.queued_ms': expect.any(Number),
      }),
      expect.objectContaining({
        'channel_directory.requested': 2,
        'channel_directory.retried': 2,
        'channel_directory.returned': 2,
      }),
    ]);
    expect(reader.outcomes()).toEqual({
      [channelUuid('a')]: 'returned',
      [channelUuid('b')]: 'returned',
    });

    // Settled, it lets the trace go: a later read nobody traced joins none.
    reader.renew([channelUuid('b')]);
    reader.request(channelUuid('b'));
    await vi.advanceTimersByTimeAsync(100);
    expect(spans).toHaveLength(3);
    expect(spans.at(-1)?.parent).toBeUndefined();
  });

  it('forgets a failed id after the cooldown, while others keep failing, and reads it only when asked again', async () => {
    const read = vi.fn<Read>(async () => {
      throw new Error('offline');
    });
    const onSettle = vi.fn();
    const reader = mountReader(read, { onSettle });
    reader.request('a');
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    expect(reader.outcomes().a).toBe('failed');
    // Asking meanwhile queues nothing.
    expect(reader.request('a')).toBe(false);

    // Another channel fails every ten seconds.
    for (const id of ['b', 'c', 'd']) {
      await vi.advanceTimersByTimeAsync(10_000);
      reader.request(id);
    }
    await vi.advanceTimersByTimeAsync(1_000);

    // Forgotten, its owner told, and not read again unasked.
    expect(reader.outcomes().a).toBeUndefined();
    const settles = onSettle.mock.calls.length;
    expect(settles).toBeGreaterThan(1);
    const readsOfA = () =>
      read.mock.calls.filter(([ids]) => ids.includes('a')).length;
    expect(readsOfA()).toBe(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(readsOfA()).toBe(2);

    // Asked again: two more attempts.
    expect(reader.request('a')).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(readsOfA()).toBe(4);
    expect(reader.outcomes().a).toBe('failed');
  });

  it('keeps failed ids until a hidden tab is shown', async () => {
    const read = vi.fn<Read>(async () => {
      throw new Error('offline');
    });
    const onSettle = vi.fn();
    const reader = mountReader(read, { onSettle });
    reader.request('a');
    await vi.advanceTimersByTimeAsync(100);
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    onSettle.mockClear();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(reader.outcomes().a).toBe('failed');
    expect(reader.request('a')).toBe(false);
    expect(onSettle).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reader.outcomes().a).toBeUndefined();
    expect(onSettle).toHaveBeenCalledOnce();
    expect(reader.request('a')).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(4);
    visibility.mockRestore();
  });

  /** Hands each read a deadline the test aborts, as `BY_ID_DEADLINE_MS`
   * passing would, and a read that hangs: until its signal aborts, or for
   * good when it ignores the signal, as a read waiting on shared work can. */
  function hungReads(heedsAbort = true) {
    const deadlines: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const deadline = new AbortController();
      deadlines.push(deadline);
      return deadline.signal;
    });
    const read = vi.fn<Read>(
      (_ids, signal) =>
        new Promise((_resolve, reject) => {
          if (!heedsAbort) return;
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        })
    );
    return { deadlines, timeout, read };
  }

  const HUNG_READS = [
    ['heeds its signal', true],
    ['ignores its signal', false],
  ] as const;

  it.each(HUNG_READS)(
    'fails a read whose deadline passes, after trying it once more, when it %s',
    async (_kind, heedsAbort) => {
      const { deadlines, timeout, read } = hungReads(heedsAbort);
      try {
        const reader = mountReader(read);
        reader.request('a');
        await vi.advanceTimersByTimeAsync(100);
        expect(timeout).toHaveBeenCalledWith(20_000);
        expect(read).toHaveBeenCalledTimes(1);

        deadlines[0]?.abort();
        await vi.advanceTimersByTimeAsync(100);
        expect(read).toHaveBeenCalledTimes(2);
        expect(reader.outcomes()).toEqual({});

        deadlines[1]?.abort();
        await vi.advanceTimersByTimeAsync(100);
        expect(read).toHaveBeenCalledTimes(2);
        expect(reader.outcomes()).toEqual({ a: 'failed' });
      } finally {
        timeout.mockRestore();
      }
    }
  );

  it.each(HUNG_READS)(
    'frees the slot of a read whose deadline passes when it %s',
    async (_kind, heedsAbort) => {
      const { deadlines, timeout, read } = hungReads(heedsAbort);
      try {
        const reader = mountReader(read);
        for (let i = 0; i < 200; i += 1) reader.request(`c${i}`);
        await vi.advanceTimersByTimeAsync(100);
        reader.request('late');
        await vi.advanceTimersByTimeAsync(100);
        // Both slots hang, so the late batch waits.
        expect(read.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100]);

        deadlines[0]?.abort();
        await vi.advanceTimersByTimeAsync(100);
        expect(read.mock.calls[2]?.[0]).toEqual(['late']);
      } finally {
        timeout.mockRestore();
      }
    }
  );

  it('settles nothing for a read a reset aborts', async () => {
    const { timeout, read } = hungReads();
    try {
      const reader = mountReader(read);
      reader.request('a');
      await vi.advanceTimersByTimeAsync(100);
      expect(read).toHaveBeenCalledTimes(1);

      reader.reset();
      await vi.advanceTimersByTimeAsync(100);
      expect(read).toHaveBeenCalledTimes(1);
      expect(reader.outcomes()).toEqual({});
      expect(reader.request('a')).toBe(true);
    } finally {
      timeout.mockRestore();
    }
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
          session: ACCOUNT.session,
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

  it('reads the network for a full read, even while its pages are fresh', async () => {
    const network = changingNetwork(
      [channelRecord('a')],
      [channelRecord('a'), channelRecord('b')]
    );
    network.release();
    const directory = mountMemoryDirectory(network);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels())).toEqual(['a']);

    // 'b' was joined on another device since the pages were read.
    expect(ids(await directory.readComplete())).toEqual(['a', 'b']);
  });

  it("stops paging a full read once its signal aborts, leaving the directory's pages alone", async () => {
    const network = fakeNetwork(
      ['a', 'b', 'c', 'd', 'e'].map((name) => channelRecord(name)),
      { holdPages: true }
    );
    const directory = mountMemoryDirectory(network);
    // The directory's own pages: the first of three, held.
    await vi.waitFor(() => expect(network.inputs).toHaveLength(1));

    const controller = new AbortController();
    const read = directory.readComplete(controller.signal);
    await vi.waitFor(() => expect(network.inputs).toHaveLength(2));
    controller.abort();
    network.release();

    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    // The directory read its three pages; the aborted read stopped after
    // its first.
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels())).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(network.inputs).toHaveLength(4);
  });

  it('reads pages restored from an earlier page again, and only then has their views current', async () => {
    const network = fakeNetwork([channelRecord('a', { viewedAt: VIEWED_2 })]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Restored from a page that read them a minute before this one loaded:
    // still fresh, and older than the view made elsewhere since.
    queryClient.setQueryData(
      channelDirectoryPagesQueryOptions(VIEWER, () => network.client).queryKey,
      [directoryChannel('a', { viewedAt: VIEWED_0 })],
      { updatedAt: performance.timeOrigin - 60_000 }
    );
    const directory = mountMemoryDirectory(network, queryClient);
    expect(viewedAt(directory, 'a')).toBe(VIEWED_0);
    expect(directory.viewsCurrent()).toBe(false);

    await vi.waitFor(() => expect(viewedAt(directory, 'a')).toBe(VIEWED_2));
    expect(directory.viewsCurrent()).toBe(true);
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
  fetchAll?: (signal?: AbortSignal) => Promise<readonly DirectoryChannel[]>;
  /** One channel as the primary shows it; as the last walk listed it when
   * left out, so the primary agrees with the walk. */
  readFromPrimary?: (
    channelId: string,
    signal?: AbortSignal
  ) => Promise<PrimaryChannelRead>;
  /** How many channel writes of the viewer the directory has seen. */
  writesSeen?: () => number;
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
  /** The client whose own writes the directory shows. */
  queryClient?: QueryClient;
  /** Deletes channels the primary no longer shows the viewer; from the
   * fake cache, which is then read again, when left out. */
  removeUnreadable?: (
    ids: readonly string[],
    generation: string,
    signal: AbortSignal
  ) => Promise<unknown>;
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
  let lastWalked: readonly DirectoryChannel[] = [];
  const walk = options.fetchAll ?? (async () => []);
  const fetchAll = vi.fn<
    (signal?: AbortSignal) => Promise<readonly DirectoryChannel[]>
  >(async (signal) => {
    lastWalked = await walk(signal);
    return lastWalked;
  });
  const readFromPrimary = vi.fn<
    (channelId: string, signal?: AbortSignal) => Promise<PrimaryChannelRead>
  >(
    options.readFromPrimary ??
      (async (channelId) => {
        // The primary shows what a by-id read would land, else what the
        // last walk listed.
        const record = server.find(({ id }) => id === channelId);
        return {
          kind: 'read',
          channel: record
            ? toDirectoryChannel(record)
            : (lastWalked.find(({ id }) => id === channelId) ?? null),
        };
      })
  );
  const pageAll = vi.fn<
    (signal: AbortSignal) => Promise<readonly DirectoryChannel[]>
  >(options.pageAll ?? (async () => []));
  const stampView = vi.fn((channelId: string, viewedAt: string) =>
    stampCachedChannelView(host, channelId, viewedAt, CACHE_SESSION)
  );
  const removeUnreadable = vi.fn(
    options.removeUnreadable ??
      (async (ids: readonly string[]) => {
        for (const id of ids) cache.records.delete(`GraphqlSoupChannel:${id}`);
        for (const listener of [...generationListeners])
          listener({ storage: 'preserved' } as CacheGenerationChange);
      })
  );
  const directory = createRoot((dispose) => {
    disposers.push(dispose);
    return createCachedChannelDirectory({
      host,
      userId: VIEWER,
      session: ACCOUNT.session,
      hydrate,
      fetchAll,
      readFromPrimary,
      writesSeen: options.writesSeen,
      removeUnreadable,
      pageAll: async (signal) => ({
        channels: await pageAll(signal),
        pages: 1,
        written: options.written ?? Promise.resolve(1),
      }),
      stampView,
      ownWrites: ownChannelWrites(options.queryClient ?? new QueryClient()),
      sessionStartedAt: options.sessionStartedAt,
    });
  });
  return {
    cache,
    host,
    directory,
    hydrate,
    fetchAll,
    readFromPrimary,
    pageAll,
    stampView,
    removeUnreadable,
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

  it('reads an incomplete record again once its failed reads are forgotten, with nobody looking it up', async () => {
    vi.useFakeTimers();
    try {
      const { cache, directory, hydrate } = mountCachedDirectory([
        channelRecord('thin'),
      ]);
      const read = hydrate.getMockImplementation();
      hydrate.mockImplementation(async () => {
        throw new Error('offline');
      });
      cache.put(channelRecord('thin'), { incomplete: true });
      completeLane('g1');
      await vi.advanceTimersByTimeAsync(1_000);
      // Read once more, then given up on for now.
      expect(hydrate).toHaveBeenCalledTimes(2);
      expect(directory.complete()).toBe(false);

      if (read) hydrate.mockImplementation(read);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(hydrate).toHaveBeenCalledTimes(3);
      expect(directory.complete()).toBe(true);
      expect(ids(directory.channels())).toEqual(['thin']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails while a read it waits on to complete failed, and reads it again at once on retry', async () => {
    vi.useFakeTimers();
    try {
      const { cache, directory, hydrate } = mountCachedDirectory([
        channelRecord('thin'),
      ]);
      const read = hydrate.getMockImplementation();
      hydrate.mockImplementation(async () => {
        throw new Error('offline');
      });
      cache.put(channelRecord('a'));
      cache.put(channelRecord('thin'), { incomplete: true });
      completeLane('g1');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(hydrate).toHaveBeenCalledTimes(2);
      // Not loading for good: the reader can offer to try again.
      expect(directory.complete()).toBe(false);
      expect(directory.failed()).toBe(true);

      if (read) hydrate.mockImplementation(read);
      directory.retry();
      expect(directory.failed()).toBe(false);
      await vi.advanceTimersByTimeAsync(100);

      expect(hydrate).toHaveBeenCalledTimes(3);
      expect(directory.complete()).toBe(true);
      expect(directory.failed()).toBe(false);
      expect(ids(directory.channels()).sort()).toEqual(['a', 'thin']);
    } finally {
      vi.useRealTimers();
    }
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

  it('reads every channel from the network, even once the directory is complete', async () => {
    // 'b' was joined on another device, and its update has not reached
    // this cache yet.
    const network = [directoryChannel('a'), directoryChannel('b')];
    const { cache, directory, fetchAll } = mountCachedDirectory([], {
      fetchAll: async () => network,
    });

    expect(ids(await directory.readComplete())).toEqual(['a', 'b']);
    expect(fetchAll).toHaveBeenCalledOnce();

    cache.put(channelRecord('a'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(ids(directory.channels())).toEqual(['a']);
    expect(ids(await directory.readComplete())).toEqual(['a', 'b']);
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it('settles a join the cache holds and the replica walk missed on the primary', async () => {
    // 'b' and 'c' are joined in the cache; the walk, of a replica, lags both.
    const { cache, directory, readFromPrimary } = mountCachedDirectory([], {
      fetchAll: async () => [directoryChannel('a')],
      readFromPrimary: async (id) => ({
        kind: 'read',
        // The primary has 'b' joined, and 'c' left since the cache saw it.
        channel:
          id === channelUuid('b')
            ? directoryChannel('b', { name: 'b on the primary' })
            : null,
      }),
    });
    cache.put(channelRecord('a'));
    cache.put(channelRecord('b'));
    cache.put(channelRecord('c'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    const channels = await directory.readComplete();
    expect(ids(channels)).toEqual(['a', 'b']);
    expect(channels.find(({ id }) => id === channelUuid('b'))?.name).toBe(
      'b on the primary'
    );
    expect(
      readFromPrimary.mock.calls.map(([id]) => channelName(id)).sort()
    ).toEqual(['b', 'c']);
  });

  it('drops a channel the replica walk still lists once the primary shows it left', async () => {
    const { cache, directory, readFromPrimary } = mountCachedDirectory([], {
      fetchAll: async () => [
        directoryChannel('a'),
        directoryChannel('left'),
        directoryChannel('removed'),
      ],
      readFromPrimary: async (id) => ({
        kind: 'read',
        channel:
          id === channelUuid('left')
            ? directoryChannel('left', { isParticipant: false })
            : null,
      }),
    });
    cache.put(channelRecord('a'));
    // Left on another device, as the cache already shows.
    cache.put(channelRecord('left', { isParticipant: false }));
    // 'removed' was deleted: the cache no longer holds it at all.
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    expect(ids(await directory.readComplete())).toEqual(['a']);
    expect(
      readFromPrimary.mock.calls.map(([id]) => channelName(id)).sort()
    ).toEqual(['left', 'removed']);
  });

  it('reads nothing on the primary when the walk and the cache agree, and fails when a read of a disagreement fails', async () => {
    let walked = [directoryChannel('a'), directoryChannel('b')];
    const { cache, directory, readFromPrimary } = mountCachedDirectory([], {
      fetchAll: async () => walked,
      readFromPrimary: async () => ({ kind: 'failed' }),
    });
    cache.put(channelRecord('a'));
    cache.put(channelRecord('b'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    expect(ids(await directory.readComplete())).toEqual(['a', 'b']);
    expect(readFromPrimary).not.toHaveBeenCalled();

    walked = [directoryChannel('a')];
    // The primary read of 'b' fails: neither the walk nor the cache is
    // known to be current, so the read fails rather than act on either.
    await expect(directory.readComplete()).rejects.toMatchObject({
      reason: 'primary_failed',
    });
    expect(readFromPrimary).toHaveBeenCalledOnce();
  });

  it('fails without reading the primary when there are more than 200 disagreements', async () => {
    const walked = Array.from({ length: 205 }, (_, index) =>
      directoryChannel(`walked${index}`)
    );
    const { cache, directory, readFromPrimary } = mountCachedDirectory([], {
      fetchAll: async () => [directoryChannel('a'), ...walked],
    });
    cache.put(channelRecord('a'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    const read = directory.readComplete();
    await expect(read).rejects.toBeInstanceOf(ChannelDirectoryReadUnsettled);
    await expect(read).rejects.toMatchObject({ reason: 'too_many_disputes' });
    expect(readFromPrimary).not.toHaveBeenCalled();
  });

  it('settles a channel the walk wrote over the cache, comparing the cache as it was before the walk', async () => {
    // The cache shows 'b' left; the replica walk still lists it joined and
    // writes that stale page into the cache as it goes, which the directory
    // shows before the walk ends.
    const { cache, directory, readFromPrimary, reopen } = mountCachedDirectory(
      [],
      {
        fetchAll: async () => {
          cache.put(channelRecord('b'), { sourceHash: 'b-walked' });
          reopen();
          await vi.waitFor(() =>
            expect(ids(directory.channels())).toContain('b')
          );
          return [directoryChannel('a'), directoryChannel('b')];
        },
        readFromPrimary: async () => ({ kind: 'read', channel: null }),
      }
    );
    cache.put(channelRecord('a'));
    cache.put(channelRecord('b', { isParticipant: false }));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    expect(ids(await directory.readComplete())).toEqual(['a']);
    expect(readFromPrimary.mock.calls.map(([id]) => channelName(id))).toEqual([
      'b',
    ]);
  });

  it('walks again when the viewer wrote a channel while the primary was being read', async () => {
    let writes = 0;
    let walks = 0;
    const { cache, directory, fetchAll } = mountCachedDirectory([], {
      writesSeen: () => writes,
      fetchAll: async () => {
        walks += 1;
        // The second walk sees the channel the viewer joined meanwhile.
        return walks === 1
          ? [directoryChannel('a')]
          : [directoryChannel('a'), directoryChannel('joined')];
      },
      readFromPrimary: async (id) => {
        // The viewer joins a channel while 'b' is read.
        if (walks === 1) writes += 1;
        return {
          kind: 'read',
          channel: id === channelUuid('b') ? null : directoryChannel('joined'),
        };
      },
    });
    cache.put(channelRecord('a'));
    cache.put(channelRecord('b'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    expect(ids(await directory.readComplete())).toEqual(['a', 'joined']);
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it('reads every batch of disagreements on the primary inside the settle span', async () => {
    const active: string[] = [];
    const within = <T,>(name: string, work: () => T): T => {
      active.push(name);
      try {
        return work();
      } finally {
        active.pop();
      }
    };
    const span = vi.spyOn(Telemetry, 'span').mockImplementation(((
      name: string,
      operation: (span: unknown) => Promise<unknown>
    ) =>
      within(name, () =>
        operation({
          setAttr: () => {},
          run: <T,>(work: () => T) => within(name, work),
        })
      )) as never);
    onTestFinished(() => span.mockRestore());
    const sentIn: (string | undefined)[] = [];
    const { cache, directory } = mountCachedDirectory([], {
      fetchAll: async () =>
        Array.from({ length: 8 }, (_, index) =>
          directoryChannel(`walked${index}`)
        ),
      readFromPrimary: async () => {
        sentIn.push(active.at(-1));
        return { kind: 'read', channel: null };
      },
    });
    cache.put(channelRecord('a'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    await expect(directory.readComplete()).resolves.toEqual([]);
    // Eight the walk lists and 'a' it misses: batches of four, four and
    // one, each after the first past an await.
    expect(sentIn).toEqual(
      Array.from({ length: 9 }, () => 'channel_directory.full_read_settle')
    );
  });

  it('passes its signal to the walk and reads nothing more on the primary once it aborts', async () => {
    const reads: (() => void)[] = [];
    const { cache, directory, fetchAll, readFromPrimary } =
      mountCachedDirectory([], {
        fetchAll: async () =>
          Array.from({ length: 8 }, (_, index) =>
            directoryChannel(`walked${index}`)
          ),
        readFromPrimary: (id) =>
          new Promise((done) => {
            reads.push(() =>
              done({ kind: 'read', channel: directoryChannel(channelName(id)) })
            );
          }),
      });
    cache.put(channelRecord('a'));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    const controller = new AbortController();
    const read = directory.readComplete(controller.signal);
    await vi.waitFor(() => expect(reads).toHaveLength(4));
    expect(fetchAll).toHaveBeenCalledExactlyOnceWith(controller.signal);

    controller.abort();
    for (const finish of reads) finish();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    // One batch of four; none after the abort.
    expect(readFromPrimary).toHaveBeenCalledTimes(4);
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

    it('shows the network pages when reading the cache back never answers, and reads again past its deadline', async () => {
      // The read's deadline aborts when the test says, as `SCAN_DEADLINE_MS`
      // passing would.
      const realTimeout = AbortSignal.timeout.bind(AbortSignal);
      const scanDeadlines: AbortController[] = [];
      const timeout = vi
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation((ms) => {
          if (ms !== 60_000) return realTimeout(ms);
          const deadline = new AbortController();
          scanDeadlines.push(deadline);
          return deadline.signal;
        });
      try {
        const { cache, directory, host, pageAll, reopen } =
          mountCachedDirectory([channelRecord('c')], {
            pageAll: async () => [directoryChannel('a'), directoryChannel('b')],
          });
        cache.put(channelRecord('a'));
        await vi.advanceTimersByTimeAsync(1_000);
        expect(ids(directory.channels())).toEqual(['a']);
        // The next listing never answers, and the lane saves nothing.
        host.search.mockImplementationOnce(() => new Promise(() => {}));
        await vi.advanceTimersByTimeAsync(29_000);
        expect(pageAll).toHaveBeenCalledOnce();
        expect(ids(directory.channels())).toEqual(['a']);

        await vi.advanceTimersByTimeAsync(60_000);

        // The network's pages stand alone rather than the directory pending.
        expect(ids(directory.channels())).toEqual(['a', 'b']);

        // A read asked for meanwhile, and the by-id read of a join the pages
        // did not list, wait on the one that never answered until its
        // deadline lets it go.
        cache.put(channelRecord('c'));
        reopen();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(ids(directory.channels())).not.toContain('c');
        expect(scanDeadlines.length).toBeGreaterThan(0);
        for (const deadline of scanDeadlines) deadline.abort();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(ids(directory.channels())).toContain('c');
      } finally {
        timeout.mockRestore();
      }
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
    expect(ids(directory.channels())).toEqual(['kept']);
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

  it('answers missing, without reading it again, for a channel lacking a field that the fallback found gone', async () => {
    let answer!: (channels: DirectoryChannel[]) => void;
    const { cache, directory, hydrate } = mountCachedDirectory(
      [channelRecord('kept')],
      {
        pageAll: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      }
    );
    cache.put(channelRecord('kept'));
    // Cached without every field when the viewer lost it.
    cache.put(channelRecord('lost'), { incomplete: true });
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['kept']));
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer([directoryChannel('kept')]);

    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(hydrate).toHaveBeenCalledOnce();
    expect(directory.lookup(channelUuid('lost')).status).toBe('missing');
    await new Promise((done) => setTimeout(done, 50));
    expect(hydrate).toHaveBeenCalledOnce();
  });

  it('fails while the fallback cannot confirm a channel, and confirms it again at once on retry', async () => {
    let answer!: (channels: DirectoryChannel[]) => void;
    const { cache, directory, hydrate } = mountCachedDirectory(
      [channelRecord('kept')],
      {
        pageAll: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      }
    );
    const read = hydrate.getMockImplementation();
    hydrate.mockImplementation(async () => {
      throw new Error('offline');
    });
    cache.put(channelRecord('kept'));
    cache.put(channelRecord('lost'), { incomplete: true });
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['kept']));
    markSoupBackfillLaneFailed(VIEWER, CHANNEL_DIRECTORY_CHECKPOINT_ID, 'g1');
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer([directoryChannel('kept')]);

    await vi.waitFor(() => expect(directory.failed()).toBe(true));
    expect(hydrate).toHaveBeenCalledTimes(2);
    expect(directory.complete()).toBe(false);

    if (read) hydrate.mockImplementation(read);
    directory.retry();
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    expect(directory.failed()).toBe(false);
    expect(hydrate).toHaveBeenCalledTimes(3);
    expect(directory.lookup(channelUuid('lost')).status).toBe('missing');
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
    expect(ids(directory.channels()).sort()).toEqual(['a', 'joined']);
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
        ids(directory.channels())
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
      // Read once more, then given up on for now: failed, so a reader can
      // offer to try again.
      expect(hydrate).toHaveBeenCalledTimes(2);
      expect(directory.complete()).toBe(false);
      expect(directory.failed()).toBe(true);

      // The network is back, and nothing in the cache changes.
      if (read) hydrate.mockImplementation(read);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(hydrate).toHaveBeenCalledTimes(3);
      expect(directory.failed()).toBe(false);
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
    const { cache, cachedViewedAt, directory } = mountCachedDirectory([], {
      // The network has yet to show the view.
      fetchAll: async () => [directoryChannel('a', { viewedAt: VIEWED_0 })],
    });
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

  describe('a channel that comes back joined after the viewer left it', () => {
    const key = (name: string) => `GraphqlSoupChannel:${channelUuid(name)}`;
    const leaveBy = {
      deletion: (cache: ReturnType<typeof fakeChannelCache>) =>
        cache.records.delete(key('gone')),
      'a record that shows them out': (
        cache: ReturnType<typeof fakeChannelCache>
      ) =>
        cache.put(channelRecord('gone', { isParticipant: false }), {
          sourceHash: 'gone-left',
        }),
    };

    /** Mounts a complete directory of `kept` and `gone`, then shows the
     * viewer leaving `gone`. */
    async function leftGone(
      how: keyof typeof leaveBy,
      options: CachedDirectoryOptions = {}
    ) {
      const mounted = mountCachedDirectory([], options);
      mounted.cache.put(channelRecord('kept'));
      mounted.cache.put(channelRecord('gone'));
      completeLane('g1');
      await vi.waitFor(() => expect(mounted.directory.complete()).toBe(true));
      expect(ids(mounted.directory.channels()).sort()).toEqual([
        'gone',
        'kept',
      ]);
      leaveBy[how](mounted.cache);
      mounted.reopen();
      await vi.waitFor(() =>
        expect(ids(mounted.directory.channels())).toEqual(['kept'])
      );
      return mounted;
    }

    it.each(Object.keys(leaveBy) as (keyof typeof leaveBy)[])(
      'stays hidden after a leave by %s until the primary says the viewer can no longer read it, then is deleted',
      async (how) => {
        let answer!: (read: PrimaryChannelRead) => void;
        const { cache, directory, reopen, readFromPrimary, removeUnreadable } =
          await leftGone(how, {
            readFromPrimary: () =>
              new Promise((resolve) => {
                answer = resolve;
              }),
          });
        const seen = recordStates(directory);

        // A read sent before the leave lands its older answer.
        cache.put(channelRecord('gone'), { sourceHash: 'gone-stale' });
        reopen();
        await vi.waitFor(() =>
          expect(readFromPrimary).toHaveBeenCalledWith(
            channelUuid('gone'),
            expect.any(AbortSignal)
          )
        );
        expect(ids(directory.channels())).toEqual(['kept']);
        expect(directory.lookup(channelUuid('gone')).status).toBe('pending');
        // The directory may not call itself complete while it hides one.
        expect(directory.complete()).toBe(false);

        answer({ kind: 'read', channel: null });
        await vi.waitFor(() =>
          expect(removeUnreadable).toHaveBeenCalledWith(
            [channelUuid('gone')],
            'g1',
            expect.any(AbortSignal)
          )
        );
        await vi.waitFor(() =>
          expect(directory.lookup(channelUuid('gone')).status).toBe('missing')
        );
        expect(cache.records.has(key('gone'))).toBe(false);
        expect(directory.complete()).toBe(true);
        expect(seen.every((state) => !state.ids.includes('gone'))).toBe(true);
      }
    );

    it('stays hidden, and complete, while the primary shows the viewer out of it', async () => {
      const { cache, directory, reopen, readFromPrimary, removeUnreadable } =
        await leftGone('deletion', {
          readFromPrimary: async () => ({
            kind: 'read',
            channel: directoryChannel('gone', { isParticipant: false }),
          }),
        });
      cache.put(channelRecord('gone'), { sourceHash: 'gone-stale' });
      reopen();
      await vi.waitFor(() => expect(readFromPrimary).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(directory.complete()).toBe(true));
      expect(ids(directory.channels())).toEqual(['kept']);
      expect(directory.lookup(channelUuid('gone')).status).toBe('missing');
      expect(removeUnreadable).not.toHaveBeenCalled();
    });

    it('shows it once the primary shows the viewer back in, and forgets the leave', async () => {
      const { cache, directory, reopen, readFromPrimary } = await leftGone(
        'deletion',
        {
          readFromPrimary: async (channelId) => ({
            kind: 'read',
            channel: directoryChannel(channelName(channelId)),
          }),
        }
      );
      cache.put(channelRecord('gone'), { sourceHash: 'gone-rejoined' });
      reopen();
      await vi.waitFor(() =>
        expect(ids(directory.channels()).sort()).toEqual(['gone', 'kept'])
      );
      expect(readFromPrimary).toHaveBeenCalledOnce();
      expect(directory.complete()).toBe(true);

      // A reload reads it from the cache alone.
      for (const dispose of disposers.splice(0)) dispose();
      const reloaded = mountCachedDirectory([]);
      reloaded.cache.put(channelRecord('kept'));
      reloaded.cache.put(channelRecord('gone'));
      await vi.waitFor(() => expect(reloaded.directory.complete()).toBe(true));
      expect(ids(reloaded.directory.channels()).sort()).toEqual([
        'gone',
        'kept',
      ]);
      expect(reloaded.readFromPrimary).not.toHaveBeenCalled();
    });

    it('still hides it after a reload that finds the stale record cached', async () => {
      await leftGone('deletion');
      for (const dispose of disposers.splice(0)) dispose();

      let answer!: (read: PrimaryChannelRead) => void;
      const reloaded = mountCachedDirectory([], {
        readFromPrimary: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      });
      const seen = recordStates(reloaded.directory);
      reloaded.cache.put(channelRecord('kept'));
      reloaded.cache.put(channelRecord('gone'), { sourceHash: 'gone-stale' });
      reloaded.reopen();
      await vi.waitFor(() =>
        expect(reloaded.readFromPrimary).toHaveBeenCalledWith(
          channelUuid('gone'),
          expect.any(AbortSignal)
        )
      );
      await vi.waitFor(() =>
        expect(ids(reloaded.directory.channels())).toEqual(['kept'])
      );
      answer({ kind: 'read', channel: null });
      await vi.waitFor(() =>
        expect(reloaded.removeUnreadable).toHaveBeenCalledOnce()
      );
      await vi.waitFor(() => expect(reloaded.directory.complete()).toBe(true));
      expect(seen.every((state) => !state.ids.includes('gone'))).toBe(true);
    });

    it('shows it as the cache has it when the primary read fails', async () => {
      const { cache, directory, reopen, readFromPrimary } = await leftGone(
        'deletion',
        { readFromPrimary: async () => ({ kind: 'failed' }) }
      );
      cache.put(channelRecord('gone'), { sourceHash: 'gone-stale' });
      reopen();
      await vi.waitFor(() =>
        expect(ids(directory.channels()).sort()).toEqual(['gone', 'kept'])
      );
      expect(readFromPrimary).toHaveBeenCalledOnce();
      expect(directory.complete()).toBe(true);
    });

    it('reads it again when the cache rewrites it, and shows it past three reads', async () => {
      const { cache, directory, reopen, readFromPrimary } = await leftGone(
        'deletion',
        {
          readFromPrimary: async () => ({
            kind: 'read',
            channel: directoryChannel('gone', { isParticipant: false }),
          }),
        }
      );
      for (let write = 1; write <= 3; write += 1) {
        cache.put(channelRecord('gone', { name: `stale ${write}` }), {
          sourceHash: `gone-stale-${write}`,
        });
        reopen();
        await vi.waitFor(() =>
          expect(readFromPrimary).toHaveBeenCalledTimes(write)
        );
        await vi.waitFor(() => expect(directory.complete()).toBe(true));
        expect(ids(directory.channels())).toEqual(['kept']);
      }
      cache.put(channelRecord('gone', { name: 'stale 4' }), {
        sourceHash: 'gone-stale-4',
      });
      reopen();
      await vi.waitFor(() =>
        expect(ids(directory.channels()).sort()).toEqual(['gone', 'kept'])
      );
      expect(readFromPrimary).toHaveBeenCalledTimes(3);
    });
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
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    let walks = 0;
    // The directory's own pages, then the full read's walk, held: it misses
    // the write that lands during it, and every walk after sees it.
    const client = fakeClient(() => ({
      toPromise: async () => {
        walks += 1;
        if (walks === 1) return page([channelRecord('a')], null);
        if (walks === 2) {
          await held;
          return page([channelRecord('a')], null);
        }
        return page([channelRecord('a'), channelRecord('b')], null);
      },
    }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const directory = mountMemoryDirectory({ client }, queryClient);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    const complete = directory.readComplete();
    await vi.waitFor(() => expect(walks).toBe(2));

    const refreshed = refreshChannelDirectory([], { client: queryClient });
    release();
    await refreshed;

    expect(ids(await complete)).toEqual(['a', 'b']);
  });

  it('walks again when a write lands during a full walk', async () => {
    const network = changingNetwork(
      [channelRecord('a')],
      [channelRecord('a'), channelRecord('b')]
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    disposers.push(() => queryClient.clear());
    const read = walkCurrentJoinedChannels(queryClient, network.client);
    await vi.waitFor(() => expect(network.walks()).toBe(1));

    const refreshed = refreshChannelDirectory([], { client: queryClient });
    network.release();
    await refreshed;

    expect(ids(await read)).toEqual(['a', 'b']);
    expect(network.walks()).toBe(2);
    // A later read reads the network again: another device may have changed
    // the membership since.
    expect(
      ids(await walkCurrentJoinedChannels(queryClient, network.client))
    ).toEqual(['a', 'b']);
    expect(network.walks()).toBe(3);
  });

  it('walks until no write landed during the walk', async () => {
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
    const read = walkCurrentJoinedChannels(queryClient, client);

    // A write lands during each of the first three reads.
    for (let walk = 1; walk <= 3; walk += 1) {
      await vi.waitFor(() => expect(walks).toBe(walk));
      const refreshed = refreshChannelDirectory([], { client: queryClient });
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

    const refreshed = refreshChannelDirectory([], { client: queryClient });
    network.release();
    await refreshed;

    // The first walk, then one that started after the change.
    expect(network.inputs).toHaveLength(2);
    expect(queryClient.getQueryState(options.queryKey)?.isInvalidated).toBe(
      false
    );
  });
});

const ACCOUNT = { userId: VIEWER, session: 1 };

/** The name a lookup shows, or its status when it found nothing. */
function nameOf(directory: ChannelDirectory, name: string) {
  const lookup = directory.lookup(channelUuid(name));
  return lookup.status === 'loaded' ? lookup.channel.name : lookup.status;
}

/** The viewer's write of the `changed` channels, read back from the
 * primary that `network` stands for. */
function writeOf(
  queryClient: QueryClient,
  network: Pick<ReturnType<typeof fakeNetwork>, 'client'>,
  changed: string[],
  account: () => { userId: string; session: number } = () => ACCOUNT
) {
  return refreshChannelDirectory(changed.map(channelUuid), {
    client: queryClient,
    soup: () => network.client,
    account,
  });
}

/** `network`, its answers held until `land` is called. */
function heldNetwork(network: Pick<ReturnType<typeof fakeNetwork>, 'client'>) {
  let land!: () => void;
  const landed = new Promise<void>((done) => {
    land = done;
  });
  return {
    land,
    client: fakeClient((...args: Parameters<typeof network.client.query>) => ({
      toPromise: async () => {
        await landed;
        return network.client.query(...args).toPromise();
      },
    })) as typeof network.client,
  };
}

/**
 * The app's soup client over `cache`, wired as production wires it: the
 * real cache exchange writes each read's answer into the records the
 * directory reads, and a soup update's deletion takes one out. The server
 * answers a read of one channel with what `primary` shows when the read is
 * sent, and holds every answer until `land` while `holding` is set. Soup
 * updates arrive through `push`.
 */
function writeThroughSoup(
  cache: ReturnType<typeof fakeChannelCache>,
  primary: () => ChannelDirectoryFieldsFragment | null
) {
  let written = 0;
  const host = {
    clientId: 'directory-test',
    onOpsAffected: () => () => {},
    onCacheGenerationChanged: () => () => {},
    onMutationSettled: () => () => {},
    claimNextMutation: async () => undefined,
    readQuery: async () => ({ kind: 'miss' as const }),
    writeQuery: async ({ data }: { data: unknown }) => {
      const visit = (value: unknown) => {
        if (typeof value !== 'object' || value === null) return;
        if (
          '__typename' in value &&
          value.__typename === 'GraphqlSoupChannel'
        ) {
          written += 1;
          cache.put(structuredClone(value) as ChannelDirectoryFieldsFragment, {
            sourceHash: `network-${written}`,
          });
          return;
        }
        for (const child of Object.values(value)) visit(child);
      };
      visit(data);
      return {
        revision: INITIAL_CACHE_REVISION,
        revisionAdvanced: true,
        affectedOps: [],
        changed: [],
        reset: false,
      };
    },
    deleteRecords: async (keys: string[]) => {
      for (const key of keys) cache.records.delete(key);
      return { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    },
    teardown: async () => {},
  };
  const updates = makeSubject<OperationResult>();
  const sent: Operation[] = [];
  let holding: Promise<void> | undefined;
  let land = () => {};
  const transport: Exchange =
    () =>
    (operations): Source<OperationResult> => {
      const shared = share(operations);
      return merge([
        pipe(
          shared,
          filter((operation) => operation.kind === 'query'),
          mergeMap((operation) => {
            sent.push(operation);
            const answer = primary();
            const held = holding;
            return fromPromise(
              (async () => {
                await held;
                return makeResult(operation, {
                  data: {
                    __typename: 'Query',
                    user: {
                      __typename: 'GraphqlUser',
                      id: VIEWER,
                      soupEntity: answer ? structuredClone(answer) : null,
                    },
                  },
                });
              })()
            );
          })
        ),
        pipe(
          shared,
          filter((operation) => operation.kind === 'subscription'),
          mergeMap((operation) =>
            pipe(
              updates.source,
              map((result) => ({ ...result, operation }))
            )
          )
        ),
      ]);
    };
  const client = createClient({
    url: 'http://directory.test/graphql',
    exchanges: [
      createCacheSessionExchange(),
      normalizedCacheExchange(host as unknown as CacheHost),
      transport,
    ],
  });
  const subscription = pipe(
    client.subscription(SoupUpdatesDocument, {}),
    subscribe(() => {})
  );
  onTestFinished(() => subscription.unsubscribe());
  return {
    client,
    sent,
    /** Holds the server's answers to reads sent from now on. */
    hold() {
      holding = new Promise((done) => {
        land = done;
      });
    },
    land: () => land(),
    /** A soup update that takes `name`'s record out of the cache. */
    removeChannel(name: string) {
      updates.next({
        data: {
          soupUpdates: [
            {
              __typename: 'GraphqlCacheDeletion',
              graphqlTypeName: 'GraphqlSoupChannel',
              entityId: channelUuid(name),
            },
          ],
        },
      } as unknown as OperationResult);
    },
  };
}

/** Public channel `a`, named `name`, with the viewer in it since `joinedAt`
 * or, without it, not in it. */
function publicChannel(name: string, updatedAt: string, joinedAt?: string) {
  const record = channelRecord('a', { name, updatedAt });
  if (!joinedAt) return { ...record, isParticipant: false };
  return {
    ...record,
    participants: [
      ...record.participants,
      {
        channelId: channelUuid('a'),
        userId: VIEWER,
        role: 'MEMBER' as const,
        joinedAt,
        leftAt: null,
      },
    ],
  };
}

describe("the viewer's own channel writes", () => {
  const queryClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it('shows a rename at once that the pages, read from a lagging replica, missed', async () => {
    const network = fakeNetwork([channelRecord('a', { name: 'before' })], {
      primary: [channelRecord('a', { name: 'after', updatedAt: UPDATED_MID })],
    });
    const client = queryClient();
    const directory = mountMemoryDirectory(network, client);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    await writeOf(client, network, ['a']);

    expect(nameOf(directory, 'a')).toBe('after');
    expect(directory.channels().map(({ name }) => name)).toEqual(['after']);
    expect((await directory.readComplete()).map(({ name }) => name)).toEqual([
      'after',
    ]);
    expect(network.entityReads).toEqual([channelUuid('a')]);
  });

  it('takes out a channel the viewer deleted, and lists one they created', async () => {
    const network = fakeNetwork(
      [channelRecord('gone'), channelRecord('kept')],
      {
        primary: [
          channelRecord('kept'),
          channelRecord('new', { updatedAt: UPDATED_MID }),
        ],
      }
    );
    const client = queryClient();
    const directory = mountMemoryDirectory(network, client);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    await writeOf(client, network, ['gone', 'new']);

    expect(ids(directory.channels())).toEqual(['kept', 'new']);
    expect(directory.lookup(channelUuid('gone')).status).toBe('missing');
    expect(ids(await directory.readComplete())).toEqual(['kept', 'new']);
  });

  it('reads the pages again, backing off, until they show the write', async () => {
    vi.useFakeTimers();
    try {
      const channels = [channelRecord('a', { name: 'before' })];
      const written = channelRecord('a', {
        name: 'after',
        updatedAt: UPDATED_MID,
      });
      const network = fakeNetwork(channels, { primary: [written] });
      const client = queryClient();
      const directory = mountMemoryDirectory(network, client);
      await vi.waitFor(() => expect(directory.complete()).toBe(true));

      await writeOf(client, network, ['a']);
      const read = network.inputs.length;
      // The replica still lags: a second, then two more.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(network.inputs.length).toBe(read + 1);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(network.inputs.length).toBe(read + 1);
      channels[0] = written;
      await vi.advanceTimersByTimeAsync(1);
      expect(network.inputs.length).toBe(read + 2);

      // The pages show the write: no more reads.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(network.inputs.length).toBe(read + 2);
      expect(nameOf(directory, 'a')).toBe('after');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops reading again after four tries, and lets the write go when its hold ends', async () => {
    vi.useFakeTimers();
    try {
      const network = fakeNetwork([channelRecord('a', { name: 'before' })], {
        primary: [
          channelRecord('a', { name: 'after', updatedAt: UPDATED_MID }),
        ],
      });
      const client = queryClient();
      const directory = mountMemoryDirectory(network, client);
      await vi.waitFor(() => expect(directory.complete()).toBe(true));

      await writeOf(client, network, ['a']);
      const read = network.inputs.length;
      await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000);
      expect(network.inputs.length).toBe(read + 4);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(network.inputs.length).toBe(read + 4);
      expect(nameOf(directory, 'a')).toBe('after');

      await vi.advanceTimersByTimeAsync(OWN_WRITE_HOLD_MS);
      expect(nameOf(directory, 'a')).toBe('before');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a later update by someone else over the write', async () => {
    const channels = [channelRecord('a', { name: 'before' })];
    const network = fakeNetwork(channels, {
      primary: [channelRecord('a', { name: 'mine', updatedAt: UPDATED_MID })],
    });
    const client = queryClient();
    const directory = mountMemoryDirectory(network, client);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    await writeOf(client, network, ['a']);
    expect(nameOf(directory, 'a')).toBe('mine');

    channels[0] = channelRecord('a', {
      name: 'theirs',
      updatedAt: UPDATED_NEW,
    });
    directory.retry();

    await vi.waitFor(() => expect(nameOf(directory, 'a')).toBe('theirs'));
  });

  it('drops reads that land after the account changed', async () => {
    const network = fakeNetwork([channelRecord('a', { name: 'before' })], {
      primary: [channelRecord('a', { name: 'after', updatedAt: UPDATED_MID })],
    });
    const client = queryClient();
    const directory = mountMemoryDirectory(network, client);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    let account = ACCOUNT;
    const written = writeOf(client, network, ['a'], () => account);
    account = { userId: VIEWER, session: 2 };
    await written;

    expect(network.entityReads).toEqual([channelUuid('a')]);
    expect(ownChannelWrites(client).writes()).toEqual({});
    expect(nameOf(directory, 'a')).toBe('before');
  });

  it('starts no later reads of a write once the account changed', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const network = fakeNetwork([], {
      primary: names.map((name) =>
        channelRecord(name, { updatedAt: UPDATED_MID })
      ),
    });
    const held = heldNetwork(network);
    let sent = 0;
    const counting = fakeClient(
      (...args: Parameters<typeof held.client.query>) => {
        sent += 1;
        return held.client.query(...args);
      }
    ) as typeof network.client;
    const client = queryClient();

    let account = ACCOUNT;
    const written = writeOf(client, { client: counting }, names, () => account);
    await vi.waitFor(() => expect(sent).toBe(4));
    account = { userId: VIEWER, session: 2 };
    held.land();
    await written;

    expect(sent).toBe(4);
    expect(ownChannelWrites(client).writes()).toEqual({});
  });

  it('holds and reads nothing for a write another sign-in made', async () => {
    const network = fakeNetwork([], {
      primary: [channelRecord('a', { name: 'after', updatedAt: UPDATED_MID })],
    });
    const client = queryClient();

    await refreshChannelDirectory([channelUuid('a')], {
      client,
      soup: () => network.client,
      account: () => ACCOUNT,
      removed: [channelUuid('b')],
      writer: { userId: VIEWER, session: 0 },
    });

    expect(network.entityReads).toEqual([]);
    expect(ownChannelWrites(client).writes()).toEqual({});
  });

  it("holds nothing when the read fails, and shows no other viewer's write", async () => {
    const network = fakeNetwork([channelRecord('a', { name: 'before' })], {
      primary: [channelRecord('a', { name: 'after', updatedAt: UPDATED_MID })],
      failingEntityReads: 1,
    });
    const client = queryClient();
    const directory = mountMemoryDirectory(network, client);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    await writeOf(client, network, ['a']);
    expect(ownChannelWrites(client).writes()).toEqual({});

    await writeOf(client, network, ['a'], () => ({
      userId: 'macro|someone-else@example.com',
      session: 1,
    }));
    expect(Object.keys(ownChannelWrites(client).writes())).toEqual([
      channelUuid('a'),
    ]);
    expect(nameOf(directory, 'a')).toBe('before');
  });

  it('lets go of reads the primary never answers at their deadline, ending their requests', async () => {
    // The write's deadline aborts when the test says, as
    // `OWN_WRITE_READ_DEADLINE_MS` passing would.
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms) =>
        ms === OWN_WRITE_READ_DEADLINE_MS ? deadline.signal : realTimeout(ms)
      );
    try {
      let sent = 0;
      let ended = 0;
      const hung = fakeClient(() =>
        make(() => {
          sent += 1;
          return () => {
            ended += 1;
          };
        })
      ) as ReturnType<typeof fakeNetwork>['client'];
      const client = queryClient();
      let settled = false;
      const written = (async () => {
        await writeOf(client, { client: hung }, ['a', 'b']);
        settled = true;
      })();
      await vi.waitFor(() => expect(sent).toBe(2));
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(ended).toBe(0);

      deadline.abort();
      await written;

      expect(ended).toBe(2);
      expect(ownChannelWrites(client).writes()).toEqual({});
    } finally {
      timeout.mockRestore();
    }
  });

  it("ends a primary read through the app's reader once its signal aborts", async () => {
    let ended = 0;
    const hung = fakeClient(() =>
      make(() => () => {
        ended += 1;
      })
    ) as ReturnType<typeof fakeNetwork>['client'];
    const stop = new AbortController();
    const read = primaryChannelReader(() => hung)(
      channelUuid('a'),
      stop.signal
    );
    stop.abort();
    await expect(read).rejects.toBe(stop.signal.reason);
    expect(ended).toBe(1);
  });

  it('reads nothing for ids that are not channels', async () => {
    const network = fakeNetwork([]);
    await refreshChannelDirectory(['not-a-channel'], {
      client: queryClient(),
      soup: () => network.client,
      account: () => ACCOUNT,
    });
    expect(network.entityReads).toEqual([]);
  });

  it('shows a write over the cached record until the cache has it', async () => {
    const client = queryClient();
    const { cache, directory, reopen } = mountCachedDirectory([], {
      queryClient: client,
      fetchAll: async () => [directoryChannel('a', { name: 'before' })],
    });
    cache.put(channelRecord('a', { name: 'before' }));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    const written = channelRecord('a', {
      name: 'after',
      updatedAt: UPDATED_MID,
    });

    await writeOf(client, fakeNetwork([], { primary: [written] }), ['a']);
    expect(nameOf(directory, 'a')).toBe('after');
    expect((await directory.readComplete()).map(({ name }) => name)).toEqual([
      'after',
    ]);

    // The server's soup update lands, and then someone else's change.
    cache.put(written, { sourceHash: 'a-written' });
    reopen();
    await new Promise((done) => setTimeout(done, 20));
    expect(nameOf(directory, 'a')).toBe('after');
    cache.put(channelRecord('a', { name: 'theirs', updatedAt: UPDATED_NEW }), {
      sourceHash: 'a-theirs',
    });
    reopen();
    await vi.waitFor(() => expect(nameOf(directory, 'a')).toBe('theirs'));
  });

  it('lets the write go once the cache showed it, so a later removal stays removed', async () => {
    const client = queryClient();
    const { cache, directory, reopen } = mountCachedDirectory([], {
      queryClient: client,
    });
    cache.put(channelRecord('a', { name: 'before' }));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    const written = channelRecord('a', {
      name: 'after',
      updatedAt: UPDATED_MID,
    });
    await writeOf(client, fakeNetwork([], { primary: [written] }), ['a']);

    cache.put(written, { sourceHash: 'a-written' });
    reopen();
    await vi.waitFor(() =>
      expect(ownChannelWrites(client).writes()).toEqual({})
    );
    // The viewer loses access: the live patch takes the record out.
    cache.records.delete(`GraphqlSoupChannel:${channelUuid('a')}`);
    reopen();

    await vi.waitFor(() => expect(nameOf(directory, 'a')).toBe('missing'));
    expect(ids(directory.channels())).toEqual([]);
  });

  it('does not bring back a channel the cache lost before it showed the write', async () => {
    const client = queryClient();
    const { cache, directory, reopen } = mountCachedDirectory([], {
      queryClient: client,
    });
    cache.put(channelRecord('a', { name: 'before' }));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    const network = fakeNetwork([], {
      primary: [channelRecord('a', { name: 'after', updatedAt: UPDATED_MID })],
    });
    await writeOf(client, network, ['a']);
    expect(nameOf(directory, 'a')).toBe('after');

    // Removed right after the rename, before the rename's update arrived.
    cache.records.delete(`GraphqlSoupChannel:${channelUuid('a')}`);
    reopen();

    await vi.waitFor(() => expect(nameOf(directory, 'a')).toBe('missing'));
    expect(ids(directory.channels())).toEqual([]);
  });

  it('does not bring back a channel removed while the read of a rename was in flight', async () => {
    const client = queryClient();
    const { cache, directory, reopen } = mountCachedDirectory([], {
      queryClient: client,
    });
    cache.put(channelRecord('a', { name: 'before' }));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    const primary = heldNetwork(
      fakeNetwork([], {
        primary: [
          channelRecord('a', { name: 'after', updatedAt: UPDATED_MID }),
        ],
      })
    );

    // The primary read the rename's snapshot before the removal, and its
    // answer lands after the directory showed the removal.
    const write = writeOf(client, primary, ['a']);
    cache.records.delete(`GraphqlSoupChannel:${channelUuid('a')}`);
    reopen();
    await vi.waitFor(() => expect(nameOf(directory, 'a')).toBe('missing'));
    primary.land();
    await write;

    await new Promise((done) => setTimeout(done, 20));
    expect(nameOf(directory, 'a')).toBe('missing');
    expect(ids(directory.channels())).toEqual([]);
  });

  it('does not let a rename read sent before a removal write the channel back into the cache', async () => {
    const client = queryClient();
    const { cache, directory, reopen } = mountCachedDirectory([], {
      queryClient: client,
    });
    cache.put(channelRecord('a', { name: 'before' }));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    let primary: ChannelDirectoryFieldsFragment | null = channelRecord('a', {
      name: 'after',
      updatedAt: UPDATED_MID,
    });
    const soup = writeThroughSoup(cache, () => primary);

    // The rename's read takes the primary's snapshot, then the viewer is
    // removed: the server's soup update deletes the record before the
    // read's answer lands.
    soup.hold();
    const write = writeOf(client, soup, ['a']);
    await vi.waitFor(() => expect(soup.sent).toHaveLength(1));
    primary = null;
    soup.removeChannel('a');
    await vi.waitFor(() =>
      expect(cache.records.has(`GraphqlSoupChannel:${channelUuid('a')}`)).toBe(
        false
      )
    );
    reopen();
    await vi.waitFor(() => expect(nameOf(directory, 'a')).toBe('missing'));
    soup.land();
    await write;
    expect(cache.records.has(`GraphqlSoupChannel:${channelUuid('a')}`)).toBe(
      true
    );

    // The old answer wrote the channel back. The directory keeps it hidden,
    // reads it on the primary, and deletes the record the primary shows
    // the viewer out of.
    reopen();
    await vi.waitFor(() =>
      expect(cache.records.has(`GraphqlSoupChannel:${channelUuid('a')}`)).toBe(
        false
      )
    );
    await vi.waitFor(() => expect(nameOf(directory, 'a')).toBe('missing'));
    await vi.waitFor(() =>
      expect(ownChannelWrites(client).writes()).toEqual({})
    );
    expect(nameOf(directory, 'a')).toBe('missing');
    expect(ids(directory.channels())).toEqual([]);
  });

  it('lets a rename go once the cache shows the viewer removed at the same update time', async () => {
    const client = queryClient();
    const { cache, directory, reopen } = mountCachedDirectory([], {
      queryClient: client,
    });
    cache.put(publicChannel('before', UPDATED_OLD, UPDATED_OLD));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    await writeOf(
      client,
      fakeNetwork([], {
        primary: [publicChannel('after', UPDATED_MID, UPDATED_OLD)],
      }),
      ['a']
    );
    expect(nameOf(directory, 'a')).toBe('after');

    // Someone removes the viewer: removing a participant leaves the
    // channel's update time as it was.
    cache.put(publicChannel('after', UPDATED_MID), { sourceHash: 'a-out' });
    reopen();

    await vi.waitFor(() => expect(ids(directory.channels())).toEqual([]));
    await vi.waitFor(() =>
      expect(ownChannelWrites(client).writes()).toEqual({})
    );
  });

  it('lets a rename go when the viewer was removed before its read landed', async () => {
    const client = queryClient();
    const { cache, directory, reopen } = mountCachedDirectory([], {
      queryClient: client,
    });
    cache.put(publicChannel('before', UPDATED_OLD, UPDATED_OLD));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    const primary = heldNetwork(
      fakeNetwork([], {
        primary: [publicChannel('after', UPDATED_MID, UPDATED_OLD)],
      })
    );

    const write = writeOf(client, primary, ['a']);
    cache.put(publicChannel('after', UPDATED_MID), { sourceHash: 'a-out' });
    reopen();
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual([]));
    primary.land();
    await write;

    await new Promise((done) => setTimeout(done, 20));
    expect(ids(directory.channels())).toEqual([]);
  });

  it('holds a leave and a join of a public channel until the cache shows each', async () => {
    const client = queryClient();
    const { cache, directory, reopen } = mountCachedDirectory([], {
      queryClient: client,
      // The primary shows the viewer back in once they join again.
      readFromPrimary: async () => ({
        kind: 'read',
        channel: toDirectoryChannel(
          publicChannel('a', UPDATED_OLD, UPDATED_NEW)
        ),
      }),
    });
    cache.put(publicChannel('a', UPDATED_OLD, UPDATED_OLD));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    // They leave; the channel stays readable to them.
    await writeOf(
      client,
      fakeNetwork([], { primary: [publicChannel('a', UPDATED_OLD)] }),
      ['a']
    );
    expect(ids(directory.channels())).toEqual([]);
    cache.put(publicChannel('a', UPDATED_OLD), { sourceHash: 'a-left' });
    reopen();
    await vi.waitFor(() =>
      expect(ownChannelWrites(client).writes()).toEqual({})
    );

    // They join again, at the same update time; the cache has yet to show
    // it, through another change too.
    await writeOf(
      client,
      fakeNetwork([], {
        primary: [publicChannel('a', UPDATED_OLD, UPDATED_NEW)],
      }),
      ['a']
    );
    expect(ids(directory.channels())).toEqual(['a']);
    cache.put(publicChannel('a', UPDATED_OLD), { sourceHash: 'a-lagging' });
    reopen();
    await new Promise((done) => setTimeout(done, 20));
    expect(ids(directory.channels())).toEqual(['a']);

    cache.put(publicChannel('a', UPDATED_OLD, UPDATED_NEW), {
      sourceHash: 'a-joined',
    });
    reopen();
    await vi.waitFor(() =>
      expect(ownChannelWrites(client).writes()).toEqual({})
    );
    expect(ids(directory.channels())).toEqual(['a']);
  });

  it('shows a channel the viewer left again once they are added back', async () => {
    const client = queryClient();
    const { cache, directory, reopen } = mountCachedDirectory([], {
      queryClient: client,
    });
    const member = (joinedAt: string) =>
      channelRecord('a', {
        updatedAt: joinedAt,
        participants: [
          {
            channelId: channelUuid('a'),
            userId: VIEWER,
            role: 'MEMBER',
            joinedAt,
            leftAt: null,
          },
        ],
      });
    cache.put(member(UPDATED_OLD));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    // They leave: the primary no longer lets them read it.
    await writeOf(client, fakeNetwork([], { primary: [] }), ['a']);
    expect(nameOf(directory, 'a')).toBe('missing');
    // A message moves the cached record on; they are still out.
    cache.put(
      { ...member(UPDATED_OLD), updatedAt: UPDATED_MID },
      { sourceHash: 'a-message' }
    );
    reopen();
    await new Promise((done) => setTimeout(done, 20));
    expect(nameOf(directory, 'a')).toBe('missing');

    // Someone adds them back before the hold ends.
    cache.put(member(UPDATED_NEW), { sourceHash: 'a-rejoined' });
    reopen();
    await vi.waitFor(() => expect(nameOf(directory, 'a')).toBe('channel a'));
  });

  it('shows a rejoin the cache showed before the leave’s read landed, when the cache had already taken the channel out', async () => {
    const client = queryClient();
    const { cache, directory, reopen } = mountCachedDirectory([], {
      queryClient: client,
    });
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    // They left, and the cache took the channel out before the leave's
    // read was sent; the primary no longer lets them read it.
    const primary = heldNetwork(fakeNetwork([], { primary: [] }));
    const write = writeOf(client, primary, ['a']);
    // Someone adds them back while the read is under way.
    cache.put(publicChannel('a', UPDATED_NEW, UPDATED_NEW), {
      sourceHash: 'a-rejoined',
    });
    reopen();
    await vi.waitFor(() => expect(ids(directory.channels())).toEqual(['a']));
    primary.land();
    await write;

    await new Promise((done) => setTimeout(done, 20));
    expect(ids(directory.channels())).toEqual(['a']);
  });

  it('keeps the later of two reads of a channel, whichever lands last', async () => {
    const network = fakeNetwork([
      channelRecord('a', { name: 'before', updatedAt: UPDATED_OLD }),
    ]);
    const client = queryClient();
    const directory = mountMemoryDirectory(network, client);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    let land!: () => void;
    const landed = new Promise<void>((done) => {
      land = done;
    });
    const older = fakeNetwork([], {
      primary: [channelRecord('a', { name: 'first', updatedAt: UPDATED_MID })],
    });
    const slow = {
      client: fakeClient((...args: Parameters<typeof older.client.query>) => ({
        toPromise: async () => {
          await landed;
          return older.client.query(...args).toPromise();
        },
      })) as typeof older.client,
    };
    const first = writeOf(client, slow, ['a']);
    await writeOf(
      client,
      fakeNetwork([], {
        primary: [
          channelRecord('a', { name: 'second', updatedAt: UPDATED_NEW }),
        ],
      }),
      ['a']
    );
    land();
    await first;

    expect(nameOf(directory, 'a')).toBe('second');
  });

  it('lets every write go when the storage is reset', async () => {
    const client = queryClient();
    const { cache, directory, resetStorage } = mountCachedDirectory([], {
      queryClient: client,
    });
    cache.put(channelRecord('a', { name: 'before' }));
    completeLane('g1');
    await vi.waitFor(() => expect(directory.complete()).toBe(true));
    await writeOf(
      client,
      fakeNetwork([], {
        primary: [
          channelRecord('a', { name: 'after', updatedAt: UPDATED_MID }),
        ],
      }),
      ['a']
    );
    expect(nameOf(directory, 'a')).toBe('after');

    resetStorage('g2');

    expect(ownChannelWrites(client).writes()).toEqual({});
    expect(nameOf(directory, 'a')).not.toBe('after');
  });

  it("shows none of the viewer's writes from an earlier sign-in", async () => {
    const network = fakeNetwork([channelRecord('a', { name: 'before' })], {
      primary: [channelRecord('a', { name: 'after', updatedAt: UPDATED_MID })],
    });
    const client = queryClient();
    const directory = mountMemoryDirectory(network, client);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    await writeOf(client, network, ['a'], () => ({
      userId: VIEWER,
      session: ACCOUNT.session - 1,
    }));

    expect(Object.keys(ownChannelWrites(client).writes())).toEqual([
      channelUuid('a'),
    ]);
    expect(nameOf(directory, 'a')).toBe('before');
  });

  it('holds a bulk change in one update, and reads back at most twenty channels', async () => {
    const names = ['a', 'b', 'c'];
    const network = fakeNetwork(names.map((name) => channelRecord(name)));
    const client = queryClient();
    const own = ownChannelWrites(client);
    let updates = 0;
    createRoot((dispose) => {
      disposers.push(dispose);
      createComputed(() => {
        own.writes();
        updates += 1;
      });
    });

    await writeOf(client, network, names);
    expect(network.entityReads).toHaveLength(3);
    expect(Object.keys(own.writes())).toHaveLength(3);
    expect(updates).toBe(2);

    const many = Array.from({ length: 21 }, (_, index) => `bulk-${index}`);
    const bulk = fakeNetwork(many.map((name) => channelRecord(name)));
    await writeOf(client, bulk, many);
    expect(bulk.entityReads).toEqual([]);
  });

  it('takes out the channels the viewer deleted without reading them', async () => {
    const network = fakeNetwork([channelRecord('gone'), channelRecord('kept')]);
    const client = queryClient();
    const directory = mountMemoryDirectory(network, client);
    await vi.waitFor(() => expect(directory.complete()).toBe(true));

    await refreshChannelDirectory([], {
      client,
      soup: () => network.client,
      account: () => ACCOUNT,
      removed: [channelUuid('gone')],
    });

    expect(network.entityReads).toEqual([]);
    expect(ids(directory.channels())).toEqual(['kept']);
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
