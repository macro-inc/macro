import { CombinedError, type OperationResult } from '@urql/core';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const login = vi.hoisted(() => ({ session: 1 }));

vi.mock('@queries/auth/account-scope', () => ({
  queryAccountSession: () => login.session,
}));

import {
  type CatalogReader,
  catalogReadPolicy,
  markCatalogStale,
  noteCatalogResult,
  refreshCatalogReaders,
  registerCatalogReader,
} from './readers';

const answer = (
  key: number,
  source: string | undefined,
  error?: CombinedError
) =>
  ({
    operation: { key },
    data: error ? undefined : { user: {} },
    error,
    extensions:
      source === undefined ? undefined : { __macroNormalizedCache: { source } },
  }) as unknown as OperationResult;

beforeEach(() => {
  login.session = 1;
  vi.useFakeTimers();
  markCatalogStale();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('read freshness', () => {
  it("mounts from the cache alone while the server's answer is fresh", () => {
    expect(catalogReadPolicy(1)).toBe('cache-and-network');
    noteCatalogResult('tags', answer(1, 'live-network'));
    expect(catalogReadPolicy(1)).toBe('cache-first');
    // Another read, and a paused one, still ask the server.
    expect(catalogReadPolicy(2)).toBe('cache-and-network');
    expect(catalogReadPolicy(undefined)).toBe('cache-and-network');

    // Five minutes, as main's TanStack staleTime.
    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    expect(catalogReadPolicy(1)).toBe('cache-first');
    vi.advanceTimersByTime(1);
    expect(catalogReadPolicy(1)).toBe('cache-and-network');
  });

  it('counts only server answers, and a refusal makes the read stale', () => {
    noteCatalogResult('options', answer(1, 'normalized-cache-hit'));
    noteCatalogResult('options', answer(1, 'affected-cache-reread'));
    expect(catalogReadPolicy(1)).toBe('cache-and-network');

    // A client without the cache answers only from the server.
    noteCatalogResult('options', answer(1, undefined));
    expect(catalogReadPolicy(1)).toBe('cache-first');

    // A failure that reached no server leaves it fresh.
    noteCatalogResult(
      'options',
      answer(
        1,
        'live-network',
        new CombinedError({ networkError: new Error('offline') })
      )
    );
    expect(catalogReadPolicy(1)).toBe('cache-first');

    noteCatalogResult(
      'options',
      answer(
        1,
        'normalized-cache-hit',
        new CombinedError({ graphQLErrors: ['not visible'] })
      )
    );
    expect(catalogReadPolicy(1)).toBe('cache-and-network');
  });

  it('is kept per login session', () => {
    noteCatalogResult('tags', answer(1, 'live-network'));
    login.session = 2;
    expect(catalogReadPolicy(1)).toBe('cache-and-network');
    login.session = 1;
    expect(catalogReadPolicy(1)).toBe('cache-first');
  });

  it('marks only the given kinds stale', () => {
    noteCatalogResult('tags', answer(1, 'live-network'));
    noteCatalogResult('options', answer(2, 'live-network'));
    noteCatalogResult('definitions', answer(3, 'live-network'));
    markCatalogStale(['options']);
    expect([1, 2, 3].map(catalogReadPolicy)).toEqual([
      'cache-first',
      'cache-and-network',
      'cache-first',
    ]);
  });
});

describe('refreshCatalogReaders', () => {
  it('sends one request per read and marks unmounted reads of its kinds stale', async () => {
    const refreshed: string[] = [];
    const reader = (
      name: string,
      key: number | undefined,
      kind: 'options' | 'tags' = 'options'
    ): CatalogReader =>
      kind === 'tags'
        ? {
            kind,
            key: () => key,
            definitions: () => [],
            sets: () => [],
            refresh: async () => refreshed.push(name),
          }
        : {
            kind,
            key: () => key,
            propertyDefinitionId: () => name,
            refresh: async () => refreshed.push(name),
          };
    // Read 9 is not mounted; read 7 is the tags list.
    noteCatalogResult('options', answer(9, 'live-network'));
    noteCatalogResult('tags', answer(7, 'live-network'));

    await createRoot(async (dispose) => {
      for (const mounted of [
        reader('a', 1),
        reader('a again', 1),
        reader('b', 2),
        reader('paused', undefined),
        reader('paused again', undefined),
        reader('tags', 7, 'tags'),
      ])
        registerCatalogReader(mounted);
      await refreshCatalogReaders(['options']);
      dispose();
    });

    expect(refreshed).toEqual(['a', 'b', 'paused', 'paused again']);
    expect(catalogReadPolicy(9)).toBe('cache-and-network');
    expect(catalogReadPolicy(7)).toBe('cache-first');
  });
});
