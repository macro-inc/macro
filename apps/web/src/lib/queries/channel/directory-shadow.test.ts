import { queryClient } from '@queries/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareCachedDirectoryWithRest,
  shadowCompareChannelDirectory,
  waitForRestChannelList,
} from './directory-shadow';
import { channelKeys } from './keys';
import {
  channelRecord,
  fakeChannelCache,
  restChannel,
} from './tests/directory-fixtures';

const telemetry = vi.hoisted(() => ({
  spans: [] as Array<{ name: string; attrs: Record<string, unknown> }>,
}));
vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Telemetry: {
    error: vi.fn(),
    span: async (
      name: string,
      operation: (span: {
        setAttr: (key: string, value: unknown) => void;
      }) => Promise<unknown>
    ) => {
      const attrs: Record<string, unknown> = {};
      telemetry.spans.push({ name, attrs });
      return operation({
        setAttr: (key, value) => {
          attrs[key] = value;
        },
      });
    },
  },
}));

const FETCHED_AT = Date.parse('2026-11-10T00:00:00Z');

/** A cache with one channel of each kind the comparison tells apart. */
function mixedCache() {
  const cache = fakeChannelCache();
  cache.put(channelRecord('same'));
  cache.put(channelRecord('renamed', { name: 'new name' }));
  cache.put(channelRecord('unjoined', { isParticipant: false }));
  cache.put(channelRecord('extra'));
  // Renamed after the REST list was read: not compared field by field.
  cache.put(
    channelRecord('recent', {
      name: 'renamed since',
      updatedAt: '2026-11-10T00:30:00+00:00',
    })
  );
  cache.put(channelRecord('incomplete'), { incomplete: true });
  const rest = [
    restChannel('same'),
    restChannel('renamed', { name: 'old name' }),
    restChannel('recent'),
    restChannel('missing'),
  ];
  return { cache, rest };
}

function scopedHost(
  cache: ReturnType<typeof fakeChannelCache>,
  viewer: string
) {
  let generation = 'g1';
  return {
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
    },
  };
}

describe('channel directory shadow comparison', () => {
  afterEach(() => {
    telemetry.spans.length = 0;
    queryClient.clear();
    vi.useRealTimers();
  });

  it('counts each kind of difference between the cache and the REST list', async () => {
    const { cache, rest } = mixedCache();

    const summary = await compareCachedDirectoryWithRest(cache.host, {
      channels: rest,
      fetchedAt: FETCHED_AT,
    });

    expect(summary).toEqual({
      restChannels: 4,
      cachedChannels: 6,
      joined: 4,
      unjoined: 1,
      incomplete: 1,
      changedSinceRest: 1,
      differingChannels: 3,
      differences: {
        name: 1,
        extra_in_directory: 1,
        missing_from_directory: 1,
      },
    });
  });

  it('reads a large directory 500 records at a time', async () => {
    const cache = fakeChannelCache();
    const ids = Array.from({ length: 1201 }, (_, index) => `c${index}`);
    for (const id of ids) cache.put(channelRecord(id));

    const summary = await compareCachedDirectoryWithRest(cache.host, {
      channels: ids.map((id) => restChannel(id)),
      fetchedAt: FETCHED_AT,
    });

    expect(summary.differingChannels).toBe(0);
    expect(summary.joined).toBe(1201);
    expect(
      cache.host.readRecordsByKeys.mock.calls.map(([args]) => args.keys.length)
    ).toEqual([500, 500, 201]);
  });

  it('records counts and no channel ids once per viewer', async () => {
    const { cache, rest } = mixedCache();
    const { host } = scopedHost(cache, 'viewer-once');
    const restList = vi.fn(async () => ({
      channels: rest,
      fetchedAt: FETCHED_AT,
    }));
    const scope = { host, userId: 'viewer-once', generation: 'g1' };

    await shadowCompareChannelDirectory(scope, restList);
    await shadowCompareChannelDirectory(scope, restList);

    expect(restList).toHaveBeenCalledOnce();
    expect(telemetry.spans).toHaveLength(1);
    const [{ name, attrs }] = telemetry.spans;
    expect(name).toBe('channel_directory.shadow');
    expect(attrs).toMatchObject({
      'channel_directory.shadow_outcome': 'complete',
      'channel_directory.rest_channels': 4,
      'channel_directory.cached_channels': 6,
      'channel_directory.joined': 4,
      'channel_directory.unjoined': 1,
      'channel_directory.incomplete': 1,
      'channel_directory.changed_since_rest': 1,
      'channel_directory.differing_channels': 3,
      'channel_directory.diff.name': 1,
      'channel_directory.diff.extra_in_directory': 1,
      'channel_directory.diff.missing_from_directory': 1,
    });
    // Counts only: the one string is the outcome, never an id or a name.
    const { ['channel_directory.shadow_outcome']: _outcome, ...counts } = attrs;
    expect(
      Object.values(counts).every((value) => typeof value === 'number')
    ).toBe(true);
  });

  it('records no counts when the cache changed scope during the comparison', async () => {
    const { cache, rest } = mixedCache();
    const harness = scopedHost(cache, 'viewer');
    harness.setGeneration('g2');

    await shadowCompareChannelDirectory(
      { host: harness.host, userId: 'viewer', generation: 'g1' },
      async () => ({ channels: rest, fetchedAt: FETCHED_AT })
    );

    expect(telemetry.spans[0]?.attrs).toEqual({
      'channel_directory.rest_age_ms': expect.any(Number),
      'channel_directory.shadow_outcome': 'scope_changed',
    });
  });

  it('records that the REST list never loaded', async () => {
    const { cache } = mixedCache();
    const { host } = scopedHost(cache, 'viewer-without-rest');

    await shadowCompareChannelDirectory(
      { host, userId: 'viewer-without-rest', generation: 'g1' },
      async () => undefined
    );

    expect(telemetry.spans[0]?.attrs).toEqual({
      'channel_directory.shadow_outcome': 'rest_unavailable',
    });
    expect(cache.host.search).not.toHaveBeenCalled();
  });

  it('waits for the REST list without fetching it', async () => {
    const key = channelKeys.listChannels('viewer').queryKey;
    const waiting = waitForRestChannelList('viewer');
    expect(queryClient.getQueryState(key)).toBeUndefined();

    queryClient.setQueryData(key, [restChannel('a')]);

    const list = await waiting;
    expect(list?.channels.map(({ id }) => id)).toEqual(['a']);
    expect(list?.fetchedAt).toBe(queryClient.getQueryState(key)?.dataUpdatedAt);
  });

  it('gives up when the REST list does not load in time', async () => {
    vi.useFakeTimers();
    const waiting = waitForRestChannelList('viewer', 1000);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(waiting).resolves.toBeUndefined();
  });
});
