import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import type { GraphqlSoupInput } from '@service-storage/graphql-soup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelDirectoryPassUnproven,
  createChannelDirectoryBackfillFetcher,
} from './directory-reconcile';
import { channelName, channelUuid } from './tests/channel-uuid';
import {
  fakeChannelCache,
  channelRecord as recordWithId,
} from './tests/directory-fixtures';

/** A channel record named by a readable test name; ids are UUIDs, as the
 * server's are. */
const channelRecord = (
  name: string,
  overrides?: Parameters<typeof recordWithId>[1]
) => recordWithId(channelUuid(name), overrides);

// The span that is current, which, as in a browser, does not survive an
// await: only work started inside `run` sees it.
const telemetry = vi.hoisted(() => ({
  error: vi.fn(),
  active: [] as string[],
}));
vi.mock('@macro-inc/observability', async (importOriginal) => {
  const within = <T>(name: string, work: () => T): T => {
    telemetry.active.push(name);
    try {
      return work();
    } finally {
      telemetry.active.pop();
    }
  };
  return {
    ...(await importOriginal<object>()),
    Telemetry: {
      error: telemetry.error,
      span: async (
        name: string,
        operation: (span: {
          setAttr: () => void;
          run: <T>(work: () => T) => T;
        }) => Promise<unknown>
      ) =>
        within(name, () =>
          operation({
            setAttr: () => {},
            run: (work) => within(name, work),
          })
        ),
    },
  };
});
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: vi.fn(),
  getGraphqlSoupClient: vi.fn(),
  hydrateGraphqlSoup: vi.fn(),
}));

const LANE = {
  limit: 100,
  expand: true,
  sortMethod: 'CREATED_AT' as const,
  filters: { documentFilter: { literal: { id: 'nil' } } },
};
const FIRST: GraphqlSoupInput = { initial: LANE };
const SECOND: GraphqlSoupInput = {
  continuation: { cursor: 'p2', expand: true },
};
const THIRD: GraphqlSoupInput = {
  continuation: { cursor: 'p3', expand: true },
};

type Page = { nextCursor: string | null; entityIds?: string[] };

function reconcileHost(cachedIds: string[], viewer = 'viewer') {
  const cache = fakeChannelCache();
  for (const id of cachedIds) cache.put(channelRecord(id));
  let generation = 'g1';
  return {
    cache,
    setGeneration(next: string) {
      generation = next;
    },
    host: {
      ...cache.host,
      currentStorageGeneration: vi.fn(async () => generation),
      readQuery: vi.fn(async () => ({
        kind: 'hit' as const,
        data: { user: { id: viewer } },
      })),
      deleteRecords: vi.fn<CacheHost['deleteRecords']>(async () => ({
        revision: INITIAL_CACHE_REVISION,
        affectedOps: [],
      })),
    },
  };
}

/** Lane pages in order, then by-id reads answered from `readable`. Like the
 * server, a by-id page that reaches its limit carries a cursor. */
function server(lanePages: Page[], readable: string[] = []) {
  for (const page of lanePages)
    if (page.entityIds) page.entityIds = page.entityIds.map(channelUuid);
  const pages = [...lanePages];
  const readableIds = readable.map(channelUuid);
  return vi.fn(async (input: GraphqlSoupInput): Promise<Page> => {
    const filter = input.initial?.filters?.channelFilter;
    if (filter) {
      const asked = JSON.stringify(filter).match(/"channelId":"([^"]+)"/g);
      const ids = (asked ?? []).map((part) => part.split('"')[3]);
      const entityIds = ids.filter((id) => readableIds.includes(id));
      return {
        nextCursor: entityIds.length === input.initial?.limit ? 'more' : null,
        entityIds,
      };
    }
    const page = pages.shift();
    if (!page) throw new Error('no more lane pages');
    return page;
  });
}

type ReadFromPrimary = NonNullable<
  Parameters<typeof createChannelDirectoryBackfillFetcher>[4]
>;
type Fetch = NonNullable<
  Parameters<typeof createChannelDirectoryBackfillFetcher>[2]
>;

/** The primary, showing the viewer the channels `readable` names when each
 * read is sent. As the app's read does, it writes one it shows to the cache.
 * By default it shows none, agreeing with a replica that no longer returned
 * them. */
function primary(
  cache?: ReturnType<typeof fakeChannelCache>,
  readable: () => readonly string[] = () => []
) {
  return vi.fn<ReadFromPrimary>(async (channelId) => {
    if (!readable().map(channelUuid).includes(channelId)) return 'unreadable';
    cache?.put(recordWithId(channelId), { sourceHash: `${channelId}-primary` });
    return 'readable';
  });
}

const fetcher = (
  host: Parameters<typeof createChannelDirectoryBackfillFetcher>[1],
  fetch: Fetch,
  session?: () => string,
  read: ReadFromPrimary = primary()
) =>
  createChannelDirectoryBackfillFetcher('viewer', host, fetch, session, read);

/** The channels the primary was asked about, by test name, in order. */
const askedPrimary = (read: ReturnType<typeof primary>) =>
  read.mock.calls.map(([id]) => channelName(id));

async function runPass(
  fetchPage: Awaited<ReturnType<typeof createChannelDirectoryBackfillFetcher>>,
  inputs: GraphqlSoupInput[]
) {
  for (const input of inputs) await fetchPage(input);
}

/** The record keys deleted, by test name. */
const deleted = (host: { deleteRecords: ReturnType<typeof vi.fn> }) =>
  host.deleteRecords.mock.calls.flatMap(([keys]) =>
    (keys as string[]).map((key) =>
      key.replace(/:(.*)$/, (_, id: string) => `:${channelName(id)}`)
    )
  );

describe('channel directory reconciliation', () => {
  beforeEach(() => {
    telemetry.error.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deletes only the cached channels the server no longer returns by id', async () => {
    const { host } = reconcileHost(['joined', 'unjoined', 'removed']);
    const fetch = server(
      [
        { nextCursor: 'next', entityIds: ['joined'] },
        { nextCursor: null, entityIds: [] },
      ],
      ['unjoined']
    );
    const fetchPage = await fetcher(host, fetch);

    await runPass(fetchPage, [
      FIRST,
      { continuation: { cursor: 'next', expand: true } },
    ]);

    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    const byId = fetch.mock.calls[2]?.[0];
    expect(byId).toMatchObject({
      initial: {
        ...LANE,
        limit: 2,
        filters: {
          ...LANE.filters,
          channelFilter: {
            and: {
              right: {
                or: {
                  left: { literal: { isParticipant: true } },
                  right: { literal: { isParticipant: false } },
                },
              },
            },
          },
        },
      },
    });
  });

  it('deletes a cached id the server cannot parse without naming it in a read', async () => {
    const { cache, host } = reconcileHost(['joined', 'removed']);
    cache.put(recordWithId('not-a-channel'));
    const fetch = server([{ nextCursor: null, entityIds: ['joined'] }]);
    const fetchPage = await fetcher(host, fetch);

    await fetchPage(FIRST);

    expect(deleted(host).sort()).toEqual([
      'GraphqlSoupChannel:not-a-channel',
      'GraphqlSoupChannel:removed',
    ]);
    expect(JSON.stringify(fetch.mock.calls.slice(1))).not.toContain(
      'not-a-channel'
    );
  });

  it('reads candidates by id in batches of a hundred', async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `c${index}`);
    const { host } = reconcileHost(ids);
    const fetch = server([{ nextCursor: null, entityIds: [] }], ids);
    const sentIn: (string | undefined)[] = [];
    const answer = fetch.getMockImplementation();
    fetch.mockImplementation(async (input) => {
      if (input.initial?.filters?.channelFilter)
        sentIn.push(telemetry.active.at(-1));
      if (!answer) throw new Error('no server');
      return answer(input);
    });
    const fetchPage = await fetcher(host, fetch);

    await fetchPage(FIRST);

    const batches = fetch.mock.calls
      .slice(1)
      .map(([input]) => input.initial?.limit);
    expect(batches).toEqual([100, 100, 50]);
    // Each in the reconciliation's span, the later ones past an await too.
    expect(sentIn).toEqual(Array(3).fill('channel_directory.reconcile'));
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('takes a full by-id page that returned every channel as evidence', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `c${index}`);
    const { host } = reconcileHost(ids);
    // The first batch is all readable, so its page carries a cursor.
    const fetch = server(
      [{ nextCursor: null, entityIds: [] }],
      ids.slice(0, 120)
    );
    const fetchPage = await fetcher(host, fetch);

    await fetchPage(FIRST);

    expect(deleted(host)).toEqual(
      ids.slice(120).map((id) => `GraphqlSoupChannel:${id}`)
    );
  });

  it('fails the last page of a resumed pass and deletes nothing', async () => {
    const { host } = reconcileHost(['removed']);
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await fetcher(host, fetch);

    await expect(
      fetchPage({ continuation: { cursor: 'saved', expand: true } })
    ).rejects.toEqual(new ChannelDirectoryPassUnproven('partial_pass'));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('returns the pages before the last of a resumed pass', async () => {
    const { host } = reconcileHost(['removed']);
    const page = { nextCursor: 'next', entityIds: ['a'] };
    const fetchPage = await fetcher(host, server([page]));

    await expect(
      fetchPage({ continuation: { cursor: 'saved', expand: true } })
    ).resolves.toBe(page);
  });

  it('fails the last page when a lane page did not list its channels', async () => {
    const { host } = reconcileHost(['removed']);
    const fetch = server([
      { nextCursor: 'next' },
      { nextCursor: null, entityIds: [] },
    ]);
    const fetchPage = await fetcher(host, fetch);

    await expect(
      runPass(fetchPage, [
        FIRST,
        { continuation: { cursor: 'next', expand: true } },
      ])
    ).rejects.toEqual(new ChannelDirectoryPassUnproven('partial_pass'));
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('fails the last page in a cache that belongs to another viewer', async () => {
    const { host } = reconcileHost(['removed'], 'someone-else');
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await fetcher(host, fetch);

    await expect(fetchPage(FIRST)).rejects.toEqual(
      new ChannelDirectoryPassUnproven('scope')
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('fails the last page when the storage generation changed during the pass', async () => {
    const harness = reconcileHost(['removed']);
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await fetcher(harness.host, fetch);

    harness.setGeneration('g2');
    await expect(fetchPage(FIRST)).rejects.toEqual(
      new ChannelDirectoryPassUnproven('scope_changed')
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(harness.host.deleteRecords).not.toHaveBeenCalled();
  });

  it('fails the last page when a by-id read is not complete evidence', async () => {
    const { host } = reconcileHost(['removed', 'other']);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ nextCursor: null, entityIds: [] })
      // A cursor without every named channel: more could follow.
      .mockResolvedValueOnce({
        nextCursor: 'more',
        entityIds: [channelUuid('other')],
      });
    const fetchPage = await fetcher(host, fetch);

    await expect(fetchPage(FIRST)).rejects.toEqual(
      new ChannelDirectoryPassUnproven('incomplete')
    );
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('reads again after a failed by-id read', async () => {
    vi.useFakeTimers();
    const { host } = reconcileHost(['removed']);
    const final = { nextCursor: null, entityIds: [] };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(final)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ nextCursor: null, entityIds: [] });
    const read = primary();
    const fetchPage = await fetcher(host, fetch, undefined, read);

    const landed = fetchPage(FIRST);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(landed).resolves.toBe(final);
    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    // To confirm the replica, then once more after the delete.
    expect(askedPrimary(read)).toEqual(['removed', 'removed']);
    expect(telemetry.error).toHaveBeenCalledTimes(1);
  });

  it('fails the last page when every by-id read failed', async () => {
    vi.useFakeTimers();
    const { host } = reconcileHost(['removed']);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ nextCursor: null, entityIds: [] })
      .mockRejectedValue(new Error('network'));
    const fetchPage = await fetcher(host, fetch);

    const landed = expect(fetchPage(FIRST)).rejects.toThrow('network');
    await vi.advanceTimersByTimeAsync(3_000);

    await landed;
    // The lane page, then three reads by id.
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('lists the cache at the last page when it could not as the pass began', async () => {
    const { host } = reconcileHost(['removed']);
    host.search.mockRejectedValueOnce(new Error('engine gone'));
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await fetcher(host, fetch);

    await fetchPage(FIRST);

    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    expect(telemetry.error).toHaveBeenCalledTimes(1);
  });

  it('pages without reconciling when the device cache is off', async () => {
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await fetcher(undefined, fetch);

    await expect(fetchPage(FIRST)).resolves.toEqual({
      nextCursor: null,
      entityIds: [],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('deletes under the cache session it read the evidence in', async () => {
    const { host } = reconcileHost(['removed']);
    let session = 's1';
    const fetch = vi.fn(async (input: GraphqlSoupInput): Promise<Page> => {
      // The session changes while the by-id read is out.
      if (input.initial?.filters?.channelFilter) session = 's2';
      return { nextCursor: null, entityIds: [] };
    });
    const fetchPage = await fetcher(host, fetch, () => session);

    await fetchPage(FIRST);

    expect(host.deleteRecords).toHaveBeenCalledExactlyOnceWith(
      [`GraphqlSoupChannel:${channelUuid('removed')}`],
      's1'
    );
  });

  it('reads a channel again when the cache rewrote it after the reads found it gone', async () => {
    const { cache, host } = reconcileHost(['removed', 'readded']);
    let readable: string[] = [];
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const answer = fetch.getMockImplementation();
    fetch.mockImplementation(async (input) => {
      if (!answer) throw new Error('no server');
      const page = await answer(input);
      return input.initial?.filters?.channelFilter
        ? {
            ...page,
            entityIds: readable
              .map(channelUuid)
              .filter((id) => JSON.stringify(input).includes(id)),
          }
        : page;
    });
    const read = vi.fn<ReadFromPrimary>(async (id) => {
      if (id === channelUuid('readded') && readable.length === 0) {
        // The viewer is added back just after the primary answered, and
        // the update reaches the cache before the deletes.
        cache.put(
          channelRecord('readded', { updatedAt: '2026-11-20T00:00:00Z' }),
          { sourceHash: 'readded-2' }
        );
        readable = ['readded'];
      }
      return 'unreadable';
    });
    const fetchPage = await fetcher(host, fetch, undefined, read);

    await fetchPage(FIRST);

    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    // Read again, by id, and the replica now returns it.
    expect(namedInReads(fetch).sort()).toEqual([
      'readded',
      'readded',
      'removed',
    ]);
  });

  it('reads a deleted channel on the primary once more, writing back one the viewer was added back to as it was deleted', async () => {
    const { cache, host } = reconcileHost(['removed', 'readded']);
    let readable: string[] = [];
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const read = primary(cache, () => readable);
    host.deleteRecords.mockImplementationOnce(async (keys) => {
      // The viewer is added back after the check, and the update lands just
      // before the delete takes it out.
      readable = ['readded'];
      for (const key of keys) cache.records.delete(key);
      return { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    });
    const fetchPage = await fetcher(host, fetch, undefined, read);

    await fetchPage(FIRST);

    // The replica is read to decide both; the look after the delete goes to
    // the primary, which the replica can lag.
    expect(namedInReads(fetch).sort()).toEqual(['readded', 'removed']);
    expect(askedPrimary(read).sort()).toEqual([
      'readded',
      'readded',
      'removed',
      'removed',
    ]);
    expect(
      cache.records.has(`GraphqlSoupChannel:${channelUuid('readded')}`)
    ).toBe(true);
    expect(
      cache.records.has(`GraphqlSoupChannel:${channelUuid('removed')}`)
    ).toBe(false);
  });

  it('keeps a channel the replica no longer returns while the primary shows it', async () => {
    const { cache, host } = reconcileHost(['joined', 'rejoined', 'removed']);
    // The replica lags the viewer's rejoin, which the cache already holds:
    // it answers every by-id read without the channel.
    const fetch = server([{ nextCursor: null, entityIds: ['joined'] }]);
    const read = primary(cache, () => ['rejoined']);
    const fetchPage = await fetcher(host, fetch, undefined, read);

    await expect(fetchPage(FIRST)).resolves.toMatchObject({ nextCursor: null });

    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    expect(
      cache.records.get(`GraphqlSoupChannel:${channelUuid('rejoined')}`)
        ?.sourceHash
    ).toBe(`${channelUuid('rejoined')}-primary`);
  });

  it('reads on the primary only what the replica no longer returned', async () => {
    const { host } = reconcileHost(['unjoined', 'removed']);
    const fetch = server([{ nextCursor: null, entityIds: [] }], ['unjoined']);
    const read = primary();
    const fetchPage = await fetcher(host, fetch, undefined, read);

    await fetchPage(FIRST);

    expect(askedPrimary(read)).toEqual(['removed', 'removed']);
  });

  it('does not finish a pass whose look after a delete fails on every attempt', async () => {
    vi.useFakeTimers();
    const { host } = reconcileHost(['removed']);
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    let reads = 0;
    const read = vi.fn<ReadFromPrimary>(async () => {
      reads += 1;
      // The confirmation answers; every look after the delete fails.
      if (reads > 1) throw new Error('primary unreachable');
      return 'unreadable';
    });
    const fetchPage = await fetcher(host, fetch, undefined, read);

    const landed = expect(fetchPage(FIRST)).rejects.toThrow(
      'primary unreachable'
    );
    await vi.advanceTimersByTimeAsync(3_000);

    await landed;
    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    // One confirmation, then the look after the delete in each attempt.
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('looks again at a deleted channel on the next attempt when the look after its delete failed', async () => {
    vi.useFakeTimers();
    const { cache, host } = reconcileHost(['removed', 'readded']);
    let readable: string[] = [];
    let failing = false;
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const shows = primary(cache, () => readable);
    const read = vi.fn<ReadFromPrimary>(async (id, signal) => {
      if (failing && id === channelUuid('readded')) {
        failing = false;
        throw new Error('primary unreachable');
      }
      return shows(id, signal);
    });
    host.deleteRecords.mockImplementationOnce(async (keys) => {
      readable = ['readded'];
      failing = true;
      for (const key of keys) cache.records.delete(key);
      return { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    });
    const fetchPage = await fetcher(host, fetch, undefined, read);

    const landed = fetchPage(FIRST);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(landed).resolves.toMatchObject({ nextCursor: null });
    expect(telemetry.error).toHaveBeenCalledTimes(1);
    expect(
      cache.records.has(`GraphqlSoupChannel:${channelUuid('readded')}`)
    ).toBe(true);
  });

  it('looks again at what a failed reconciliation deleted when the lane reads the last page again', async () => {
    vi.useFakeTimers();
    const { cache, host } = reconcileHost(['removed', 'readded']);
    let readable: string[] = [];
    let reachable = true;
    const lane = { nextCursor: null, entityIds: [] };
    const fetch = server([lane, lane]);
    const shows = primary(cache, () => readable);
    const read = vi.fn<ReadFromPrimary>(async (id, signal) => {
      if (!reachable) throw new Error('primary unreachable');
      return shows(id, signal);
    });
    host.deleteRecords.mockImplementationOnce(async (keys) => {
      readable = ['readded'];
      reachable = false;
      for (const key of keys) cache.records.delete(key);
      return { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    });
    const fetchPage = await fetcher(host, fetch, undefined, read);

    const failed = expect(fetchPage(FIRST)).rejects.toThrow(
      'primary unreachable'
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await failed;
    reachable = true;
    // The lane retries the page it never saved with the same fetcher.
    await expect(fetchPage(FIRST)).resolves.toMatchObject({ nextCursor: null });

    expect(
      cache.records.has(`GraphqlSoupChannel:${channelUuid('readded')}`)
    ).toBe(true);
    expect(
      cache.records.has(`GraphqlSoupChannel:${channelUuid('removed')}`)
    ).toBe(false);
  });

  it('confirms at most five hundred channels on the primary in a pass, failing it so the next pass goes on', async () => {
    const ids = Array.from({ length: 600 }, (_, index) => `c${index}`);
    const { host } = reconcileHost(ids);
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const read = primary();
    const fetchPage = await fetcher(host, fetch, undefined, read);

    await expect(fetchPage(FIRST)).rejects.toEqual(
      new ChannelDirectoryPassUnproven('deferred')
    );
    expect(deleted(host)).toHaveLength(500);
    // Five hundred confirmations, then the look after each delete.
    expect(read).toHaveBeenCalledTimes(1_000);
  });

  it('reads a few channels at a time on the primary, in the reconciliation span', async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `c${index}`);
    const { host } = reconcileHost(ids);
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    let inFlight = 0;
    let most = 0;
    const sentIn: (string | undefined)[] = [];
    const read = vi.fn<ReadFromPrimary>(async () => {
      sentIn.push(telemetry.active.at(-1));
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return 'unreadable';
    });
    const fetchPage = await fetcher(host, fetch, undefined, read);

    await fetchPage(FIRST);

    expect(most).toBe(4);
    expect(sentIn).toEqual(Array(18).fill('channel_directory.reconcile'));
  });

  it('fails the last page when a channel keeps changing under its by-id reads', async () => {
    const { cache, host } = reconcileHost(['busy']);
    let byIdReads = 0;
    const fetch = vi.fn(async (input: GraphqlSoupInput): Promise<Page> => {
      if (input.initial?.filters?.channelFilter) {
        byIdReads += 1;
        cache.put(channelRecord('busy'), { sourceHash: `busy-${byIdReads}` });
      }
      return { nextCursor: null, entityIds: [] };
    });
    const fetchPage = await fetcher(host, fetch);

    await expect(fetchPage(FIRST)).rejects.toBeInstanceOf(
      ChannelDirectoryPassUnproven
    );
    expect(byIdReads).toBe(3);
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('reads nothing by id after a pass that returned every cached channel', async () => {
    const { host } = reconcileHost(['joined']);
    const fetch = server([{ nextCursor: null, entityIds: ['joined'] }]);
    const fetchPage = await fetcher(host, fetch);

    await fetchPage(FIRST);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // The lane saves a page's cursor only after its checks pass, and a retry
  // reads from the cursor it saved: a page it read but never saved is read
  // again, and only that second answer counts.
  it.each([
    {
      page: 'first',
      pages: [
        { nextCursor: 'p2', entityIds: ['kept', 'removed'] },
        { nextCursor: 'p2', entityIds: ['kept'] },
        { nextCursor: null, entityIds: [] },
      ],
      inputs: [FIRST, FIRST, SECOND],
    },
    {
      page: 'second',
      pages: [
        { nextCursor: 'p2', entityIds: ['kept'] },
        { nextCursor: 'p3', entityIds: ['removed'] },
        { nextCursor: 'p3', entityIds: [] },
        { nextCursor: null, entityIds: [] },
      ],
      inputs: [FIRST, SECOND, SECOND, THIRD],
    },
  ])(
    'deletes a channel the $page page listed before the lane read it again without it',
    async ({ pages, inputs }) => {
      const { host } = reconcileHost(['kept', 'removed']);
      const fetch = server(pages.map((page) => ({ ...page })));
      const fetchPage = await fetcher(host, fetch);

      await runPass(fetchPage, inputs);

      expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    }
  );

  it('keeps a page once the lane asks for the page after it', async () => {
    const { host } = reconcileHost(['kept', 'removed']);
    const fetch = server(
      [
        { nextCursor: 'p2', entityIds: ['kept'] },
        { nextCursor: 'p3', entityIds: [] },
        { nextCursor: 'p3', entityIds: [] },
        { nextCursor: null, entityIds: [] },
      ],
      ['kept']
    );
    const read = primary();
    const fetchPage = await fetcher(host, fetch, undefined, read);
    await runPass(fetchPage, [FIRST, SECOND, SECOND, THIRD]);

    // Only the removed channel is read by id, the first page was kept: to
    // decide, then on the primary to confirm and once more after its delete.
    expect(namedInReads(fetch)).toEqual(['removed']);
    expect(askedPrimary(read)).toEqual(['removed', 'removed']);
    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
  });
});

/** The channels by-id reads named, by test name. */
function namedInReads(fetch: ReturnType<typeof server>) {
  return fetch.mock.calls.flatMap(([input]) =>
    [
      ...JSON.stringify(input.initial?.filters?.channelFilter ?? null).matchAll(
        /"channelId":"([^"]+)"/g
      ),
    ].map(([, id]) => channelName(id))
  );
}
