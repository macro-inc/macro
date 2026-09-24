import type {
  SearchCacheArgs,
  SearchCachePage,
  SearchDocumentWire,
} from '@graphql-cache/index';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectedList,
  MAX_BROWSE_PAGES_PER_LOAD,
} from './projected-list';
import { type Bucket, exclude } from './types';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

function root<T>(fn: () => T): T {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    return fn();
  });
}
function document(id: string, bucket = 'note'): SearchDocumentWire {
  return {
    profile: 'quick-access-v1',
    recordKey: `GraphqlSoupDocument:${id}`,
    bucket,
    searchText: id,
    timestampMs: 1,
    sourceHash: 'hash',
  };
}
function page(ids: string[], more = false): SearchCachePage {
  return {
    documents: ids.map((id) => document(id)),
    nextCursor: more
      ? { recordKey: `GraphqlSoupDocument:${ids.at(-1)}`, timestampMs: 1 }
      : null,
  };
}
const materialize = async (documents: SearchDocumentWire[]) =>
  documents.map((document) => ({ id: document.recordKey }));
const ids = (count: number, start = 0) =>
  Array.from({ length: count }, (_, i) => `${start + i}`);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Quick Access local projection', () => {
  it('follows the local browse cursor, deduplicates hits, and stops at the last page', async () => {
    const search = vi
      .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
      .mockResolvedValueOnce(page(ids(50), true))
      .mockResolvedValueOnce(page(['49', ...ids(30, 50)]));
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: ['note'],
        revision: () => 0,
        materialize,
      })
    );
    await vi.waitFor(() => expect(list.items()).toHaveLength(50));
    expect(list.hasMore()).toBe(true);
    await list.loadMore();
    expect(search.mock.calls[1][0]).toMatchObject({
      query: '',
      limit: 50,
      cursor: { recordKey: 'GraphqlSoupDocument:49', timestampMs: 1 },
    });
    expect(list.items()).toHaveLength(80);
    expect(list.hasMore()).toBe(false);
    await list.loadMore();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it.each(['search', 'materialize'] as const)(
    'publishes a slow %s during continuous revisions and coalesces a follow-up',
    async (stage) => {
      const [revision, setRevision] = createSignal(0);
      const first = deferred<SearchCachePage>();
      const firstMaterialization = deferred<{ id: string }[]>();
      const followUp = deferred<SearchCachePage>();
      const search = vi
        .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
        .mockReturnValueOnce(
          stage === 'search' ? first.promise : Promise.resolve(page(['first']))
        )
        .mockReturnValueOnce(followUp.promise);
      const project = vi.fn(materialize);
      if (stage === 'materialize')
        project.mockReturnValueOnce(firstMaterialization.promise);
      const list = root(() =>
        createProjectedList({
          host: { search },
          buckets: ['note'],
          revision,
          materialize: project,
        })
      );
      if (stage === 'materialize')
        await vi.waitFor(() => expect(project).toHaveBeenCalledOnce());
      for (let i = 1; i <= 8; i++) setRevision(i);
      expect(search).toHaveBeenCalledOnce();
      first.resolve(page(['first']));
      firstMaterialization.resolve([{ id: 'GraphqlSoupDocument:first' }]);
      await vi.waitFor(() =>
        expect(list.items()).toEqual([{ id: 'GraphqlSoupDocument:first' }])
      );
      expect(search).toHaveBeenCalledTimes(2);
      expect(list.isLoading()).toBe(true);
      followUp.resolve(page(['latest']));
      await vi.waitFor(() => expect(list.isLoading()).toBe(false));
      expect(list.items()).toEqual([{ id: 'GraphqlSoupDocument:latest' }]);
      expect(search).toHaveBeenCalledTimes(2);
    }
  );

  it('commits a load-more page before replaying the enlarged window after hydration', async () => {
    const [revision, setRevision] = createSignal(0);
    const next = deferred<SearchCachePage>();
    const replay = deferred<SearchCachePage>();
    const search = vi
      .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
      .mockResolvedValueOnce(page(['one'], true))
      .mockReturnValueOnce(next.promise)
      .mockReturnValueOnce(replay.promise)
      .mockResolvedValueOnce(page(['two', 'new']));
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: ['note'],
        revision,
        materialize,
      })
    );
    await vi.waitFor(() => expect(list.hasMore()).toBe(true));
    const append = list.loadMore();
    setRevision(1);
    setRevision(2);
    expect(search).toHaveBeenCalledTimes(2);
    next.resolve(page(['two'], true));
    await append;
    expect(list.items()).toHaveLength(2);
    expect(search).toHaveBeenCalledTimes(3);
    expect(search.mock.calls[2][0].cursor).toBeUndefined();
    replay.resolve(page(['one'], true));
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(list.items()).toHaveLength(3);
    expect(search).toHaveBeenCalledTimes(4);
  });

  it.each(['query', 'buckets', 'disable', 'dispose'] as const)(
    'drops a queued refresh and late results on %s changes',
    async (change) => {
      const [revision, setRevision] = createSignal(0);
      const [query, setQuery] = createSignal('old');
      const [buckets, setBuckets] = createSignal<Bucket[]>(['note']);
      const [enabled, setEnabled] = createSignal(true);
      const obsolete = deferred<SearchCachePage>();
      const search = vi
        .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
        .mockReturnValueOnce(obsolete.promise)
        .mockResolvedValue(page(['new']));
      const list = root(() =>
        createProjectedList({
          host: { search },
          get buckets() {
            return buckets();
          },
          revision,
          searchTerm: query,
          enabled,
          materialize,
        })
      );
      setRevision(1);
      expect(search).toHaveBeenCalledOnce();
      if (change === 'query') setQuery('new');
      if (change === 'buckets') setBuckets(['task']);
      if (change === 'disable') setEnabled(false);
      if (change === 'dispose')
        cleanups.splice(0).forEach((cleanup) => cleanup());
      obsolete.resolve(page(['old']));
      const replaced = change === 'query' || change === 'buckets';
      await vi.waitFor(() =>
        expect(list.items()).toEqual(
          replaced ? [{ id: 'GraphqlSoupDocument:new' }] : []
        )
      );
      await obsolete.promise;
      await Promise.resolve();
      expect(search).toHaveBeenCalledTimes(replaced ? 2 : 1);
    }
  );

  it('resets the loaded window and cursor when reactive buckets change', async () => {
    const [buckets, setBuckets] = createSignal<Bucket[]>([
      'note',
      'crm_company',
    ]);
    const refresh = deferred<SearchCachePage>();
    const search = vi
      .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
      .mockResolvedValueOnce(page(['one'], true))
      .mockResolvedValueOnce(page(['two'], true))
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(page(['last']));
    const list = root(() =>
      createProjectedList({
        host: { search },
        get buckets() {
          return buckets();
        },
        revision: () => 0,
        materialize,
      })
    );
    await vi.waitFor(() => expect(list.hasMore()).toBe(true));
    await list.loadMore();
    expect(list.items()).toHaveLength(2);

    setBuckets(['note']);
    expect(list.items()).toEqual([]);
    expect(search.mock.calls[2][0]).toMatchObject({ buckets: ['note'] });
    expect(search.mock.calls[2][0].cursor).toBeUndefined();
    refresh.resolve(page(['new'], true));
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(search).toHaveBeenCalledTimes(3);
    expect(list.items()).toEqual([{ id: 'GraphqlSoupDocument:new' }]);
    await list.loadMore();
    expect(search.mock.calls[3][0].cursor?.recordKey).toBe(
      'GraphqlSoupDocument:new'
    );
    expect(list.items()).toHaveLength(2);
  });

  it('ignores in-flight results for buckets that are no longer enabled', async () => {
    const [buckets, setBuckets] = createSignal<Bucket[]>([
      'crm_company',
      'note',
    ]);
    const pending = deferred<SearchCachePage>();
    const search = vi
      .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page(['note']));
    const list = root(() =>
      createProjectedList({
        host: { search },
        get buckets() {
          return buckets();
        },
        revision: () => 0,
        materialize,
      })
    );
    setBuckets(['note']);
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    pending.resolve({
      documents: [document('company', 'crm_company')],
      nextCursor: null,
    });
    await pending.promise;
    await Promise.resolve();
    expect(list.items()).toEqual([{ id: 'GraphqlSoupDocument:note' }]);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('replays the loaded window after hydration, retaining visible rows while it refreshes', async () => {
    const [revision, setRevision] = createSignal(0);
    const refresh = deferred<SearchCachePage>();
    const search = vi
      .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
      .mockResolvedValueOnce(page(['one'], true))
      .mockResolvedValueOnce(page(['two']))
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(page(['two', 'newly-hydrated']));
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: ['note'],
        revision,
        materialize,
      })
    );
    await vi.waitFor(() => expect(list.hasMore()).toBe(true));
    await list.loadMore();
    setRevision(1);
    expect(list.items()).toHaveLength(2);
    refresh.resolve(page(['one'], true));
    await vi.waitFor(() => expect(list.items()).toHaveLength(3));
    expect(search).toHaveBeenCalledTimes(4);
  });

  it.each([
    { stage: 'search', failurePage: 1 },
    { stage: 'search', failurePage: 2 },
    { stage: 'materialize', failurePage: 1 },
    { stage: 'materialize', failurePage: 2 },
  ])(
    'retains the committed window after $stage fails on replay page $failurePage',
    async ({ stage, failurePage }) => {
      const [revision, setRevision] = createSignal(0);
      let replaying = false;
      let replayPage = 0;
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const search = vi.fn(
        async (args: SearchCacheArgs): Promise<SearchCachePage> => {
          if (replaying) {
            replayPage += 1;
            if (stage === 'search' && replayPage === failurePage)
              throw new Error('cache search unavailable');
            return page([`refreshed-${replayPage}`], true);
          }
          if (!args.cursor) return page(['one'], true);
          if (args.cursor.recordKey === 'GraphqlSoupDocument:one')
            return page(['two'], true);
          if (args.cursor.recordKey === 'GraphqlSoupDocument:two')
            return page(['three']);
          throw new Error('pagination used an uncommitted cursor');
        }
      );
      const list = root(() =>
        createProjectedList({
          host: { search },
          buckets: ['note'],
          revision,
          materialize: async (documents) => {
            if (
              replaying &&
              stage === 'materialize' &&
              replayPage === failurePage
            )
              throw new Error('cache materialization unavailable');
            return materialize(documents);
          },
        })
      );
      await vi.waitFor(() => expect(list.hasMore()).toBe(true));
      await list.loadMore();
      const committedRows = list.items();
      expect(committedRows).toEqual([
        { id: 'GraphqlSoupDocument:one' },
        { id: 'GraphqlSoupDocument:two' },
      ]);

      // Repeated failures must retain the same committed cursor, including when
      // part of a multi-page replay already succeeded before the error.
      replaying = true;
      for (const revision of [1, 2]) {
        replayPage = 0;
        setRevision(revision);
        await vi.waitFor(() => expect(list.isLoading()).toBe(false));
        expect(replayPage).toBe(failurePage);
        expect(list.items()).toBe(committedRows);
        expect(list.hasMore()).toBe(true);
        expect(list.isLoadingMore()).toBe(false);
      }

      replaying = false;
      await list.loadMore();
      expect(search.mock.calls.at(-1)?.[0].cursor).toEqual({
        recordKey: 'GraphqlSoupDocument:two',
        timestampMs: 1,
      });
      expect(list.items()).toEqual([
        ...committedRows,
        { id: 'GraphqlSoupDocument:three' },
      ]);
      expect(list.hasMore()).toBe(false);
    }
  );

  it('does not carry a failed replay cursor into a different query', async () => {
    const [revision, setRevision] = createSignal(0);
    const [query, setQuery] = createSignal('');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const search = vi
      .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
      .mockResolvedValueOnce(page(['old'], true))
      .mockRejectedValueOnce(new Error('replay failed'))
      .mockResolvedValueOnce(page(['new']));
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: ['note'],
        revision,
        searchTerm: query,
        materialize,
      })
    );
    await vi.waitFor(() => expect(list.hasMore()).toBe(true));
    setRevision(1);
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(list.hasMore()).toBe(true);
    setQuery('new');
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(search.mock.calls[2][0].cursor).toBeUndefined();
    expect(list.items()).toEqual([{ id: 'GraphqlSoupDocument:new' }]);
    expect(list.hasMore()).toBe(false);
    await list.loadMore();
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('searches only materializable buckets before applying the limit', async () => {
    const emailHits = Array.from({ length: 500 }, (_, i) =>
      document(`email-${i}`, 'email')
    );
    const search = vi.fn(
      async (args: SearchCacheArgs): Promise<SearchCachePage> => ({
        documents: [...emailHits, document('target')]
          .filter((hit) => args.buckets?.includes(hit.bucket))
          .slice(0, args.limit),
        nextCursor: null,
      })
    );
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: exclude('person'),
        revision: () => 0,
        searchTerm: () => 'target',
        materialize,
      })
    );
    await vi.waitFor(() =>
      expect(list.items()).toEqual([{ id: 'GraphqlSoupDocument:target' }])
    );
    expect(search.mock.calls[0][0].buckets).not.toEqual(
      expect.arrayContaining(['email'])
    );
    expect(search.mock.calls[0][0].buckets).toEqual(
      expect.arrayContaining(['crm_company'])
    );
    expect(search.mock.calls[0][0].buckets).not.toEqual(
      expect.arrayContaining(['agent_session'])
    );
  });

  it('never interprets an unsupported-only list as an all-bucket search', async () => {
    const search = vi.fn();
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: ['email', 'person', 'agent_session'],
        revision: () => 0,
        materialize,
      })
    );
    expect(list.items()).toEqual([]);
    expect(list.hasMore()).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });

  it('continues past incomplete or duplicate pages instead of stranding scroll pagination', async () => {
    const search = vi
      .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
      .mockResolvedValueOnce(page(['incomplete'], true))
      .mockResolvedValueOnce(page(['one'], true))
      .mockResolvedValueOnce(page(['one'], true))
      .mockResolvedValueOnce(page(['two']));
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: ['note'],
        revision: () => 0,
        materialize: async (documents) =>
          materialize(
            documents.filter((doc) => !doc.recordKey.endsWith('incomplete'))
          ),
      })
    );
    await vi.waitFor(() => expect(list.items()).toHaveLength(1));
    await list.loadMore();
    expect(list.items()).toHaveLength(2);
    expect(search).toHaveBeenCalledTimes(4);
  });

  it('bounds incomplete scans, preserves the cursor, and resumes on the next action', async () => {
    const [revision, setRevision] = createSignal(0);
    const search = vi.fn(
      async (args: SearchCacheArgs): Promise<SearchCachePage> => {
        const next = args.cursor
          ? Number(args.cursor.recordKey.split(':')[1]) + 1
          : 1;
        return page([String(next)], true);
      }
    );
    const project = vi.fn(materialize).mockResolvedValue([]);
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: ['note'],
        revision,
        materialize: project,
      })
    );
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(search).toHaveBeenCalledTimes(MAX_BROWSE_PAGES_PER_LOAD);
    expect(list.items()).toEqual([]);
    expect(list.hasMore()).toBe(true);
    setRevision(1);
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(search).toHaveBeenCalledTimes(MAX_BROWSE_PAGES_PER_LOAD * 2);
    await list.loadMore();
    expect(search).toHaveBeenCalledTimes(MAX_BROWSE_PAGES_PER_LOAD * 3);
    expect(list.hasMore()).toBe(true);
    project.mockImplementation(materialize);
    await list.loadMore();
    expect(search.mock.calls.at(-1)?.[0].cursor?.recordKey).toBe(
      `GraphqlSoupDocument:${MAX_BROWSE_PAGES_PER_LOAD * 2}`
    );
    expect(list.items()).toEqual([
      { id: `GraphqlSoupDocument:${MAX_BROWSE_PAGES_PER_LOAD * 2 + 1}` },
    ]);
  });

  it('drops an obsolete in-flight page when the query changes', async () => {
    const [query, setQuery] = createSignal('');
    const obsolete = deferred<SearchCachePage>();
    const search = vi
      .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
      .mockResolvedValueOnce(page(['old'], true))
      .mockReturnValueOnce(obsolete.promise)
      .mockResolvedValueOnce(page(['new']));
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: ['note'],
        revision: () => 0,
        searchTerm: query,
        materialize,
      })
    );
    await vi.waitFor(() => expect(list.items()).toHaveLength(1));
    const loading = list.loadMore();
    setQuery('new');
    expect(list.items()).toEqual([]);
    await vi.waitFor(() =>
      expect(list.items()).toEqual([{ id: 'GraphqlSoupDocument:new' }])
    );
    obsolete.resolve(page(['obsolete']));
    await loading;
    expect(list.items()).toEqual([{ id: 'GraphqlSoupDocument:new' }]);
    expect(search.mock.calls[2][0]).toMatchObject({ query: 'new', limit: 500 });
    expect(search.mock.calls[2][0].cursor).toBeUndefined();
  });

  it('coalesces simultaneous loadMore calls and retains rows on failure', async () => {
    const next = deferred<SearchCachePage>();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const search = vi
      .fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>()
      .mockResolvedValueOnce(page(['one'], true))
      .mockReturnValueOnce(next.promise)
      .mockRejectedValueOnce(new Error('cache unavailable'))
      .mockResolvedValueOnce(page(['three']));
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: ['note'],
        revision: () => 0,
        materialize,
      })
    );
    await vi.waitFor(() => expect(list.hasMore()).toBe(true));
    const pending = list.loadMore();
    expect(list.isLoadingMore()).toBe(true);
    await list.loadMore();
    expect(search).toHaveBeenCalledTimes(2);
    next.resolve(page(['two'], true));
    await pending;
    await list.loadMore();
    expect(list.items()).toHaveLength(2);
    expect(list.isLoadingMore()).toBe(false);
    expect(list.hasMore()).toBe(true);
    await list.loadMore();
    expect(list.items()).toHaveLength(3);
    warning.mockRestore();
  });

  it('disabling and disposing prevent late results from populating a list', async () => {
    const [enabled, setEnabled] = createSignal(true);
    const pending = deferred<SearchCachePage>();
    const search = vi.fn().mockReturnValue(pending.promise);
    const list = root(() =>
      createProjectedList({
        host: { search },
        buckets: ['note'],
        revision: () => 0,
        enabled,
        materialize,
      })
    );
    setEnabled(false);
    pending.resolve(page(['late']));
    await pending.promise;
    expect(list.items()).toEqual([]);
    expect(list.isLoading()).toBe(false);
    expect(list.hasMore()).toBe(false);
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });
});
