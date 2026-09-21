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
import { type EmailDataSource, useEmailDataSource } from './use-email-query';

const searchQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  ...(await import('@app/features/soup/search/create-search-state')),
}));
vi.mock('@queries/soup/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/soup/search')>()),
  useSearchSoupQuery: searchQueryMock,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ notificationsByEntity: () => ({}) }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
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
    const [entities, setEntities] = createSignal([email('noise')]);
    const [loading, setLoading] = createSignal(false);
    const [placeholder, setPlaceholder] = createSignal(false);
    const [fetching, setFetching] = createSignal(false);
    const [tagSetsReady, setTagSetsReady] = createSignal(true);
    const [searchEntities, setSearchEntities] = createSignal([email('search')]);
    searchQueryMock.mockImplementation(
      (
        _args: Parameters<typeof useSearchSoupQuery>[0],
        options: Parameters<typeof useSearchSoupQuery>[1]
      ) => ({
        // A disabled search keeps its previous data, just like placeholderData.
        get data() {
          return searchEntities();
        },
        get isEnabled() {
          return options?.().enabled ?? true;
        },
        isFetching: false,
        isFetchingNextPage: false,
        hasNextPage: true,
        error: null,
      })
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
    vi.mocked(useSoupAstItemsQuery).mockReturnValue(query);
    const source = useEmailDataSource(state, {
      tagSets: () => [],
      tagSetsReady,
    });
    return {
      source,
      setState,
      setEntities,
      setLoading,
      setPlaceholder,
      setFetching,
      setTagSetsReady,
      searchEntities,
      setSearchEntities,
    };
  });
}

describe('Email list query transitions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => dispose?.());

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
