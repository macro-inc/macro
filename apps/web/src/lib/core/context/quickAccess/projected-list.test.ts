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
import { exclude } from './types';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
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
    expect(search.mock.calls[0][0].buckets).not.toEqual(
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
        buckets: ['email', 'person', 'crm_company', 'agent_session'],
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
    expect(list.hasMore()).toBe(false);
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
