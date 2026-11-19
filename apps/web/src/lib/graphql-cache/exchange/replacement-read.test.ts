import {
  createClient,
  fetchExchange,
  gql,
  type OperationResult,
} from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { createNoopCacheHost } from '../host/noop-host';
import type {
  AffectedOperationsListener,
  CacheGenerationChange,
  CacheHost,
} from '../host/types';
import {
  parseCacheRevision,
  type QueryUpdate,
  type ReadResult,
} from '../protocol';
import { normalizedCacheExchange } from './normalized-cache-exchange';

const QUERY = gql`query ReplacementRead { user { id } }`;
const OTHER_QUERY = gql`query ReplacementOther { user { id } }`;
type Data = { user: { id: string } };

function setup() {
  const first = Promise.withResolvers<ReadResult>();
  const second = Promise.withResolvers<ReadResult>();
  const firstStarted = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const network = Promise.withResolvers<{ data: Data }>();
  const networkStarted = Promise.withResolvers<void>();
  let generationChanged: ((change: CacheGenerationChange) => void) | undefined;
  let affected: AffectedOperationsListener | undefined;
  const read = vi
    .fn<CacheHost['readQuery']>()
    .mockImplementationOnce(async () => {
      firstStarted.resolve();
      return await first.promise;
    })
    .mockImplementationOnce(async () => {
      secondStarted.resolve();
      return await second.promise;
    })
    .mockResolvedValue({ kind: 'hit', data: { user: { id: 'later-read' } } });
  const fetch = vi.fn(async () => {
    networkStarted.resolve();
    return new Response(JSON.stringify(await network.promise), {
      headers: { 'content-type': 'application/json' },
    });
  });
  const host: CacheHost = {
    ...createNoopCacheHost(),
    disabled: false,
    clientId: 'replacement-read-test',
    async currentStorageGeneration() {
      return '00000000-0000-4000-8000-000000000001';
    },
    readQuery: read,
    onOpsAffected(listener) {
      affected = listener;
      return () => {};
    },
    onCacheGenerationChanged(listener) {
      generationChanged = listener;
      return () => {};
    },
  };
  const onCacheError = vi.fn();
  const client = createClient({
    url: 'https://replacement-read.invalid/graphql',
    fetch,
    exchanges: [normalizedCacheExchange(host, { onCacheError }), fetchExchange],
  });
  return {
    client,
    host,
    read,
    fetch,
    first,
    second,
    firstStarted,
    secondStarted,
    network,
    networkStarted,
    onCacheError,
    affect(key: number) {
      affected?.([key]);
    },
    replace(storage: CacheGenerationChange['storage'] = 'preserved') {
      generationChanged?.({ storage });
    },
  };
}

describe('query reads across engine replacement', () => {
  it.each(['preserved', 'reset'] as const)(
    'delivers a fresh snapshot after a %s generation change',
    async (storage) => {
      const s = setup();
      const pending = s.client.query<Data>(QUERY, {}).toPromise();
      await s.firstStarted.promise;
      s.replace(storage);
      s.first.resolve({
        kind: 'hit',
        data: { user: { id: 'old-generation' } },
      });
      await s.secondStarted.promise;
      s.second.resolve({
        kind: 'hit',
        data: { user: { id: 'current-generation' } },
      });
      expect((await pending).data).toEqual({
        user: { id: 'current-generation' },
      });
      expect(s.read).toHaveBeenCalledTimes(2);
      expect(s.fetch).not.toHaveBeenCalled();
      expect(s.onCacheError).not.toHaveBeenCalled();
    }
  );

  it('retries cache-only reads without forwarding the network', async () => {
    const s = setup();
    const pending = s.client
      .query<Data>(QUERY, {}, { requestPolicy: 'cache-only' })
      .toPromise();
    await s.firstStarted.promise;
    s.replace();
    s.first.resolve({ kind: 'miss' });
    await s.secondStarted.promise;
    s.second.resolve({ kind: 'hit', data: { user: { id: 'current' } } });
    expect((await pending).data).toEqual({ user: { id: 'current' } });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('keeps one cache-and-network request and marks its retried hit stale', async () => {
    const s = setup();
    const cached = Promise.withResolvers<OperationResult<Data>>();
    const source = s.client.query<Data>(
      QUERY,
      {},
      { requestPolicy: 'cache-and-network' }
    );
    const subscription = source.subscribe((result) => {
      if (result.data?.user.id === 'current-cache') cached.resolve(result);
    });
    const pending = source.toPromise();
    try {
      await s.firstStarted.promise;
      await s.networkStarted.promise;
      s.replace();
      s.first.resolve({ kind: 'hit', data: { user: { id: 'old-cache' } } });
      await s.secondStarted.promise;
      s.second.resolve({
        kind: 'hit',
        data: { user: { id: 'current-cache' } },
      });
      expect((await cached.promise).stale).toBe(true);
      s.network.resolve({ data: { user: { id: 'network' } } });
      expect((await pending).data).toEqual({ user: { id: 'network' } });
      expect(s.fetch).toHaveBeenCalledTimes(1);
      expect(s.read).toHaveBeenCalledTimes(2);
    } finally {
      subscription.unsubscribe();
    }
  });

  it.each(['miss', 'error'] as const)(
    'falls back once when the retry returns a %s',
    async (outcome) => {
      const s = setup();
      const pending = s.client.query<Data>(QUERY, {}).toPromise();
      await s.firstStarted.promise;
      s.replace();
      s.first.resolve({ kind: 'hit', data: { user: { id: 'old' } } });
      await s.secondStarted.promise;
      if (outcome === 'miss') s.second.resolve({ kind: 'miss' });
      else s.second.reject(new Error('read failed'));
      await s.networkStarted.promise;
      s.network.resolve({ data: { user: { id: 'network' } } });
      expect((await pending).data).toEqual({ user: { id: 'network' } });
      expect(s.fetch).toHaveBeenCalledTimes(1);
      expect(s.read).toHaveBeenCalledTimes(2);
    }
  );

  it.each(['cache-first', 'cache-only', 'cache-and-network'] as const)(
    'bounds retries during repeated generation changes (%s)',
    async (requestPolicy) => {
      const s = setup();
      const pending = s.client
        .query<Data>(QUERY, {}, { requestPolicy })
        .toPromise();
      await s.firstStarted.promise;
      s.replace();
      s.first.resolve({ kind: 'hit', data: { user: { id: 'old-first' } } });
      await s.secondStarted.promise;
      s.replace();
      s.second.resolve({ kind: 'hit', data: { user: { id: 'old-second' } } });
      if (requestPolicy === 'cache-only') {
        expect((await pending).data).toBeUndefined();
        expect(s.fetch).not.toHaveBeenCalled();
      } else {
        await s.networkStarted.promise;
        s.network.resolve({ data: { user: { id: 'network' } } });
        expect((await pending).data).toEqual({ user: { id: 'network' } });
        expect(s.fetch).toHaveBeenCalledTimes(1);
      }
      expect(s.read).toHaveBeenCalledTimes(2);
    }
  );

  it('does not forward a replacement-registration-only read when retrying is exhausted', async () => {
    const s = setup();
    const results: OperationResult<Data>[] = [];
    const subscription = s.client
      .query<Data>(
        QUERY,
        {},
        {
          normalizedCacheReplacementRegistrationOnly: true,
        }
      )
      .subscribe((result) => results.push(result));
    try {
      await s.firstStarted.promise;
      s.replace();
      s.first.resolve({ kind: 'miss' });
      await s.secondStarted.promise;
      s.replace();
      s.second.resolve({ kind: 'miss' });
      // A later successful read also lets the earlier reply finish processing.
      await s.client.query<Data>(OTHER_QUERY, {}).toPromise();
      expect(s.fetch).not.toHaveBeenCalled();
      expect(results).toEqual([]);
      expect(s.read).toHaveBeenCalledTimes(3);
    } finally {
      subscription.unsubscribe();
    }
  });

  it('does not resurrect a torn-down query when its key is reused', async () => {
    const s = setup();
    const oldResults: OperationResult<Data>[] = [];
    const subscription = s.client
      .query<Data>(QUERY, {})
      .subscribe((result) => oldResults.push(result));
    await s.firstStarted.promise;
    s.replace();
    subscription.unsubscribe();
    s.first.resolve({ kind: 'hit', data: { user: { id: 'retired' } } });
    const current = s.client.query<Data>(QUERY, {}).toPromise();
    await s.secondStarted.promise;
    s.second.resolve({ kind: 'hit', data: { user: { id: 'remounted' } } });
    expect((await current).data).toEqual({ user: { id: 'remounted' } });
    expect(oldResults).toEqual([]);
    expect(s.read).toHaveBeenCalledTimes(2);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('restarts a watched snapshot without reusing the old cursor', async () => {
    const s = setup();
    const started = Promise.withResolvers<void>();
    const stale = Promise.withResolvers<QueryUpdate>();
    const watch = vi
      .fn<NonNullable<CacheHost['watchQuery']>>()
      .mockImplementationOnce(async () => {
        started.resolve();
        return await stale.promise;
      })
      .mockResolvedValue({
        kind: 'hit',
        revision: parseCacheRevision('2'),
        data: { user: { id: 'current' } },
      });
    s.host.watchQuery = watch;
    const pending = s.client.query<Data>(QUERY, {}).toPromise();
    await started.promise;
    s.replace();
    stale.resolve({
      kind: 'hit',
      revision: parseCacheRevision('1'),
      data: { user: { id: 'old' } },
    });
    expect((await pending).data).toEqual({ user: { id: 'current' } });
    expect(watch).toHaveBeenCalledTimes(2);
    expect(watch.mock.calls[1]?.[0].since).toBeUndefined();
    expect(s.read).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('delivers an affected watched read interrupted by replacement', async () => {
    const s = setup();
    const initial = Promise.withResolvers<void>();
    const updated = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const stale = Promise.withResolvers<QueryUpdate>();
    let key = 0;
    const watch = vi
      .fn<NonNullable<CacheHost['watchQuery']>>()
      .mockImplementationOnce(async (args) => {
        key = args.opKey;
        return {
          kind: 'hit',
          revision: parseCacheRevision('1'),
          data: { user: { id: 'initial' } },
        };
      })
      .mockImplementationOnce(async () => {
        started.resolve();
        return await stale.promise;
      })
      .mockResolvedValue({
        kind: 'hit',
        revision: parseCacheRevision('3'),
        data: { user: { id: 'current' } },
      });
    s.host.watchQuery = watch;
    const ids: (string | undefined)[] = [];
    const subscription = s.client.query<Data>(QUERY, {}).subscribe((result) => {
      ids.push(result.data?.user.id);
      if (result.data?.user.id === 'initial') initial.resolve();
      if (result.data?.user.id === 'current') updated.resolve();
    });
    try {
      await initial.promise;
      s.affect(key);
      await started.promise;
      s.replace();
      stale.resolve({
        kind: 'hit',
        revision: parseCacheRevision('2'),
        data: { user: { id: 'old' } },
      });
      await updated.promise;
      expect(ids).toEqual(['initial', 'current']);
      expect(watch).toHaveBeenCalledTimes(3);
      expect(s.fetch).not.toHaveBeenCalled();
      expect(s.onCacheError).not.toHaveBeenCalled();
    } finally {
      subscription.unsubscribe();
    }
  });

  it('bounds affected-read retries before normal policy fallback', async () => {
    const s = setup();
    const initial = Promise.withResolvers<void>();
    const updated = Promise.withResolvers<void>();
    const firstStarted = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const first = Promise.withResolvers<QueryUpdate>();
    const second = Promise.withResolvers<QueryUpdate>();
    let key = 0;
    const watch = vi
      .fn<NonNullable<CacheHost['watchQuery']>>()
      .mockImplementationOnce(async (args) => {
        key = args.opKey;
        return {
          kind: 'hit',
          revision: parseCacheRevision('1'),
          data: { user: { id: 'initial' } },
        };
      })
      .mockImplementationOnce(async () => {
        firstStarted.resolve();
        return await first.promise;
      })
      .mockImplementationOnce(async () => {
        secondStarted.resolve();
        return await second.promise;
      })
      .mockResolvedValue({ kind: 'miss', revision: parseCacheRevision('4') });
    s.host.watchQuery = watch;
    const ids: (string | undefined)[] = [];
    const subscription = s.client.query<Data>(QUERY, {}).subscribe((result) => {
      ids.push(result.data?.user.id);
      if (result.data?.user.id === 'initial') initial.resolve();
      if (result.data?.user.id === 'network') updated.resolve();
    });
    try {
      await initial.promise;
      s.affect(key);
      await firstStarted.promise;
      s.replace();
      first.resolve({
        kind: 'hit',
        revision: parseCacheRevision('2'),
        data: { user: { id: 'invalidated' } },
      });
      await secondStarted.promise;
      s.replace();
      second.resolve({
        kind: 'hit',
        revision: parseCacheRevision('3'),
        data: { user: { id: 'invalidated' } },
      });
      await s.networkStarted.promise;
      s.network.resolve({ data: { user: { id: 'network' } } });
      await updated.promise;
      expect(ids).not.toContain('invalidated');
      expect(s.fetch).toHaveBeenCalledTimes(1);
      expect(watch).toHaveBeenCalledTimes(4);
    } finally {
      subscription.unsubscribe();
    }
  });

  it('discards a retry after teardown and remount of the same key', async () => {
    const s = setup();
    const oldResults: OperationResult<Data>[] = [];
    const subscription = s.client
      .query<Data>(QUERY, {})
      .subscribe((result) => oldResults.push(result));
    await s.firstStarted.promise;
    s.replace();
    s.first.resolve({ kind: 'hit', data: { user: { id: 'old' } } });
    await s.secondStarted.promise;
    subscription.unsubscribe();
    s.second.resolve({ kind: 'hit', data: { user: { id: 'old-retry' } } });
    s.read.mockResolvedValue({
      kind: 'hit',
      data: { user: { id: 'remounted' } },
    });
    const result = await s.client.query<Data>(QUERY, {}).toPromise();
    expect(result.data).toEqual({ user: { id: 'remounted' } });
    expect(oldResults).toEqual([]);
    expect(s.read).toHaveBeenCalledTimes(3);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('does not retry over a newer network result', async () => {
    const s = setup();
    const delivered = Promise.withResolvers<void>();
    const results: OperationResult<Data>[] = [];
    const subscription = s.client
      .query<Data>(QUERY, {}, { requestPolicy: 'cache-and-network' })
      .subscribe((result) => {
        results.push(result);
        if (result.data?.user.id === 'network') delivered.resolve();
      });
    try {
      await s.firstStarted.promise;
      s.replace();
      s.first.resolve({ kind: 'hit', data: { user: { id: 'old-first' } } });
      await s.secondStarted.promise;
      s.network.resolve({ data: { user: { id: 'network' } } });
      await delivered.promise;
      s.replace();
      s.second.resolve({ kind: 'hit', data: { user: { id: 'old-retry' } } });
      await s.client.query<Data>(OTHER_QUERY, {}).toPromise();
      expect(results.map((result) => result.data)).toEqual([
        { user: { id: 'network' } },
      ]);
      expect(s.read).toHaveBeenCalledTimes(3);
      expect(s.fetch).toHaveBeenCalledTimes(1);
    } finally {
      subscription.unsubscribe();
    }
  });
});
