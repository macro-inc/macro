import type { ChannelEntity } from '@entity';
import type { SoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  user: (): string | undefined => 'viewer',
  register: vi.fn(),
  query: (
    _ids: Accessor<readonly string[]>,
    _options?: Accessor<{ networkPaused?: boolean }>
  ): SoupAstItemsQuery => {
    throw new Error('Query fixture not installed');
  },
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => runtime.user(),
}));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
}));
vi.mock('@queries/channel/register-notification-refresh', () => ({
  registerChannelNotificationRefresh: runtime.register,
}));
vi.mock('../queries', () => ({
  useChannelsByIdsQuery: (
    ids: Accessor<readonly string[]>,
    options?: Accessor<{ networkPaused?: boolean }>
  ) => runtime.query(ids, options),
  channelsByIdsQueryArgs: (ids: readonly string[]) => ({
    params: { limit: ids.length },
    body: {},
  }),
}));

import { useReferencedChannels } from './referenced-channels';

const disposals: Array<() => void> = [];
const channel = (id: string): ChannelEntity => ({
  id,
  name: id,
  type: 'channel',
  channelType: 'team',
  ownerId: 'viewer',
});

function queryFixture(
  ids: Accessor<readonly string[]>,
  options?: Accessor<{ networkPaused?: boolean }>
) {
  const [state, setState] = createSignal<{
    rows?: ChannelEntity[];
    cacheStatus: SoupAstItemsQuery['cacheStatus'];
    fetching: boolean;
    more: boolean;
    error: Error | null;
    quiet?: boolean;
  }>({ cacheStatus: 'loading', fetching: false, more: false, error: null });
  const refresh = vi.fn(async () => {
    setState((previous) => ({ ...previous, fetching: true, error: null }));
  });
  const query: SoupAstItemsQuery = {
    get data() {
      const rows = state().rows;
      return rows ? { entities: rows, groups: undefined } : undefined;
    },
    get error() {
      return state().quiet ? null : state().error;
    },
    get fetchError() {
      return state().error;
    },
    get cacheStatus() {
      return state().cacheStatus;
    },
    get isPending() {
      return state().rows === undefined && !state().error;
    },
    get isLoading() {
      return query.isPending;
    },
    get isFetching() {
      return state().fetching;
    },
    get hasNextPage() {
      return state().more;
    },
    get isEnabled() {
      return ids().length > 0;
    },
    isPlaceholderData: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    transport: 'graphql',
    fetchNextPage: async () => {},
    refetch: refresh,
    refresh,
    resetToInitialPage: () => {},
  };
  return {
    ids,
    paused: options?.().networkPaused ?? false,
    query,
    setState,
    refresh,
  };
}

let queries: Array<ReturnType<typeof queryFixture>>;
beforeEach(() => {
  queries = [];
  runtime.user = () => 'viewer';
  runtime.register.mockClear();
  runtime.query = (ids, options) => {
    const fixture = queryFixture(ids, options);
    queries.push(fixture);
    return fixture.query;
  };
});
afterEach(() => disposals.splice(0).forEach((dispose) => dispose()));

function setup(ids: string[], loaded: ChannelEntity[] = []) {
  return createRoot((dispose) => {
    disposals.push(dispose);
    const [user, setUser] = createSignal('viewer');
    const [enabled, setEnabled] = createSignal(true);
    runtime.user = user;
    return {
      source: useReferencedChannels(
        () => ids,
        () => loaded,
        enabled
      ),
      setUser,
      setEnabled,
    };
  });
}

it('shows cached rows and requests only missing IDs without restarting pagination', () => {
  const { source } = setup(
    ['cached', 'loaded', 'first', 'last', 'last'],
    [channel('loaded')]
  );
  const [cached, network] = queries;
  expect(cached.paused).toBe(true);
  expect(network.ids()).toEqual([]);
  expect(source.pendingIds()).toEqual(new Set(['cached', 'first', 'last']));
  cached.setState({
    rows: [channel('cached')],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  expect(network.ids()).toEqual(['first', 'last']);
  expect(source.channels().map(({ id }) => id)).toEqual(['cached', 'loaded']);
  network.setState({
    rows: [channel('first')],
    cacheStatus: 'ready',
    fetching: false,
    more: true,
    error: null,
  });
  expect(source.pendingIds()).toEqual(new Set(['last']));
  cached.setState({
    rows: [channel('cached'), channel('first')],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  expect(network.ids()).toEqual(['first', 'last']);
  network.setState({
    rows: [channel('first')],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  expect(source.pendingIds().size).toBe(0);
  expect(source.channels().map(({ id }) => id)).toEqual([
    'cached',
    'first',
    'loaded',
  ]);
});

it('keeps cached rows after a failed request and delegates retry to the query', async () => {
  const { source } = setup(['cached', 'missing']);
  const [cached, network] = queries;
  cached.setState({
    rows: [channel('cached')],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  network.setState({
    rows: [],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: new Error('Unavailable'),
    quiet: true,
  });
  expect(source.channels().map(({ id }) => id)).toEqual(['cached']);
  expect(source.failedIds()).toEqual(new Set(['missing']));
  expect(source.isLoading()).toBe(false);
  await source.retry();
  expect(network.refresh).toHaveBeenCalledOnce();
  expect(source.failedIds().size).toBe(0);
  expect(source.pendingIds()).toEqual(new Set(['missing']));
});

it('falls back to the ordinary query when local predicates are unavailable', () => {
  const { source } = setup(['missing']);
  queries[0].setState({
    cacheStatus: 'unsupported',
    fetching: false,
    more: false,
    error: null,
  });
  expect(queries[1].ids()).toEqual(['missing']);
  queries[1].setState({
    rows: [channel('missing')],
    cacheStatus: 'unsupported',
    fetching: false,
    more: false,
    error: null,
  });
  expect(source.channels().map(({ id }) => id)).toEqual(['missing']);
  expect(source.pendingIds().size).toBe(0);
});

it('bounds cached queries and unread refreshes for more than 500 members', () => {
  const ids = Array.from({ length: 501 }, (_, index) => `channel-${index}`);
  const { source } = setup(ids);
  expect(
    queries.filter(({ paused }) => paused).map(({ ids }) => ids().length)
  ).toEqual([500, 1]);
  for (const cached of queries.filter(({ paused }) => paused)) {
    cached.setState({
      rows: cached.ids().map(channel),
      cacheStatus: 'ready',
      fetching: false,
      more: false,
      error: null,
    });
  }
  expect(source.channels()).toHaveLength(501);
  expect(
    queries
      .filter(({ paused }) => !paused)
      .every(({ ids }) => ids().length === 0)
  ).toBe(true);
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

it('drops old query owners on account and flag changes', () => {
  const { source, setUser, setEnabled } = setup(['member']);
  const old = queries[0];
  old.setState({
    rows: [channel('member')],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  expect(source.channels()).toHaveLength(1);
  setUser('second-viewer');
  expect(source.channels()).toEqual([]);
  old.setState({
    rows: [channel('member')],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  expect(source.channels()).toEqual([]);
  setEnabled(false);
  expect(source.pendingIds().size).toBe(0);
  expect(source.channels()).toEqual([]);
});

it('requests a cached member when the shared cache removes its row', () => {
  const { source } = setup(['member']);
  const [cached, network] = queries;
  cached.setState({
    rows: [channel('member')],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  expect(network.ids()).toEqual([]);
  cached.setState({
    rows: [],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  expect(network.ids()).toEqual(['member']);
  expect(source.pendingIds()).toEqual(new Set(['member']));
});

it('queues invalidated cache members until the current page chain finishes', () => {
  const { source } = setup(['cached', 'first', 'last']);
  const [cached, network] = queries;
  cached.setState({
    rows: [channel('cached')],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  expect(network.ids()).toEqual(['first', 'last']);
  network.setState({
    rows: [channel('first')],
    cacheStatus: 'ready',
    fetching: false,
    more: true,
    error: null,
  });
  cached.setState({
    rows: [],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  expect(network.ids()).toEqual(['first', 'last']);
  expect(source.pendingIds()).toEqual(new Set(['cached', 'last']));
  network.setState({
    rows: [channel('first'), channel('last')],
    cacheStatus: 'ready',
    fetching: false,
    more: false,
    error: null,
  });
  expect(network.ids()).toEqual(['first', 'last', 'cached']);
});
