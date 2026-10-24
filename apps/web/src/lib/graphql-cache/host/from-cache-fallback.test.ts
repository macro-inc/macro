import { describe, expect, it, vi } from 'vitest';
import { withFromCacheFallback } from './from-cache-fallback';
import type { CacheHost } from './types';

const WITH_FIELD =
  'query Thread { thread { id body @fromCache { html } cached @cacheOnly } }';
const unsupported = new Error(
  'unsupported directive `@fromCache` requires network execution'
);

function hostWith(readQuery: CacheHost['readQuery']) {
  return {
    clientId: 'client',
    readQuery,
    writeQuery: vi.fn(),
    hydrateQuery: vi.fn(),
    search: vi.fn(),
  } as unknown as CacheHost;
}

const queriesOf = (readQuery: ReturnType<typeof vi.fn>) =>
  readQuery.mock.calls.map(([args]) => (args as { query: string }).query);

describe('withFromCacheFallback', () => {
  it('passes documents through to an engine that knows @fromCache', async () => {
    const readQuery = vi.fn(async () => ({ kind: 'miss' as const }));
    const host = withFromCacheFallback(hostWith(readQuery));
    await host.readQuery({ query: WITH_FIELD, variables: {} } as never);
    expect(queriesOf(readQuery)).toEqual([WITH_FIELD]);
  });

  it('removes @fromCache fields once an older engine rejects them', async () => {
    const readQuery = vi
      .fn()
      .mockRejectedValueOnce(unsupported)
      .mockResolvedValue({ kind: 'miss' });
    const host = withFromCacheFallback(hostWith(readQuery));

    await expect(
      host.readQuery({ query: WITH_FIELD, variables: {} } as never)
    ).resolves.toEqual({ kind: 'miss' });
    await host.readQuery({ query: WITH_FIELD, variables: {} } as never);

    const [first, retried, later] = queriesOf(readQuery);
    expect(first).toBe(WITH_FIELD);
    // The engine still gets @cacheOnly, and never @fromCache again.
    for (const query of [retried, later]) {
      expect(query).not.toContain('@fromCache');
      expect(query).not.toContain('body');
      expect(query).toContain('@cacheOnly');
    }
    expect(readQuery).toHaveBeenCalledTimes(3);
  });

  it('leaves other errors and documents alone', async () => {
    const failure = new Error('storage unavailable');
    const readQuery = vi.fn().mockRejectedValue(failure);
    const host = withFromCacheFallback(hostWith(readQuery));
    await expect(
      host.readQuery({ query: WITH_FIELD, variables: {} } as never)
    ).rejects.toBe(failure);
    const plain = 'query Plain { thread { id } }';
    await expect(
      host.readQuery({ query: plain, variables: {} } as never)
    ).rejects.toBe(failure);
    expect(queriesOf(readQuery)).toEqual([WITH_FIELD, plain]);
  });

  it('keeps every other host member', () => {
    const inner = hostWith(vi.fn());
    const host = withFromCacheFallback(inner);
    expect(host.clientId).toBe('client');
    expect(host.search).toBe(inner.search);
  });
});
