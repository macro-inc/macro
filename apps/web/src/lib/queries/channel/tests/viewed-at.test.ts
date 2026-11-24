import { expect, it } from 'vitest';
import { stampCachedChannelView } from '../viewed-at';
import { channelRecord, fakeChannelCache } from './directory-fixtures';

const GENERATION = 'session-1';

function cacheWith(viewedAt: string | null) {
  const cache = fakeChannelCache();
  cache.put(channelRecord('c1', { viewedAt }));
  const viewedAtOf = (id: string) =>
    (cache.records.get(`GraphqlSoupChannel:${id}`)?.record ?? {}).viewedAt;
  return { host: cache.host, viewedAtOf };
}

it('stamps a later view on the cached channel', async () => {
  const { host, viewedAtOf } = cacheWith('2026-11-20T10:00:00Z');

  const stamped = await stampCachedChannelView(
    host,
    'c1',
    '2026-11-20T11:00:00Z',
    GENERATION
  );

  expect(stamped).toBe(true);
  expect(viewedAtOf('c1')).toBe('2026-11-20T11:00:00Z');
  expect(host.writeQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      generation: GENERATION,
      operationName: 'ChannelViewedAtCacheWrite',
    })
  );
});

it('stamps a first view', async () => {
  const { host, viewedAtOf } = cacheWith(null);
  await stampCachedChannelView(host, 'c1', '2026-11-20T11:00:00Z', GENERATION);
  expect(viewedAtOf('c1')).toBe('2026-11-20T11:00:00Z');
});

it('never moves a view back', async () => {
  const { host, viewedAtOf } = cacheWith('2026-11-20T12:00:00Z');
  await stampCachedChannelView(host, 'c1', '2026-11-20T11:00:00Z', GENERATION);
  expect(viewedAtOf('c1')).toBe('2026-11-20T12:00:00Z');
  expect(host.writeQuery).not.toHaveBeenCalled();
});

it('keeps the later of two views stamped at once', async () => {
  const { host, viewedAtOf } = cacheWith('2026-11-20T10:00:00Z');

  // Both read the record before either write lands, unless they take turns.
  await Promise.all([
    stampCachedChannelView(host, 'c1', '2026-11-20T12:00:00Z', GENERATION),
    stampCachedChannelView(host, 'c1', '2026-11-20T11:00:00Z', GENERATION),
  ]);

  expect(viewedAtOf('c1')).toBe('2026-11-20T12:00:00Z');
});

it('stamps the next view after a failed write', async () => {
  const { host, viewedAtOf } = cacheWith('2026-11-20T10:00:00Z');
  host.writeQuery.mockRejectedValueOnce(new Error('cache closed'));

  const [first, second] = await Promise.allSettled([
    stampCachedChannelView(host, 'c1', '2026-11-20T11:00:00Z', GENERATION),
    stampCachedChannelView(host, 'c1', '2026-11-20T12:00:00Z', GENERATION),
  ]);

  expect(first.status).toBe('rejected');
  expect(second).toEqual({ status: 'fulfilled', value: true });
  expect(viewedAtOf('c1')).toBe('2026-11-20T12:00:00Z');
});

it('leaves a channel the cache does not hold alone', async () => {
  const { host } = cacheWith(null);
  const stamped = await stampCachedChannelView(
    host,
    'unknown',
    '2026-11-20T11:00:00Z',
    GENERATION
  );
  expect(stamped).toBe(false);
  expect(host.writeQuery).not.toHaveBeenCalled();
});
