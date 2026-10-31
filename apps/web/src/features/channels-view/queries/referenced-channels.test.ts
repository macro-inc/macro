import type { ChannelEntity } from '@entity';
import type { CacheHost } from '@graphql-cache/host/types';
import type { CacheRevision } from '@graphql-cache/protocol';
import { type Accessor, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferencedChannelsLookup } from './referenced-channels';

const runtime = vi.hoisted(() => ({
  user: (): string | undefined => 'viewer',
  host: undefined as
    | Pick<
        CacheHost,
        | 'readRecordsByKeys'
        | 'currentRevision'
        | 'onCacheChanged'
        | 'onCacheGenerationChanged'
      >
    | undefined,
  query: (_ids: Accessor<readonly string[]>): ReferencedChannelsLookup => {
    throw new Error('Unexpected network query');
  },
  register: vi.fn(),
}));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => runtime.user(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => runtime.host,
  getGraphqlSoupClient: () => ({}),
  mapGraphqlSoupItem: (record: object) => record,
}));
vi.mock('@queries/soup/transform-utils', () => ({
  mapApiSoupItemToEntity: (record: { id: string; name: string }) => ({
    ...record,
    type: 'channel',
    channelType: 'team',
    ownerId: 'viewer',
  }),
}));
vi.mock('@queries/channel/register-notification-refresh', () => ({
  registerChannelNotificationRefresh: runtime.register,
}));
vi.mock('../queries', () => ({
  channelsByIdsQueryArgs: (ids: readonly string[]) => ({
    params: { limit: ids.length },
    body: {},
  }),
  useChannelsByIdsQuery: (ids: Accessor<readonly string[]>) =>
    runtime.query(ids),
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (_name: string, run?: (span: object) => unknown) => {
      const span = { setAttr: vi.fn(), error: vi.fn(), end: vi.fn() };
      return run ? run(span) : span;
    },
    error: vi.fn(),
  },
}));

import {
  createReferencedChannels,
  useReferencedChannels,
} from './referenced-channels';

const disposals: Array<() => void> = [];
const channel = (id: string, name = id): ChannelEntity => ({
  id,
  name,
  type: 'channel',
  channelType: 'team',
  ownerId: 'viewer',
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function cache(initial: string[] = []) {
  const records = new Map(initial.map((id) => [id, { id, name: id }]));
  let changed = () => {};
  let generationChanged = () => {};
  const host = {
    readRecordsByKeys: vi.fn(async ({ keys }: { keys: string[] }) => ({
      revision: '0' as CacheRevision,
      records: keys.flatMap((key) => {
        const record = records.get(key.slice('GraphqlSoupChannel:'.length));
        return record ? [{ recordKey: key, record }] : [];
      }),
    })),
    currentRevision: async () => '0' as CacheRevision,
    onCacheChanged: vi.fn((callback: () => void) => {
      changed = callback;
      return vi.fn();
    }),
    onCacheGenerationChanged: vi.fn((callback: () => void) => {
      generationChanged = callback;
      return vi.fn();
    }),
  };
  return {
    host,
    records,
    changed: () => changed(),
    reset: () => generationChanged(),
  };
}

function network() {
  const requests: Array<{
    ids: readonly string[];
    publish: (
      data: { entities: ChannelEntity[] } | undefined,
      more?: boolean,
      error?: Error
    ) => void;
  }> = [];
  const query = vi.fn(
    (ids: Accessor<readonly string[]>): ReferencedChannelsLookup => {
      const [state, setState] = createSignal<{
        data?: { entities: ChannelEntity[] };
        error?: Error;
        pending: boolean;
        more: boolean;
      }>({ pending: true, more: false });
      requests.push({
        ids: ids(),
        publish: (data, more = false, error) =>
          setState({ data, error, pending: false, more }),
      });
      return {
        get data() {
          return state().data;
        },
        get error() {
          return state().error ?? null;
        },
        get isPending() {
          return state().pending;
        },
        get isFetching() {
          return state().pending;
        },
        get isPlaceholderData() {
          return false;
        },
        get hasNextPage() {
          return state().more;
        },
      };
    }
  );
  return { query, requests };
}

beforeEach(() => {
  runtime.host = undefined;
  runtime.user = () => 'viewer';
  runtime.register.mockClear();
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

describe('referenced channel hydration', () => {
  it('bounds cache reads and registers unread refreshes even for cache-only members', async () => {
    const ids = Array.from({ length: 501 }, (_, index) => `channel-${index}`);
    const local = cache(ids);
    const remote = network();
    runtime.host = local.host;
    runtime.query = remote.query;
    const state = createRoot((dispose) => {
      disposals.push(dispose);
      return useReferencedChannels(
        () => ids,
        () => [],
        () => true
      );
    });
    await settle();
    expect(state.channels()).toHaveLength(501);
    expect(remote.query).not.toHaveBeenCalled();
    expect(
      local.host.readRecordsByKeys.mock.calls.map(([args]) => args.keys.length)
    ).toEqual([500, 1]);
    const registration = runtime.register.mock.calls[0][0]();
    expect(
      registration.queries.map(
        (query: { variables: { input: { initial: { limit: number } } } }) =>
          query.variables.input.initial.limit
      )
    ).toEqual([500, 1]);
    expect(registration.reader).toMatchObject({
      enabled: true,
      fetching: false,
      filtered: true,
    });
  });

  it('does not restore a removed cached record from an older network snapshot', async () => {
    const local = cache();
    const remote = network();
    const state = createRoot((dispose) => {
      disposals.push(dispose);
      return createReferencedChannels({
        ids: () => ['member'],
        loadedChannels: () => [],
        host: local.host,
        query: remote.query,
      });
    });
    await settle();
    remote.requests[0].publish({ entities: [channel('member')] });
    local.records.set('member', { id: 'member', name: 'member' });
    local.changed();
    await settle();
    local.records.delete('member');
    local.changed();
    await settle();
    expect(state.channels()).toEqual([]);
    expect(remote.requests).toHaveLength(2);
    remote.requests[1].publish({ entities: [] });
    expect(state.pendingIds().size).toBe(0);
    expect(state.channels()).toEqual([]);
  });

  it('shows loaded and cached records before fetching only missing IDs', async () => {
    const local = cache(['cached']);
    const remote = network();
    const state = createRoot((dispose) => {
      disposals.push(dispose);
      return createReferencedChannels({
        ids: () => ['cached', 'loaded', 'missing', 'missing'],
        loadedChannels: () => [channel('loaded')],
        host: local.host,
        query: remote.query,
      });
    });
    expect(state.channels().map((item) => item.id)).toEqual(['loaded']);
    await settle();
    expect(state.channels().map((item) => item.id)).toEqual([
      'cached',
      'loaded',
    ]);
    expect(remote.requests.map((request) => request.ids)).toEqual([
      ['missing'],
    ]);
    expect([...state.pendingIds()]).toEqual(['missing']);
    expect(local.host.onCacheChanged).toHaveBeenCalledWith(
      expect.any(Function),
      { includeHydration: true }
    );

    remote.requests[0].publish({ entities: [channel('missing')] });
    expect(state.channels().map((item) => item.id)).toEqual([
      'cached',
      'loaded',
      'missing',
    ]);
    expect(state.pendingIds().size).toBe(0);
  });

  it('keeps pagination IDs fixed while cache hydration and membership changes arrive', async () => {
    const local = cache();
    const remote = network();
    const [ids, setIds] = createSignal(['first', 'second']);
    const state = createRoot((dispose) => {
      disposals.push(dispose);
      return createReferencedChannels({
        ids,
        loadedChannels: () => [],
        host: local.host,
        query: remote.query,
      });
    });
    await settle();
    remote.requests[0].publish({ entities: [channel('first')] }, true);
    expect(state.channels().map((item) => item.id)).toEqual(['first']);
    expect([...state.pendingIds()]).toEqual(['second']);
    local.records.set('second', { id: 'second', name: 'second' });
    local.changed();
    setIds(['first', 'second', 'third']);
    await settle();
    expect(remote.requests).toHaveLength(1);
    expect(remote.requests[0].ids).toEqual(['first', 'second']);
    expect(state.channels().map((item) => item.id)).toEqual([
      'first',
      'second',
    ]);
    remote.requests[0].publish({
      entities: [channel('first'), channel('second')],
    });
    expect(remote.requests.map((request) => request.ids)).toEqual([
      ['first', 'second'],
      ['third'],
    ]);
    remote.requests[1].publish({ entities: [] });
    local.changed();
    await settle();
    expect(state.pendingIds().size).toBe(0);
    expect(remote.requests).toHaveLength(2);
  });

  it('queues a retry without interrupting another section lookup', async () => {
    const remote = network();
    const [ids, setIds] = createSignal(['failed']);
    const state = createRoot((dispose) => {
      disposals.push(dispose);
      return createReferencedChannels({
        ids,
        loadedChannels: () => [],
        query: remote.query,
      });
    });
    remote.requests[0].publish(undefined, false, new Error('Network failed'));
    setIds(['failed', 'new-member']);
    expect(remote.requests.map((request) => request.ids)).toEqual([
      ['failed'],
      ['new-member'],
    ]);
    await state.retry();
    expect(remote.requests).toHaveLength(2);
    remote.requests[1].publish({ entities: [channel('new-member')] });
    expect(remote.requests.map((request) => request.ids)).toEqual([
      ['failed'],
      ['new-member'],
      ['failed'],
    ]);
  });

  it('retains partial rows after failure and retries unresolved IDs only', async () => {
    const remote = network();
    const state = createRoot((dispose) => {
      disposals.push(dispose);
      return createReferencedChannels({
        ids: () => ['first', 'second'],
        loadedChannels: () => [],
        query: remote.query,
      });
    });
    remote.requests[0].publish({ entities: [channel('first')] }, true);
    const failure = new Error('Network failed');
    remote.requests[0].publish({ entities: [channel('first')] }, true, failure);
    expect(state.channels().map((item) => item.id)).toEqual(['first']);
    expect(state.error()).toBe(failure);
    expect(state.isLoading()).toBe(false);
    await state.retry();
    expect(remote.requests.map((request) => request.ids)).toEqual([
      ['first', 'second'],
      ['second'],
    ]);
    remote.requests[1].publish({ entities: [channel('second')] });
    expect(state.channels().map((item) => item.id)).toEqual([
      'first',
      'second',
    ]);
    expect(state.error()).toBeUndefined();
  });

  it('preserves row identity across unrelated cache writes and resets on generation changes', async () => {
    const local = cache(['cached']);
    const remote = network();
    const state = createRoot((dispose) => {
      disposals.push(dispose);
      return createReferencedChannels({
        ids: () => ['cached'],
        loadedChannels: () => [],
        host: local.host,
        query: remote.query,
      });
    });
    await settle();
    const first = state.channels()[0];
    local.changed();
    await settle();
    expect(state.channels()[0]).toBe(first);
    expect(remote.query).not.toHaveBeenCalled();
    local.records.clear();
    local.reset();
    expect(state.channels()).toEqual([]);
    await settle();
    expect(remote.requests.map((request) => request.ids)).toEqual([['cached']]);
  });

  it('falls back to the network when a cache read fails', async () => {
    const local = cache();
    local.host.readRecordsByKeys.mockRejectedValueOnce(
      new Error('Cache unavailable')
    );
    const remote = network();
    const state = createRoot((dispose) => {
      disposals.push(dispose);
      return createReferencedChannels({
        ids: () => ['missing'],
        loadedChannels: () => [],
        host: local.host,
        query: remote.query,
      });
    });
    await settle();
    expect(remote.requests.map((request) => request.ids)).toEqual([
      ['missing'],
    ]);
    remote.requests[0].publish({ entities: [channel('missing')] });
    expect(state.channels()[0].id).toBe('missing');
  });

  it('isolates account changes and leaves the disabled rollout idle', async () => {
    const remote = network();
    runtime.query = remote.query;
    const [user, setUser] = createSignal<string | undefined>('first-account');
    const [enabled, setEnabled] = createSignal(false);
    runtime.user = user;
    const state = createRoot((dispose) => {
      disposals.push(dispose);
      return useReferencedChannels(
        () => ['member'],
        () => [],
        enabled
      );
    });
    expect(remote.query).not.toHaveBeenCalled();
    setEnabled(true);
    expect(remote.requests).toHaveLength(1);
    setUser('second-account');
    expect(remote.requests).toHaveLength(2);
    remote.requests[0].publish({
      entities: [channel('member', 'Old account')],
    });
    expect(state.channels()).toEqual([]);
    remote.requests[1].publish({
      entities: [channel('member', 'Current account')],
    });
    expect(state.channels()[0].name).toBe('Current account');
    setUser('first-account');
    expect(state.channels()).toEqual([]);
    expect(remote.requests).toHaveLength(3);
    setEnabled(false);
    expect(state.channels()).toEqual([]);
  });
});
