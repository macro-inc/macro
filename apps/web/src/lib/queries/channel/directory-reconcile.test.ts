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

const telemetry = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Telemetry: {
    error: telemetry.error,
    span: async (
      _name: string,
      operation: (span: { setAttr: () => void }) => Promise<unknown>
    ) => operation({ setAttr: () => {} }),
  },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: vi.fn(),
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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

    await fetchPage(FIRST);

    const batches = fetch.mock.calls
      .slice(1)
      .map(([input]) => input.initial?.limit);
    expect(batches).toEqual([100, 100, 50]);
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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

    await fetchPage(FIRST);

    expect(deleted(host)).toEqual(
      ids.slice(120).map((id) => `GraphqlSoupChannel:${id}`)
    );
  });

  it('fails the last page of a resumed pass and deletes nothing', async () => {
    const { host } = reconcileHost(['removed']);
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

    await expect(
      fetchPage({ continuation: { cursor: 'saved', expand: true } })
    ).rejects.toEqual(new ChannelDirectoryPassUnproven('partial_pass'));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('returns the pages before the last of a resumed pass', async () => {
    const { host } = reconcileHost(['removed']);
    const page = { nextCursor: 'next', entityIds: ['a'] };
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      server([page])
    );

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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

    await expect(fetchPage(FIRST)).rejects.toEqual(
      new ChannelDirectoryPassUnproven('scope')
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('fails the last page when the storage generation changed during the pass', async () => {
    const harness = reconcileHost(['removed']);
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      harness.host,
      fetch
    );

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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

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
      .mockResolvedValueOnce({ nextCursor: null, entityIds: [] })
      // The look after the delete.
      .mockResolvedValueOnce({ nextCursor: null, entityIds: [] });
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

    const landed = fetchPage(FIRST);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(landed).resolves.toBe(final);
    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    expect(telemetry.error).toHaveBeenCalledTimes(1);
  });

  it('fails the last page when every by-id read failed', async () => {
    vi.useFakeTimers();
    const { host } = reconcileHost(['removed']);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ nextCursor: null, entityIds: [] })
      .mockRejectedValue(new Error('network'));
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

    await fetchPage(FIRST);

    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    expect(telemetry.error).toHaveBeenCalledTimes(1);
  });

  it('pages without reconciling when the device cache is off', async () => {
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      undefined,
      fetch
    );

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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch,
      () => session
    );

    await fetchPage(FIRST);

    expect(host.deleteRecords).toHaveBeenCalledExactlyOnceWith(
      [`GraphqlSoupChannel:${channelUuid('removed')}`],
      's1'
    );
  });

  it('reads a channel again when the cache rewrote it after a by-id read found it gone', async () => {
    const { cache, host } = reconcileHost(['removed', 'readded']);
    let readable: string[] = [];
    let byIdReads = 0;
    const fetch = vi.fn(async (input: GraphqlSoupInput): Promise<Page> => {
      if (!input.initial?.filters?.channelFilter)
        return { nextCursor: null, entityIds: [] };
      byIdReads += 1;
      if (byIdReads > 1) return { nextCursor: null, entityIds: readable };
      // The viewer is added back just after this read answered, and the
      // update reaches the cache before the deletes.
      cache.put(
        channelRecord('readded', { updatedAt: '2026-11-20T00:00:00Z' }),
        {
          sourceHash: 'readded-2',
        }
      );
      readable = [channelUuid('readded')];
      return { nextCursor: null, entityIds: [] };
    });
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

    await fetchPage(FIRST);

    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    expect(byIdReads).toBe(2);
  });

  it('reads a deleted channel once more, writing back one the viewer was added back to as it was deleted', async () => {
    const { cache, host } = reconcileHost(['removed', 'readded']);
    const asked: string[][] = [];
    let readable: string[] = [];
    const fetch = vi.fn(async (input: GraphqlSoupInput): Promise<Page> => {
      const filter = input.initial?.filters?.channelFilter;
      if (!filter) return { nextCursor: null, entityIds: [] };
      const ids = [...JSON.stringify(filter).matchAll(/"channelId":"([^"]+)"/g)]
        .map(([, id]) => id)
        .filter((id): id is string => id !== undefined);
      asked.push(ids.map(channelName).sort());
      // Hydration writes what the read returns.
      const entityIds = ids.filter((id) => readable.includes(id));
      for (const id of entityIds)
        cache.put(recordWithId(id), { sourceHash: `${id}-back` });
      return { nextCursor: null, entityIds };
    });
    host.deleteRecords.mockImplementationOnce(async (keys) => {
      // The viewer is added back after the check, and the update lands just
      // before the delete takes it out.
      readable = [channelUuid('readded')];
      for (const key of keys) cache.records.delete(key);
      return { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    });
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

    await fetchPage(FIRST);

    // To decide both, then the look after their delete.
    expect(asked).toEqual([
      ['readded', 'removed'],
      ['readded', 'removed'],
    ]);
    expect(
      cache.records.has(`GraphqlSoupChannel:${channelUuid('readded')}`)
    ).toBe(true);
    expect(
      cache.records.has(`GraphqlSoupChannel:${channelUuid('removed')}`)
    ).toBe(false);
  });

  it('keeps the pass when only the second look at a deleted channel fails', async () => {
    const { host } = reconcileHost(['removed']);
    let byIdReads = 0;
    const fetch = vi.fn(async (input: GraphqlSoupInput): Promise<Page> => {
      if (!input.initial?.filters?.channelFilter)
        return { nextCursor: null, entityIds: [] };
      byIdReads += 1;
      // The second look reaches its limit short of the ids it named: no
      // evidence.
      if (byIdReads > 1) return { nextCursor: 'more', entityIds: [] };
      return { nextCursor: null, entityIds: [] };
    });
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

    await expect(fetchPage(FIRST)).resolves.toMatchObject({ nextCursor: null });
    expect(byIdReads).toBe(2);
    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

    await expect(fetchPage(FIRST)).rejects.toBeInstanceOf(
      ChannelDirectoryPassUnproven
    );
    expect(byIdReads).toBe(3);
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('reads nothing by id after a pass that returned every cached channel', async () => {
    const { host } = reconcileHost(['joined']);
    const fetch = server([{ nextCursor: null, entityIds: ['joined'] }]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );

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
      const fetchPage = await createChannelDirectoryBackfillFetcher(
        'viewer',
        host,
        fetch
      );

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
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch
    );
    await runPass(fetchPage, [FIRST, SECOND, SECOND, THIRD]);

    // Only the removed channel is read by id, the first page was kept: to
    // decide, and once more after its delete.
    expect(namedInReads(fetch)).toEqual(['removed', 'removed']);
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
