import { createTauriCacheHost } from '@graphql-cache/host/tauri-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createSharedMailBackfillFetcher } from './shared-mail-backfill';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('./graphql-soup', () => ({
  getGraphqlSoupCacheHost: vi.fn(),
  hydrateGraphqlSoup: vi.fn(),
}));
const key = (id: string) => `GraphqlSoupEmailThread:${id}`;
function host() {
  return {
    readQuery: vi.fn(async () => ({
      kind: 'hit',
      data: { user: { id: 'viewer' } },
    })),
    entityFilter: vi.fn<CacheHost['entityFilter']>().mockResolvedValue({
      kind: 'mail-page',
      keys: [key('old'), key('kept')],
      nextCursor: null,
      sortTimestamps: [],
      revision: parseCacheRevision('1'),
      optimistic: false,
    }),
    invalidate: vi.fn(async () => ({ revision: '2', affectedOps: [] })),
    deleteRecords: vi.fn(),
  };
}
const input = { initial: { emailView: 'ALL' as const } };

describe('Shared Mail scope refresh', () => {
  it('continues Shared hydration when an OTA frontend runs on a native binary without entity filtering', async () => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'graphql_cache_init') return null;
      if (command === 'graphql_cache_read')
        return { kind: 'hit', data: { user: { id: 'viewer' } } };
      if (command === 'graphql_cache_entity_filter')
        throw new Error('Command graphql_cache_entity_filter not found');
      throw new Error(`Unexpected native command: ${command}`);
    });
    const cache = createTauriCacheHost({ scope: 'legacy-ios' });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        nextCursor: 'network-next',
        entityIds: ['first'],
      })
      .mockResolvedValueOnce({ nextCursor: null, entityIds: ['second'] });
    try {
      const scan = await createSharedMailBackfillFetcher(
        'viewer',
        cache,
        fetch
      );
      await expect(scan(input)).resolves.toEqual({
        nextCursor: 'network-next',
        entityIds: ['first'],
      });
      const continuation = { continuation: { cursor: 'network-next' } };
      await expect(scan(continuation)).resolves.toEqual({
        nextCursor: null,
        entityIds: ['second'],
      });
      expect(fetch.mock.calls).toEqual([
        [input, undefined],
        [continuation, undefined],
      ]);
      await createSharedMailBackfillFetcher('viewer', cache, fetch);
      expect(
        invokeMock.mock.calls.filter(
          ([command]) => command === 'graphql_cache_entity_filter'
        )
      ).toHaveLength(1);
      expect(
        invokeMock.mock.calls.some(
          ([command]) =>
            command === 'graphql_cache_invalidate' ||
            command === 'graphql_cache_delete_records'
        )
      ).toBe(false);
    } finally {
      cache.dispose();
    }
  });

  it('invalidates missing old proof only after a complete successful scan', async () => {
    const cache = host();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ nextCursor: 'page2', entityIds: ['kept'] })
      .mockResolvedValueOnce({ nextCursor: null, entityIds: ['new'] });
    const scan = await createSharedMailBackfillFetcher(
      'viewer',
      cache as unknown as CacheHost,
      fetch
    );
    await scan(input);
    expect(cache.invalidate).not.toHaveBeenCalled();
    await scan(input);
    expect(cache.invalidate).toHaveBeenCalledExactlyOnceWith([key('old')]);
    expect(cache.deleteRecords).not.toHaveBeenCalled();
  });
  it('preserves last-known facts on failure, incomplete evidence, cancellation and account change', async () => {
    for (const mode of ['failure', 'missing-ids', 'cancel', 'other-viewer']) {
      const cache = host();
      const fetch = vi.fn(async () => {
        if (mode === 'failure') throw new Error('offline');
        if (mode === 'other-viewer')
          cache.readQuery.mockResolvedValue({
            kind: 'hit',
            data: { user: { id: 'other' } },
          });
        return mode === 'missing-ids'
          ? { nextCursor: null }
          : { nextCursor: null, entityIds: [] };
      });
      const scan = await createSharedMailBackfillFetcher(
        'viewer',
        cache as unknown as CacheHost,
        fetch
      );
      const abort = new AbortController();
      if (mode === 'cancel') abort.abort();
      await scan(input, { signal: abort.signal }).catch(() => undefined);
      expect(cache.invalidate).not.toHaveBeenCalled();
    }
  });
  it('hydrates to completion without revoking partial membership after a stale continuation', async () => {
    const cache = host();
    cache.entityFilter
      .mockResolvedValueOnce({
        kind: 'mail-page',
        keys: [key('old')],
        nextCursor: 'local-next',
        sortTimestamps: [],
        revision: parseCacheRevision('1'),
        optimistic: false,
      })
      .mockResolvedValueOnce({
        kind: 'stale-cursor',
        revision: parseCacheRevision('2'),
      });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ nextCursor: 'network-next', entityIds: ['new'] })
      .mockResolvedValueOnce({ nextCursor: null, entityIds: [] });
    const scan = await createSharedMailBackfillFetcher(
      'viewer',
      cache as unknown as CacheHost,
      fetch
    );
    expect(cache.entityFilter.mock.calls[1][0].mail).toEqual({
      view: 'ALL',
      cursor: 'local-next',
    });
    const controller = new AbortController();
    const options = { signal: controller.signal };
    await expect(scan(input, options)).resolves.toEqual({
      nextCursor: 'network-next',
      entityIds: ['new'],
    });
    const continuation = { continuation: { cursor: 'network-next' } };
    await expect(scan(continuation, options)).resolves.toEqual({
      nextCursor: null,
      entityIds: [],
    });
    expect(fetch.mock.calls).toEqual([
      [input, options],
      [continuation, options],
    ]);
    expect(cache.invalidate).not.toHaveBeenCalled();
    expect(cache.deleteRecords).not.toHaveBeenCalled();
  });

  it('a proven empty scope invalidates all old Shared membership', async () => {
    const cache = host();
    const scan = await createSharedMailBackfillFetcher(
      'viewer',
      cache as unknown as CacheHost,
      async () => ({ nextCursor: null, entityIds: [] })
    );
    await scan(input);
    expect(cache.invalidate).toHaveBeenCalledExactlyOnceWith([
      key('old'),
      key('kept'),
    ]);
  });
});
