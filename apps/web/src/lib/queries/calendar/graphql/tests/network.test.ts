import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCached } from '../network';

const query = vi.fn();
const metadata = vi.fn();

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query }),
}));

vi.mock('@graphql-cache/exchange/normalized-cache-exchange', () => ({
  HYDRATE_ONLY_CONTEXT_KEY: 'hydrateOnly',
  normalizedCacheResultMetadata: () => metadata(),
}));

const respond = (result: object) =>
  query.mockReturnValue({ toPromise: () => Promise.resolve(result) });

describe('fetchCached', () => {
  beforeEach(() => {
    query.mockReset();
    metadata.mockReset();
    respond({ data: { ok: true } });
  });

  it('resolves once a foreground write is acknowledged', async () => {
    metadata.mockReturnValue({
      source: 'live-network',
      persistence: Promise.resolve('7'),
    });
    await expect(fetchCached({} as never, {})).resolves.toEqual({ ok: true });
  });

  it('resolves a hydration that reports its revision', async () => {
    metadata.mockReturnValue({ source: 'live-network', revision: '7' });
    await expect(
      fetchCached({} as never, {}, { hydrateOnly: true })
    ).resolves.toEqual({ ok: true });
    expect(query.mock.calls[0]?.[2]).toMatchObject({ hydrateOnly: true });
  });

  it('rejects when the write fails', async () => {
    metadata.mockReturnValue({
      source: 'live-network',
      persistence: Promise.resolve(undefined),
    });
    await expect(fetchCached({} as never, {})).rejects.toThrow(
      'could not be cached'
    );
  });

  it('rejects a response the cache never saw', async () => {
    metadata.mockReturnValue(undefined);
    await expect(fetchCached({} as never, {})).rejects.toThrow(
      'could not be cached'
    );
  });

  it('rejects network errors before reading cache metadata', async () => {
    const error = new Error('offline');
    respond({ error });
    await expect(fetchCached({} as never, {})).rejects.toBe(error);
    expect(metadata).not.toHaveBeenCalled();
  });
});
