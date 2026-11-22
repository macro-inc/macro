import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import type { GraphqlSoupInput } from '@service-storage/graphql-soup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChannelDirectoryBackfillFetcher } from './directory-reconcile';
import type { ShadowScope } from './directory-shadow';
import { channelRecord, fakeChannelCache } from './tests/directory-fixtures';

const onReconciled = vi.fn(async (_scope: ShadowScope) => {});
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
  sortMethod: 'VIEWED_UPDATED' as const,
  filters: { documentFilter: { literal: { id: 'nil' } } },
};
const FIRST: GraphqlSoupInput = { initial: LANE };

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

/** Lane pages in order, then by-id reads answered from `readable`. */
function server(lanePages: Page[], readable: string[] = []) {
  const pages = [...lanePages];
  return vi.fn(async (input: GraphqlSoupInput): Promise<Page> => {
    const filter = input.initial?.filters?.channelFilter;
    if (filter) {
      const asked = JSON.stringify(filter).match(/"channelId":"([^"]+)"/g);
      const ids = (asked ?? []).map((part) => part.split('"')[3]);
      return {
        nextCursor: null,
        entityIds: ids.filter((id) => readable.includes(id)),
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

const deleted = (host: { deleteRecords: ReturnType<typeof vi.fn> }) =>
  host.deleteRecords.mock.calls.flatMap(([keys]) => keys as string[]);

describe('channel directory reconciliation', () => {
  beforeEach(() => {
    telemetry.error.mockReset();
    onReconciled.mockClear();
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
      fetch,
      onReconciled
    );

    await runPass(fetchPage, [
      FIRST,
      { continuation: { cursor: 'next', expand: true } },
    ]);

    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    expect(onReconciled).toHaveBeenCalledExactlyOnceWith({
      host,
      userId: 'viewer',
      generation: 'g1',
    });
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

  it('reads candidates by id in batches of a hundred', async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `c${index}`);
    const { host } = reconcileHost(ids);
    const fetch = server([{ nextCursor: null, entityIds: [] }], ids);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch,
      onReconciled
    );

    await fetchPage(FIRST);

    const batches = fetch.mock.calls
      .slice(1)
      .map(([input]) => input.initial?.limit);
    expect(batches).toEqual([100, 100, 50]);
    expect(host.deleteRecords).not.toHaveBeenCalled();
    expect(onReconciled).toHaveBeenCalledOnce();
  });

  it('deletes nothing after a resumed pass', async () => {
    const { host } = reconcileHost(['removed']);
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch,
      onReconciled
    );

    await fetchPage({ continuation: { cursor: 'saved', expand: true } });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.deleteRecords).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
  });

  it('deletes nothing when a lane page did not list its channels', async () => {
    const { host } = reconcileHost(['removed']);
    const fetch = server([
      { nextCursor: 'next' },
      { nextCursor: null, entityIds: [] },
    ]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch,
      onReconciled
    );

    await runPass(fetchPage, [
      FIRST,
      { continuation: { cursor: 'next', expand: true } },
    ]);

    expect(host.deleteRecords).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
  });

  it('deletes nothing from a cache that belongs to another viewer', async () => {
    const { host } = reconcileHost(['removed'], 'someone-else');
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch,
      onReconciled
    );

    await fetchPage(FIRST);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.deleteRecords).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
  });

  it('deletes nothing when the storage generation changed during the pass', async () => {
    const harness = reconcileHost(['removed']);
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      harness.host,
      fetch,
      onReconciled
    );

    harness.setGeneration('g2');
    await fetchPage(FIRST);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(harness.host.deleteRecords).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
  });

  it('deletes nothing when a by-id read does not finish in one page', async () => {
    const { host } = reconcileHost(['removed']);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ nextCursor: null, entityIds: [] })
      .mockResolvedValueOnce({ nextCursor: 'more', entityIds: [] });
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch,
      onReconciled
    );

    await fetchPage(FIRST);

    expect(host.deleteRecords).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
  });

  it('still returns the final page when a by-id read fails', async () => {
    const { host } = reconcileHost(['removed']);
    const final = { nextCursor: null, entityIds: [] };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(final)
      .mockRejectedValueOnce(new Error('network'));
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch,
      onReconciled
    );

    await expect(fetchPage(FIRST)).resolves.toBe(final);
    expect(host.deleteRecords).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
    expect(telemetry.error).toHaveBeenCalledTimes(1);
  });

  it('pages without reconciling when the cache cannot be read', async () => {
    const { host } = reconcileHost(['removed']);
    host.search.mockRejectedValueOnce(new Error('engine gone'));
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch,
      onReconciled
    );

    await fetchPage(FIRST);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.deleteRecords).not.toHaveBeenCalled();
    expect(telemetry.error).toHaveBeenCalledTimes(1);
    expect(onReconciled).not.toHaveBeenCalled();
  });

  it('pages without reconciling when the device cache is off', async () => {
    const fetch = server([{ nextCursor: null, entityIds: [] }]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      undefined,
      fetch,
      onReconciled
    );

    await expect(fetchPage(FIRST)).resolves.toEqual({
      nextCursor: null,
      entityIds: [],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onReconciled).not.toHaveBeenCalled();
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
      onReconciled,
      () => session
    );

    await fetchPage(FIRST);

    expect(host.deleteRecords).toHaveBeenCalledExactlyOnceWith(
      ['GraphqlSoupChannel:removed'],
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
        { sourceHash: 'readded-2' }
      );
      readable = ['readded'];
      return { nextCursor: null, entityIds: [] };
    });
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch,
      onReconciled
    );

    await fetchPage(FIRST);

    expect(deleted(host)).toEqual(['GraphqlSoupChannel:removed']);
    expect(byIdReads).toBe(2);
    expect(onReconciled).toHaveBeenCalledOnce();
  });

  it('deletes nothing and skips the comparison when a channel keeps changing under its by-id reads', async () => {
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
      fetch,
      onReconciled
    );

    await fetchPage(FIRST);

    expect(byIdReads).toBe(3);
    expect(host.deleteRecords).not.toHaveBeenCalled();
    expect(onReconciled).not.toHaveBeenCalled();
  });

  it('compares with the REST list after a pass that left nothing to remove', async () => {
    const { host } = reconcileHost(['joined']);
    const fetch = server([{ nextCursor: null, entityIds: ['joined'] }]);
    const fetchPage = await createChannelDirectoryBackfillFetcher(
      'viewer',
      host,
      fetch,
      onReconciled
    );

    await fetchPage(FIRST);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onReconciled).toHaveBeenCalledOnce();
  });
});
