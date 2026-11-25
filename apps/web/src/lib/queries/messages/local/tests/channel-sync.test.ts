import type {
  CacheGenerationChange,
  CacheHost,
} from '@graphql-cache/host/types';
import { afterEach, expect, it, vi } from 'vitest';
import type * as ChannelNetwork from '../channel-network';
import { channelSyncRuntime } from '../channel-sync';
import { CHANNEL_ID, devicePage, fakeHost } from './fixtures';

const network = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => {
    throw new Error('unexpected client');
  },
  getGraphqlSoupCacheHost: () => undefined,
  graphqlCacheEnabled: () => true,
}));
vi.mock('../channel-network', async (importOriginal) => ({
  ...(await importOriginal<typeof ChannelNetwork>()),
  queryChannelNetwork: network.query,
}));

/** A host whose engine is replaced when the test says so. */
function replaceableHost() {
  const listeners = new Set<(change: CacheGenerationChange) => void>();
  const availability = { paused: false };
  const host = Object.defineProperty(
    {
      ...fakeHost(() => devicePage([])),
      onCacheGenerationChanged(listener: (c: CacheGenerationChange) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    'paused',
    { get: () => availability.paused }
  ) as unknown as CacheHost;
  return {
    host,
    availability,
    replace(storage: 'preserved' | 'reset') {
      for (const listener of [...listeners])
        listener({ storage } as CacheGenerationChange);
    },
  };
}

afterEach(() => vi.clearAllMocks());

const opened = () => {
  const fixture = replaceableHost();
  network.query.mockReturnValue(new Promise(() => {}));
  const runtime = channelSyncRuntime(fixture.host);
  const changes: string[] = [];
  runtime.open(CHANNEL_ID);
  runtime.onChanged(CHANNEL_ID, (change) => changes.push(change));
  return { ...fixture, changes };
};

// No push, reset notice or reconnect need follow either.
it.each(['preserved', 'reset'] as const)(
  'reads the open channels again when the engine is replaced, its storage %s',
  (storage) => {
    const { replace, changes } = opened();
    replace(storage);
    expect(changes).toEqual(['resumed']);
  }
);

it('waits for a paused host to serve again', () => {
  const { replace, changes, availability } = opened();
  availability.paused = true;
  replace('preserved');
  replace('reset');
  expect(changes).not.toContain('resumed');
});
