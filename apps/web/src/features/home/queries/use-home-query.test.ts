import type { EmailEntity, EntityData } from '@entity/types/entity';
import type { SoupAstItemsQuery } from '@queries/soup/items';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { soupPageTimestamp } from '@queries/soup/page-timestamp';
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeViewState } from '../types';
import { type HomeDataSource, useHomeDataSource } from './use-home-query';

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  ...(await import('@app/features/soup/collection/row-store')),
  useSearchContext: () => ({
    entityPool: () => () => [],
    routinePool: () => [],
  }),
  createSearchState: (options: { text: () => string }) => ({
    isSearching: () => options.text().trim().length > 0,
    data: () => serviceSearch.hits,
    isLocalSearchSettling: () => false,
    usesServiceSearch: () => serviceSearch.failed,
    isSettling: () => false,
    isLoading: () => false,
    isFetching: () => false,
    hasNextPage: () => false,
    isFetchingNextPage: () => false,
    error: () =>
      serviceSearch.failed ? new Error('search unavailable') : undefined,
  }),
}));
const serviceSearch = vi.hoisted(() => ({
  hits: [] as unknown[],
  failed: false,
}));
// Keep data-only query tests independent of unrelated UI barrel dependencies.
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/notification')),
  ...(await import('@entity/utils/task-properties')),
  ...(await import('@entity/utils/company-properties')),
}));
vi.mock('@notifications', async () => await import('@notifications/types'));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
const workFeedSource = vi.hoisted(() => ({
  enabled: undefined as (() => boolean) | undefined,
  items: () => [] as unknown[],
  entities: () => [] as unknown[],
  loading: false,
  delegate: { canComplete: () => undefined, prepare: () => undefined },
}));
vi.mock('../work-feed/home-work-feed', () => ({
  useWorkFeedHomeDataSource: (
    _state: unknown,
    options: { enabled: () => boolean }
  ) => {
    workFeedSource.enabled = options.enabled;
    return {
      items: () => workFeedSource.items(),
      entities: () => workFeedSource.entities(),
      isLoading: () => workFeedSource.loading,
      isFetching: () => false,
      isLoadingMore: () => false,
      hasMore: () => false,
      error: () => undefined,
      warning: () => undefined,
      loadMore: async () => {},
      refresh: async () => {},
      markDoneDelegate: () => workFeedSource.delegate,
    };
  },
}));
const touch = vi.hoisted(() => ({ device: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => touch.device,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ notificationsByEntity: () => ({}) }),
}));
const viewer = vi.hoisted(() => ({
  id: (() => 'alice') as () => string | undefined,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => viewer.id }));
vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery: vi.fn() }));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

function email(id: string, day: number): EmailEntity {
  const timestamp = new Date(2026, 8, day);
  return {
    type: 'email',
    id,
    name: id,
    ownerId: 'alice',
    isRead: false,
    isDraft: false,
    isImportant: true,
    isSignal: true,
    done: false,
    updatedAt: timestamp,
    notifiedAt: timestamp,
    touchedAt: timestamp,
  };
}

function makeQuery(initial: EntityData[], hasMore = true) {
  const [entities, setEntities] = createSignal(initial);
  const [more, setMore] = createSignal(hasMore);
  const [oldestFetchedTimestamp, setOldestFetchedTimestamp] =
    createSignal<number>();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);
  const fetchNextPage = vi.fn(async () => {});
  const query: SoupAstItemsQuery = {
    get data() {
      if (loading()) throw new Error('Read pending query data');
      return {
        entities: entities(),
        groups: undefined,
        oldestFetchedTimestamp:
          oldestFetchedTimestamp() ??
          soupPageTimestamp(entities(), 'touched_by_me'),
      };
    },
    get isPending() {
      return loading();
    },
    get isLoading() {
      return loading();
    },
    get hasPageData() {
      return !loading();
    },
    get hasNextPage() {
      return more();
    },
    get error() {
      return error();
    },
    isFetching: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    isPlaceholderData: false,
    isEnabled: true,
    transport: 'rest',
    fetchNextPage,
    refetch: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    resetToInitialPage: vi.fn(),
  };
  return {
    query,
    setEntities,
    setMore,
    setLoading,
    setError,
    fetchNextPage,
    setOldestFetchedTimestamp,
  };
}

let dispose: (() => void) | undefined;
function mount(
  notifications: ReturnType<typeof makeQuery>,
  activity: ReturnType<typeof makeQuery>
) {
  vi.mocked(useSoupAstItemsQuery)
    .mockReturnValueOnce(notifications.query)
    .mockReturnValueOnce(activity.query);
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [state, setState] = createStore<HomeViewState>({
      tab: 'signal',
      search: '',
      groupBy: 'none',
      facets: {},
    });
    const source = useHomeDataSource(state);
    return { source, setState };
  });
}
const rows = (source: HomeDataSource) =>
  source.items().flatMap((row) => (row.kind === 'entity' ? [row.entity] : []));
const ids = (source: HomeDataSource) => rows(source).map((row) => row.id);

describe('Home data source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date(2026, 8, 10, 12));
    touch.device = false;
    viewer.id = () => 'alice';
  });
  afterEach(() => {
    dispose?.();
    vi.useRealTimers();
  });

  it('does not buffer the Noise tab behind Home activity', async () => {
    const notifications = makeQuery([email('n9', 9)]);
    const activity = makeQuery([email('a10', 10)]);
    const { source, setState } = mount(notifications, activity);
    setState('tab', 'noise');
    expect(ids(source)).toEqual(['n9']);
    await source.loadMore();
    expect(notifications.fetchNextPage).toHaveBeenCalledOnce();
    expect(activity.fetchNextPage).not.toHaveBeenCalled();
  });

  it('lists Recent without old Home’s saved Status', () => {
    const recent = makeQuery([email('a', 9)]);
    const { source, setState } = mount(recent, makeQuery([]));
    setState({ tab: 'recent', facets: { read: ['read'] } });
    expect(ids(source)).toEqual(['a']);
  });

  // The open row stays selected when the viewer's own activity moves it.
  it('keeps a Recent row’s key as a new touch moves it to a newer section', () => {
    const recent = makeQuery([email('a', 9), email('b', 8)]);
    const { source, setState } = mount(recent, makeQuery([]));
    setState({ tab: 'recent', groupBy: 'date' });
    const keyOf = (id: string) =>
      source
        .items()
        .find((row) => row.kind === 'entity' && row.entity.id === id)?.id;
    const before = keyOf('b');
    expect(before).toBeDefined();

    recent.setEntities([email('b', 10), email('a', 9)]);
    expect(ids(source)).toEqual(['b', 'a']);
    expect(keyOf('b')).toBe(before);
  });
});

describe('Home work feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date(2026, 8, 10, 12));
    touch.device = false;
    workFeedSource.entities = () => [];
    serviceSearch.hits = [];
    serviceSearch.failed = false;
    workFeedSource.loading = false;
    workFeedSource.items = () => [
      {
        kind: 'entity',
        id: 'work-feed-row',
        entity: { type: 'document', id: 'from-work-feed' },
      },
    ];
  });
  afterEach(() => {
    dispose?.();
    vi.useRealTimers();
  });

  it('reads desktop Signal from the work feed and delegates done to it', () => {
    const notifications = makeQuery([email('from-soup', 9)], false);
    const activity = makeQuery([], false);
    const { source } = mount(notifications, activity);

    expect(workFeedSource.enabled?.()).toBe(true);
    expect(ids(source)).toEqual(['from-work-feed']);
    expect(source.markDoneDelegate()).toBe(workFeedSource.delegate);
  });

  it('keeps Noise on the Soup sources and completes searched rows as feed items', () => {
    const notifications = makeQuery([email('from-soup', 9)], false);
    const activity = makeQuery([], false);
    const { source, setState } = mount(notifications, activity);

    setState('tab', 'noise');
    expect(workFeedSource.enabled?.()).toBe(false);
    expect(source.markDoneDelegate()).toBeUndefined();

    setState('tab', 'signal');
    setState('search', 'plan');
    expect(source.markDoneDelegate()).toBe(workFeedSource.delegate);
  });

  it('finds the rows the work feed lists when searching, ahead of other hits', () => {
    workFeedSource.entities = () => [
      { type: 'chat', id: 'feed-chat', name: 'Quarterly plan review' },
      { type: 'document', id: 'feed-task', name: 'Fix login' },
      { type: 'document', id: 'feed-doc', name: 'Hiring plan' },
    ];
    serviceSearch.hits = [
      { ...email('hit-email', 9), name: 'Notes that mention a plan' },
    ];
    const { source, setState } = mount(
      makeQuery([], false),
      makeQuery([], false)
    );

    setState('search', 'plan');

    expect(workFeedSource.enabled?.()).toBe(true);
    expect(ids(source)).toEqual(['feed-chat', 'feed-doc', 'hit-email']);
    expect(source.isLoading()).toBe(false);

    setState('search', '');
    expect(ids(source)).toEqual(['from-work-feed']);
  });

  it('stays loading while a search waits for the feed that holds its matches', () => {
    workFeedSource.entities = () => [];
    workFeedSource.loading = true;
    const { source, setState } = mount(
      makeQuery([], false),
      makeQuery([], false)
    );

    setState('search', 'plan');
    expect(source.isLoading()).toBe(true);

    workFeedSource.loading = false;
    expect(source.isLoading()).toBe(false);
  });

  it('keeps the matching feed rows when the search service fails', () => {
    workFeedSource.entities = () => [
      { type: 'document', id: 'feed-doc', name: 'Hiring plan' },
    ];
    serviceSearch.failed = true;
    const { source, setState } = mount(
      makeQuery([], false),
      makeQuery([], false)
    );

    setState('search', 'plan');
    expect(ids(source)).toEqual(['feed-doc']);
    expect(source.error()).toBeUndefined();

    setState('search', 'absent');
    expect(ids(source)).toEqual([]);
    expect(source.error()).toEqual(new Error('search unavailable'));
  });

  it('searches only the Soup sources where Home is not the work feed', () => {
    touch.device = true;
    workFeedSource.entities = () => [
      { type: 'document', id: 'feed-doc', name: 'Hiring plan' },
    ];
    const { source, setState } = mount(
      makeQuery([], false),
      makeQuery([], false)
    );

    setState('search', 'plan');

    expect(ids(source)).toEqual([]);
  });

  it('keeps touch devices on the notification feed', () => {
    touch.device = true;
    const notifications = makeQuery([email('from-soup', 9)], false);
    const activity = makeQuery([], false);
    const { source } = mount(notifications, activity);

    expect(workFeedSource.enabled?.()).toBe(false);
    expect(ids(source)).toEqual(['from-soup']);
  });

  it('waits for the viewer before querying the notification feed', () => {
    touch.device = true;
    const [userId, setUserId] = createSignal<string>();
    viewer.id = userId;
    const notifications = makeQuery([email('from-soup', 9)], false);
    const activity = makeQuery([], false);
    const { source } = mount(notifications, activity);
    const [args, options] = vi.mocked(useSoupAstItemsQuery).mock.calls[0];

    expect(options?.().enabled).toBe(false);
    expect(JSON.stringify(args().body)).not.toContain('"Participant"');
    expect(source.isLoading()).toBe(true);
    expect(ids(source)).toEqual([]);

    setUserId('macro|alice@example.com');
    expect(options?.().enabled).toBe(true);
    expect(JSON.stringify(args().body.cthf)).toContain(
      '{"Participant":"macro|alice@example.com"}'
    );
    expect(source.isLoading()).toBe(false);
    expect(ids(source)).toEqual(['from-soup']);
  });
});
