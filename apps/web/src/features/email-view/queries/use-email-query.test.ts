import type { EmailEntity } from '@entity/types/entity';
import {
  type SoupAstItemsQuery,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import type { useSearchSoupQuery } from '@queries/soup/search';
import { batch, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailTab, EmailViewState } from '../types';
import { buildEmailQuery } from './email-query';
import {
  type EmailDataSource,
  type EmailDataSourceItem,
  useEmailDataSource,
} from './use-email-query';

const searchQueryMock = vi.hoisted(() => vi.fn());
const favoritesQueryMock = vi.hoisted(() => vi.fn());
vi.mock('@queries/favorites/favorites', () => ({
  useFavoritesQuery: favoritesQueryMock,
}));
const scheduledRows = vi.hoisted(() => ({
  current: [] as EmailDataSourceItem[],
}));

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  ...(await import('@app/features/soup/search/create-search-state')),
}));
// Exercise query transitions without loading UI barrels or the local-search provider.
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/notification')),
  ...(await import('@entity/utils/task-properties')),
  ...(await import('@entity/utils/company-properties')),
}));
vi.mock('@app/features/soup/search/context', () => ({
  useOptionalSearchContext: () => undefined,
}));
vi.mock('@notifications', async () => await import('@notifications/types'));
vi.mock('@queries/soup/search', () => ({
  validateSearchServiceText: (text: string) => text.length >= 3,
  useSearchSoupQuery: searchQueryMock,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ notificationsByEntity: () => ({}) }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery: vi.fn() }));
vi.mock('./use-scheduled-email-source', () => ({
  useScheduledEmailSource: () => ({
    items: () => scheduledRows.current,
    isLoading: () => false,
    isFetching: () => false,
    error: () => undefined,
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
    refresh: async () => {},
  }),
}));
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

function email(id: string): EmailEntity {
  return {
    type: 'email',
    id,
    name: id,
    ownerId: 'alice',
    linkId: 'inbox-a',
    isRead: false,
    isDraft: false,
    isImportant: true,
    done: false,
    updatedAt: new Date('2026-09-21T12:00:00Z'),
  };
}

const ids = (source: EmailDataSource) =>
  source
    .items()
    .flatMap((row) => (row.kind === 'entity' ? [row.entity.id] : []));

let dispose: (() => void) | undefined;
function mount(search = '') {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [state, setState] = createStore<EmailViewState>({
      tab: 'noise',
      search,
      inboxIds: ['inbox-a'],
      facets: {},
      collapsedSidebarSectionIds: [],
    });
    const [entities, setDiscoveryEntities] = createSignal([email('noise')]);
    const [retainedEntities, setRetainedEntities] = createSignal([
      email('noise'),
    ]);
    const [retentionLoading, setRetentionLoading] = createSignal(false);
    const setEntities = (rows: EmailEntity[]) =>
      batch(() => {
        setDiscoveryEntities(rows);
        setRetainedEntities(rows);
      });
    const [loading, setLoading] = createSignal(false);
    const [placeholder, setPlaceholder] = createSignal(false);
    const [fetching, setFetching] = createSignal(false);
    const [tagSetsReady, setTagSetsReady] = createSignal(true);
    const [favoriteIds, setFavoriteIds] = createSignal<string[] | undefined>(
      []
    );
    const [favoritesError, setFavoritesError] = createSignal<Error>();
    favoritesQueryMock.mockReturnValue({
      get isSuccess() {
        return favoriteIds() !== undefined && !favoritesError();
      },
      get isError() {
        return !!favoritesError();
      },
      get error() {
        return favoritesError();
      },
      get data() {
        if (favoriteIds() === undefined)
          throw new Error('Read pending favorites');
        return { favorites: favoriteIds()!.map((entityId) => ({ entityId })) };
      },
      refetch: vi.fn(async () => {}),
    });
    const [searchEntities, setSearchDiscoveryEntities] = createSignal([
      email('search'),
    ]);
    const [retainedSearchEntities, setRetainedSearchEntities] = createSignal([
      email('search'),
    ]);
    const setSearchEntities = (rows: EmailEntity[]) =>
      batch(() => {
        setSearchDiscoveryEntities(rows);
        setRetainedSearchEntities(rows);
      });
    const searchRefetch = vi.fn(async () => {});
    const retainedSearchRefetch = vi.fn(async () => {});
    let searchCount = 0;
    searchQueryMock.mockImplementation(
      (
        _args: Parameters<typeof useSearchSoupQuery>[0],
        options: Parameters<typeof useSearchSoupQuery>[1]
      ) => {
        const discovery = searchCount++ === 0;
        return {
          get data() {
            if (!discovery && retentionLoading())
              throw new Error('Read pending retained search');
            return discovery ? searchEntities() : retainedSearchEntities();
          },
          get isEnabled() {
            return options?.().enabled ?? true;
          },
          get isSuccess() {
            return discovery || !retentionLoading();
          },
          isPlaceholderData: false,
          isFetching: false,
          isFetchingNextPage: false,
          hasNextPage: true,
          error: null,
          refetch: discovery ? searchRefetch : retainedSearchRefetch,
        };
      }
    );
    const query: SoupAstItemsQuery = {
      get data() {
        if (loading()) throw new Error('Read pending query data');
        return { entities: entities(), groups: undefined };
      },
      get isLoading() {
        return loading();
      },
      get isPlaceholderData() {
        return placeholder();
      },
      get isFetching() {
        return fetching();
      },
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      isEnabled: true,
      transport: 'graphql',
      fetchNextPage: vi.fn(async () => {}),
      refetch: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      resetToInitialPage: vi.fn(),
    };
    let listCount = 0;
    vi.mocked(useSoupAstItemsQuery).mockImplementation(() => {
      if (listCount++ === 0) return query;
      return {
        isFetching: false,
        error: null,
        hasNextPage: false,
        isFetchingNextPage: false,
        isEnabled: true,
        transport: 'graphql',
        fetchNextPage: vi.fn(async () => {}),
        refetch: vi.fn(async () => {}),
        refresh: vi.fn(async () => {}),
        resetToInitialPage: vi.fn(),
        get data() {
          if (retentionLoading()) throw new Error('Read pending retained mail');
          return { entities: retainedEntities(), groups: undefined };
        },
        get isLoading() {
          return retentionLoading();
        },
        isPlaceholderData: false,
      };
    });
    const source = useEmailDataSource(state, {
      tagSets: () => [],
      tagSetsReady,
    });
    return {
      source,
      query,
      setState,
      setEntities,
      setDiscoveryEntities,
      setRetainedEntities,
      setRetentionLoading,
      setLoading,
      setPlaceholder,
      setFetching,
      setTagSetsReady,
      setFavoriteIds,
      setFavoritesError,
      searchEntities,
      setSearchEntities,
      setSearchDiscoveryEntities,
      setRetainedSearchEntities,
      searchRefetch,
      retainedSearchRefetch,
    };
  });
}

describe('Email list query transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    favoritesQueryMock.mockReturnValue({
      isSuccess: true,
      isError: false,
      data: { favorites: [] },
      error: null,
      refetch: vi.fn(async () => {}),
    });
    scheduledRows.current = [];
  });
  afterEach(() => dispose?.());

  it('waits for favorites and uses only their IDs in the Soup query', () => {
    const { source, setState, setEntities, setFavoriteIds } = mount();
    setFavoriteIds(undefined);
    setState('tab', 'favorites');
    setEntities([email('starred'), email('ordinary')]);
    expect(source.isLoading()).toBe(true);
    expect(ids(source)).toEqual([]);
    expect(vi.mocked(useSoupAstItemsQuery).mock.calls[0][1]?.().enabled).toBe(
      false
    );
    setFavoriteIds(['starred']);
    expect(source.isLoading()).toBe(false);
    expect(ids(source)).toEqual(['starred']);
    expect(vi.mocked(useSoupAstItemsQuery).mock.calls[0][1]?.().enabled).toBe(
      true
    );
    expect(
      vi.mocked(useSoupAstItemsQuery).mock.calls[0][0]().transport
    ).toBeUndefined();
    expect(
      JSON.stringify(vi.mocked(useSoupAstItemsQuery).mock.calls[0][0]().body.ef)
    ).toContain('starred');
    expect(favoritesQueryMock).toHaveBeenCalledWith({
      entityType: ['email_thread'],
    });
    setFavoriteIds([]);
    expect(ids(source)).toEqual([]);
  });

  it('surfaces a favorites failure without an endless loading state', () => {
    const { source, setState, setFavoriteIds, setFavoritesError } = mount();
    setFavoriteIds(undefined);
    setState('tab', 'favorites');
    const error = new Error('Favorites unavailable');
    setFavoritesError(error);
    expect(source.error()).toBe(error);
    expect(source.isLoading()).toBe(false);
    expect(ids(source)).toEqual([]);
  });

  it('lists the scheduled source on the Scheduled tab instead of soup rows', () => {
    scheduledRows.current = [
      {
        kind: 'entity',
        id: 'scheduled-row',
        entity: {
          ...email('scheduled'),
          isDraft: true,
          scheduledSendTime: '2026-09-27T12:00:00Z',
        },
      } as EmailDataSourceItem,
    ];
    const { source, setState } = mount();
    expect(ids(source)).toEqual(['noise']);

    setState('tab', 'scheduled');
    expect(ids(source)).toEqual(['scheduled']);
    expect(source.hasMore()).toBe(false);

    setState('tab', 'noise');
    expect(ids(source)).toEqual(['noise']);
  });

  it('does not show Noise rows under other tabs while their cache reads are pending', () => {
    const { source, setState, setEntities, setLoading } = mount();
    expect(ids(source)).toEqual(['noise']);

    for (const tab of ['important', 'sent', 'all'] satisfies EmailTab[]) {
      batch(() => {
        setState('tab', tab);
        setLoading(true);
      });
      expect(ids(source)).toEqual([]);
      expect(source.isLoading()).toBe(true);
      expect(source.hasMore()).toBe(false);
      expect(source.items()).toEqual([]);
    }

    batch(() => {
      setEntities([email('all')]);
      setLoading(false);
    });
    expect(ids(source)).toEqual(['all']);
    expect(source.isLoading()).toBe(false);
    expect(source.hasMore()).toBe(true);
  });

  it('does not keep rows from the previous inbox while the new inbox loads', () => {
    const { source, setState, setLoading, setEntities } = mount();
    expect(ids(source)).toEqual(['noise']);
    batch(() => {
      setState('inboxIds', ['inbox-b']);
      setLoading(true);
    });
    expect(ids(source)).toEqual([]);
    expect(source.isLoading()).toBe(true);
    batch(() => {
      setEntities([]);
      setLoading(false);
    });
    expect(ids(source)).toEqual([]);
    expect(source.isLoading()).toBe(false);
  });

  it('treats REST previous-query placeholders as loading, not current results', () => {
    const { source, setState, setPlaceholder } = mount();
    expect(ids(source)).toEqual(['noise']);
    batch(() => {
      setState('tab', 'sent');
      setPlaceholder(true);
    });
    expect(ids(source)).toEqual([]);
    expect(source.isLoading()).toBe(true);
    expect(source.hasMore()).toBe(false);
  });

  it('filters discovery before pagination while retaining a newly read row across refresh', () => {
    const {
      source,
      setState,
      setEntities,
      setDiscoveryEntities,
      setRetainedEntities,
    } = mount();
    batch(() => {
      setState('facets', { read: ['unread'], done: ['not-done'] });
      setEntities([
        email('before'),
        email('focused'),
        { ...email('already-read'), isRead: true },
        email('after'),
      ]);
    });
    expect(ids(source)).toEqual(['before', 'focused', 'after']);

    const queryArgs = vi.mocked(useSoupAstItemsQuery).mock.calls[0][0];
    expect(queryArgs()).toEqual(
      buildEmailQuery({
        tab: 'noise',
        inboxIds: ['inbox-a'],
        facets: { read: ['unread'], done: ['not-done'] },
        facetContext: { tagPropertyDefinitionByOptionId: new Map() },
      })
    );

    // Both the optimistic response and the subsequent full server page keep
    // the newly read row, in place, without admitting previously read mail.
    const refreshed = [
      email('before'),
      { ...email('focused'), isRead: true },
      { ...email('already-read'), isRead: true },
      email('after'),
    ];
    setEntities(refreshed);
    expect(ids(source)).toEqual(['before', 'focused', 'after']);
    setDiscoveryEntities(refreshed.filter((entity) => !entity.isRead));
    expect(ids(source)).toEqual(['before', 'focused', 'after']);
    const lookups = vi.mocked(useSoupAstItemsQuery).mock.calls.slice(1);
    expect(lookups.length).toBeGreaterThan(0);
    expect(JSON.stringify(lookups[0][0]().body.ef)).not.toContain('"Read"');
    expect(JSON.stringify(lookups[0][0]().body.ef)).toContain('focused');

    // Confirmed archive/trash exclusion drops the row, despite its snapshot.
    setRetainedEntities(refreshed.filter((entity) => entity.id !== 'focused'));
    expect(ids(source)).toEqual(['before', 'after']);
  });

  it('discovers unread mail after 100 read threads and paginates only unread discovery', async () => {
    const { source, query, setState, setEntities } = mount();
    setEntities([]);
    setState('facets', { read: ['unread'] });
    const mailbox = [
      ...Array.from({ length: 100 }, (_, index) => ({
        ...email(`read-${index}`),
        isRead: true,
      })),
      ...Array.from({ length: 205 }, (_, index) => email(`unread-${index}`)),
    ];
    const args = vi.mocked(useSoupAstItemsQuery).mock.calls[0][0];
    // A server fixture applies the transmitted predicate before its page limit.
    const matching = JSON.stringify(args().body.ef).includes('"Read":false')
      ? mailbox.filter((email) => !email.isRead)
      : mailbox;
    setEntities(matching.slice(0, 100));
    expect(ids(source)).toEqual(
      matching.slice(0, 100).map((email) => email.id)
    );
    expect(ids(source)[0]).toBe('unread-0');
    vi.mocked(query.fetchNextPage).mockImplementation(async () => {
      setEntities(matching);
    });
    await source.loadMore();
    expect(ids(source)).toHaveLength(205);
    expect(query.fetchNextPage).toHaveBeenCalledOnce();
    const lookupArgs = vi
      .mocked(useSoupAstItemsQuery)
      .mock.calls.slice(1)
      .map(([args]) => args());
    expect(lookupArgs).toHaveLength(3);
    expect(lookupArgs.every((args) => args.params.limit === 100)).toBe(true);
    expect(
      lookupArgs.map(
        (args) =>
          (JSON.stringify(args.body.ef).match(/"ThreadId"/g) ?? []).length
      )
    ).toEqual([100, 100, 5]);
  });

  it('retains read search hits through a filtered search refresh using ID-scoped readless lookups', async () => {
    const {
      source,
      setState,
      setSearchDiscoveryEntities,
      setRetainedSearchEntities,
      searchRefetch,
      retainedSearchRefetch,
    } = mount('invoice');
    setState('facets', { read: ['unread'] });
    expect(ids(source)).toEqual(['search']);
    batch(() => {
      setSearchDiscoveryEntities([]);
      setRetainedSearchEntities([{ ...email('search'), isRead: true }]);
    });
    await source.refresh();
    expect(ids(source)).toEqual(['search']);
    expect(source.items().find((row) => row.kind === 'entity')).toMatchObject({
      entity: { isRead: true },
    });
    expect(searchRefetch).toHaveBeenCalledOnce();
    expect(retainedSearchRefetch).toHaveBeenCalledOnce();
    const discovery = searchQueryMock.mock.calls[0][0]();
    const retained = searchQueryMock.mock.calls.at(-1)![0]();
    expect(discovery.body.filters.email_filters.is_read).toBe(false);
    expect(retained.body.filters.email_filters).toMatchObject({
      email_thread_ids: ['search'],
      importance: false,
      link_ids: ['inbox-a'],
    });
    expect(retained.body.filters.email_filters.is_read).toBeUndefined();
    expect(retained.body.query).toBe('invoice');
    setRetainedSearchEntities([]);
    expect(ids(source)).toEqual([]);
  });

  it('bridges pending retained reads without suspending, then honors authoritative exclusions', () => {
    const {
      source,
      setState,
      setDiscoveryEntities,
      setRetainedEntities,
      setRetentionLoading,
    } = mount();
    batch(() => {
      setState('facets', { read: ['unread'] });
      setRetentionLoading(true);
    });
    expect(ids(source)).toEqual(['noise']);
    setDiscoveryEntities([]);
    expect(ids(source)).toEqual(['noise']);
    batch(() => {
      setRetainedEntities([]);
      setRetentionLoading(false);
    });
    expect(ids(source)).toEqual([]);
    setRetentionLoading(true);
    expect(ids(source)).toEqual([]);
  });

  it('keeps the confirmed read flag while a retained batch reloads', () => {
    const {
      source,
      setState,
      setDiscoveryEntities,
      setRetainedEntities,
      setRetentionLoading,
    } = mount();
    setState('facets', { read: ['unread'] });
    expect(ids(source)).toEqual(['noise']);
    batch(() => {
      setDiscoveryEntities([]);
      setRetainedEntities([{ ...email('noise'), isRead: true }]);
    });
    expect(source.items().find((row) => row.kind === 'entity')).toMatchObject({
      entity: { isRead: true },
    });
    setRetentionLoading(true);
    expect(source.items().find((row) => row.kind === 'entity')).toMatchObject({
      entity: { isRead: true },
    });
  });

  it('does not retain admitted hits when the search text changes', () => {
    const {
      source,
      setState,
      setSearchDiscoveryEntities,
      setRetainedSearchEntities,
    } = mount('invoice');
    setState('facets', { read: ['unread'] });
    expect(ids(source)).toEqual(['search']);
    batch(() => {
      setSearchDiscoveryEntities([]);
      setRetainedSearchEntities([{ ...email('search'), isRead: true }]);
    });
    expect(ids(source)).toEqual(['search']);
    setState('search', 'different');
    expect(ids(source)).toEqual([]);
  });

  it('resets read admission when the read filter changes', () => {
    const { source, setState, setEntities } = mount();
    setState('facets', { read: ['unread'] });
    expect(ids(source)).toEqual(['noise']);
    setEntities([{ ...email('noise'), isRead: true }]);
    expect(ids(source)).toEqual(['noise']);
    setState('facets', { read: ['read'] });
    expect(ids(source)).toEqual(['noise']);
    setState('facets', { read: ['unread'] });
    expect(ids(source)).toEqual([]);
  });

  it('keeps current-query cached results visible during a background refresh', () => {
    const { source, setFetching } = mount();
    setFetching(true);
    expect(ids(source)).toEqual(['noise']);
    expect(source.isLoading()).toBe(false);
    expect(source.isFetching()).toBe(true);
  });

  it('clears retained active-search rows and reports loading while tag sets are pending', () => {
    const {
      source,
      setState,
      setTagSetsReady,
      searchEntities,
      setSearchEntities,
    } = mount('invoice');
    expect(ids(source)).toEqual(['search']);
    expect(source.isLoading()).toBe(false);
    expect(source.hasMore()).toBe(true);

    batch(() => {
      setState('facets', { tags: ['pending-tag'] });
      setTagSetsReady(false);
    });
    // The shared search still holds the previous service result.
    expect(searchEntities().map((entity) => entity.id)).toEqual(['search']);
    expect(ids(source)).toEqual([]);
    expect(source.items()).toEqual([]);
    expect(source.isLoading()).toBe(true);
    expect(source.hasMore()).toBe(false);

    batch(() => {
      setSearchEntities([email('refined-search')]);
      setTagSetsReady(true);
    });
    expect(ids(source)).toEqual(['refined-search']);
    expect(source.isLoading()).toBe(false);
  });

  it('does not retain unfiltered rows while a tag selection waits for tag sets', () => {
    const { source, setState, setTagSetsReady } = mount();
    expect(ids(source)).toEqual(['noise']);
    batch(() => {
      setState('facets', { tags: ['pending-tag'] });
      setTagSetsReady(false);
    });
    expect(ids(source)).toEqual([]);
    expect(source.isLoading()).toBe(true);
    expect(source.hasMore()).toBe(false);
  });
});
