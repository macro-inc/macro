import type {
  CacheGenerationChange,
  CacheHost,
} from '@graphql-cache/host/types';
import { afterEach, expect, it, vi } from 'vitest';
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
vi.mock('../channel-network', () => ({ queryChannelNetwork: network.query }));

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

it('reads the open channels again when the engine is replaced over its storage', () => {
  const { replace, changes } = opened();
  replace('preserved');
  expect(changes).toEqual(['resumed']);
});

it('leaves them to the reset when the storage went too', () => {
  const { replace, changes } = opened();
  replace('reset');
  expect(changes).not.toContain('resumed');
});

it('waits for a paused host to serve again', () => {
  const { replace, changes, availability } = opened();
  availability.paused = true;
  replace('preserved');
  expect(changes).not.toContain('resumed');
});
