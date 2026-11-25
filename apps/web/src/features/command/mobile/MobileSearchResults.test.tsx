import type { EntryState } from '@components/app/split-layout/layoutManager';
import type {
  EntityItem,
  QuickAccessItem,
  UserItem,
} from '@core/context/quickAccess';
import type { EntityData, SearchLocation } from '@entity';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { CombinedError } from '@urql/core';
import { okAsync } from 'neverthrow';
import { type Accessor, createSignal, onMount, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mergeCommandPeople } from '../contact-items';
import { MobileSearchInput } from './MobileSearchInput';
import { MobileSearchResults } from './MobileSearchResults';
import { SearchState } from './mobileSearchState';

const mocks = vi.hoisted(() => ({
  params: undefined as Record<string, unknown> | undefined,
  entitySearch: [] as { query: string; category: string }[],
  accountId: (() => 'owner') as Accessor<string>,
  authenticated: (() => true) as Accessor<boolean>,
  fullText: vi.fn(),
  fullTextItems: [] as EntityData[],
  fullTextData: (() => []) as Accessor<EntityData[]>,
  fullTextLoading: (() => false) as Accessor<boolean>,
  fullTextSettling: (() => false) as Accessor<boolean>,
  open: vi.fn(),
  onOpen: () => {},
  directMessage: vi.fn(),
  failure: vi.fn(),
  loadMore: vi.fn(),
  hasMore: true,
  loadingMore: false,
  viewportHeight: 400,
  deferLayout: false,
  measureLayout: () => {},
  fetchNextPage: vi.fn(),
  items: (() => []) as Accessor<QuickAccessItem[]>,
  loadingEntities: (() => false) as Accessor<boolean>,
  refreshError: (() => false) as Accessor<boolean>,
  fullTextError: (() => undefined) as Accessor<Error | undefined>,
  active: (() => true) as Accessor<boolean>,
  setActive: (_active: boolean) => {},
  entryState: undefined as EntryState | undefined,
  captors: new Map<string, () => unknown>(),
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useSplitRouter: () => ({ entry: () => ({ id: 'search-entry' }) }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('../../universal-input/use-universal-input', () => ({
  useUniversalInputEnabled: () => () => false,
}));
vi.mock('@app/features/crm/record-adapter', () => ({
  useCrmContactDiscovery: vi.fn(),
}));
vi.mock('@app/features/next-soup/utils', () => ({
  openEntityInSplitFromUnifiedList: mocks.open,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.open }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      isActive: () => mocks.active(),
      currentEntryState: () => mocks.entryState,
      content: () =>
        mocks.params
          ? { type: 'component', id: 'search', params: mocks.params }
          : { state: mocks.entryState },
      captureEntryState: () => {
        mocks.entryState = Object.fromEntries(
          [...mocks.captors].map(([key, read]) => [key, read()])
        );
      },
      registerEntryStateCaptor: (key: string, getter: () => unknown) => {
        mocks.captors.set(key, getter);
        return () => mocks.captors.delete(key);
      },
    },
  }),
}));
vi.mock('@components/app/mobile/use-mobile-nav', () => ({
  useForegroundMobileView: () => () => 'search',
  useMobileNavNavigate: () => vi.fn(),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => mocks.accountId,
  useIsAuthenticated: () => mocks.authenticated,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: {
      children: import('solid-js').JSX.Element;
    }) => props.children,
  })
);
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@queries/channel/get-or-create-dm', () => ({
  existingDirectMessage: mocks.directMessage,
}));
vi.mock('@queries/storage/databases', () => ({
  useDatabaseDiscoverySync: vi.fn(),
}));
vi.mock('../CommandItem', () => ({
  ItemDisplay: (props: { item: QuickAccessItem }) => (
    <span>{props.item.searchText}</span>
  ),
}));
vi.mock('@entity', () => ({
  ListEntityMetadataQueryProvider: (props: {
    children: import('solid-js').JSX.Element;
  }) => props.children,
  ListLayoutProvider: (props: {
    children: import('solid-js').JSX.Element;
    onMeasured?: () => void;
  }) => {
    mocks.measureLayout = () => props.onMeasured?.();
    onMount(() => {
      if (!mocks.deferLayout) mocks.measureLayout();
    });
    return props.children;
  },
  ListEntity: (props: {
    entity: EntityData;
    ref?: (element: HTMLDivElement) => void;
    onContentHitClick: (event: MouseEvent, location: SearchLocation) => void;
  }) => (
    <div ref={props.ref}>
      <button
        type="button"
        onClick={(event) =>
          props.onContentHitClick(event, {
            type: 'email',
            messageId: 'matching-message',
          })
        }
      >
        {props.entity.name} snippet
      </button>
    </div>
  ),
}));
vi.mock(
  '@app/features/next-soup/soup-view/filters-bar/tag-filter-state',
  () => ({
    createTagOptions: () => ({
      options: () => [],
      defByOption: () => new Map(),
    }),
  })
);
vi.mock('@app/features/next-soup/soup-view/search-operator-lookup', () => ({
  createSearchOperatorLookup: () => () => ({
    userId: 'macro|me@example.com',
    tags: () => [],
    inboxes: () => [],
    channels: () => [],
  }),
}));
vi.mock(
  '@app/features/next-soup/soup-view/filters-bar/search-operator-values',
  () => ({
    createSearchOperatorValues: () => () => ({
      people: [],
      tags: [],
      inboxes: [],
      channels: [],
    }),
  })
);
vi.mock('../queries/entity-search', () => ({
  useEntitySearch: (query: () => string, category: () => string) => ({
    items: () => {
      mocks.entitySearch.push({ query: query(), category: category() });
      return mocks.items();
    },
    rankItems: (items: QuickAccessItem[]) => items,
    isLoadingEntities: () => mocks.loadingEntities(),
    isSearchingEntities: () => false,
    isSettling: () => mocks.loadingEntities(),
    hasError: () => mocks.refreshError(),
    hasAuthoritativeError: () => false,
    pagination: {
      windowKey: () => undefined,
      hasMore: () => mocks.hasMore,
      isLoadingMore: () => mocks.loadingMore,
      loadMore: mocks.loadMore,
    },
  }),
}));
vi.mock('../queries/mobile-full-text-search', () => ({
  createMobileFullTextSearch: (...args: unknown[]) => {
    mocks.fullText(...args);
    return {
      data: () => mocks.fullTextData(),
      isLoading: () => mocks.fullTextLoading(),
      isSettling: () => mocks.fullTextSettling(),
      error: () => mocks.fullTextError(),
      hasNextPage: () => mocks.hasMore,
      isFetchingNextPage: () => mocks.loadingMore,
      fetchNextPage: mocks.fetchNextPage,
    };
  },
}));
beforeEach(() => {
  mocks.accountId = () => 'owner';
  mocks.authenticated = () => true;
  const [active, setActive] = createSignal(true);
  mocks.active = active;
  mocks.setActive = setActive;
  mocks.entryState = undefined;
  mocks.params = undefined;
  mocks.captors.clear();
  mocks.open.mockImplementation(() => {
    mocks.onOpen();
    mocks.entryState = Object.fromEntries(
      [...mocks.captors].map(([key, read]) => [key, read()])
    );
    setActive(false);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(
    document.body
  );
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: new DOMRect(
                0,
                0,
                400,
                target.getAttribute('role') === 'region'
                  ? mocks.viewportHeight
                  : 400
              ),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this
        );
      }
      unobserve() {}
      disconnect() {}
    }
  );
  mocks.hasMore = true;
  mocks.onOpen = () => {};
  mocks.viewportHeight = 400;
  mocks.deferLayout = false;
  mocks.loadingMore = false;
  mocks.items = () => [];
  mocks.loadingEntities = () => false;
  mocks.refreshError = () => false;
  mocks.fullTextError = () => undefined;
  mocks.fullTextItems = [];
  mocks.fullTextData = () => mocks.fullTextItems;
  mocks.fullTextLoading = () => false;
  mocks.fullTextSettling = () => mocks.fullTextLoading();
  SearchState.open();
});
afterEach(() => {
  cleanup();
  SearchState.close();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('offers full text above empty results, only mounts it explicitly, and keeps the input during mode changes', () => {
  render(() => (
    <>
      <MobileSearchInput />
      <MobileSearchResults />
    </>
  ));
  const input = screen.getByPlaceholderText('Search…');
  input.focus();
  fireEvent.input(input, { target: { value: 'teo' } });
  expect(screen.getByText('No results')).toBeTruthy();
  expect(mocks.fullText).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Search full text for “teo”' })
  );
  expect(mocks.fullText).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(input);
  fireEvent.input(input, { target: { value: 'teo update' } });
  expect(SearchState.mode()).toBe('full-text');
  expect(mocks.fullText).toHaveBeenCalledOnce();
  fireEvent.input(input, { target: { value: '  ' } });
  expect(SearchState.mode()).toBe('name');
  expect(screen.queryByText(/Search full text for/)).toBeNull();
  expect(screen.getByPlaceholderText('Search…')).toBe(input);
});

it('lists a project by its name and hides search on result opening', async () => {
  const [items, setItems] = createSignal<QuickAccessItem[]>([]);
  mocks.items = items;
  render(() => <MobileSearchResults />);
  SearchState.setQuery('teo');
  setItems([
    {
      id: 'project',
      kind: 'entity',
      bucket: 'initiative',
      data: {
        id: 'project',
        type: 'initiative',
        name: 'Teo project',
        ownerId: 'owner',
      },
      searchText: 'Teo project',
      sortTimestamp: 0,
      timestamps: {},
    },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Teo project' }));
  expect(SearchState.isOpen()).toBe(false);
  expect(mocks.open).toHaveBeenCalled();
  SearchState.open();
  expect(SearchState.mode()).toBe('name');
});

it('preserves the search after a failed person lookup and on return from a successful retry', async () => {
  mocks.items = () => [
    {
      id: 'macro|teo@example.com',
      kind: 'user',
      bucket: 'person',
      searchText: 'Teo',
      sortTimestamp: 0,
      timestamps: {},
      data: {
        id: 'macro|teo@example.com',
        email: 'teo@example.com',
        name: 'Teo',
      },
    },
  ];
  mocks.directMessage.mockReturnValue(
    okAsync({ channelId: 'direct-message', source: 'server' })
  );
  mocks.open.mockImplementationOnce(() => {
    throw new Error('Unavailable');
  });
  SearchState.setQuery('teo');
  render(() => <MobileSearchResults />);
  fireEvent.click(screen.getByRole('button', { name: 'Teo' }));
  await waitFor(() =>
    expect(mocks.failure).toHaveBeenCalledWith(
      'Unable to open result. Please try again.'
    )
  );
  expect(SearchState.isOpen()).toBe(true);
  expect(SearchState.query()).toBe('teo');
  expect(SearchState.mode()).toBe('name');
  fireEvent.click(screen.getByRole('button', { name: 'Teo' }));
  expect(SearchState.isOpen()).toBe(true);
  await waitFor(() =>
    expect(mocks.open).toHaveBeenNthCalledWith(
      2,
      { type: 'channel', id: 'direct-message' },
      { reopen: 'latest' }
    )
  );
  expect(SearchState.isOpen()).toBe(false);
  mocks.setActive(true);
  expect(SearchState.isOpen()).toBe(true);
  expect(SearchState.query()).toBe('teo');
  expect(screen.getByRole('button', { name: 'Teo' })).toBeTruthy();
});

it('opens the selected full-text message and hides the search chrome', () => {
  const email: EntityData = {
    id: 'thread',
    type: 'email',
    name: 'Weekly update',
    ownerId: 'owner',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    isRead: true,
    isDraft: false,
    isImportant: false,
    done: false,
  };
  mocks.fullTextItems = [email];
  SearchState.setQuery('teo');
  SearchState.searchFullText();
  render(() => <MobileSearchResults />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Weekly update snippet' })
  );
  expect(mocks.open).toHaveBeenCalledWith(email, {
    splitHandle: expect.objectContaining({ isActive: expect.any(Function) }),
    location: { type: 'email', messageId: 'matching-message' },
  });
  expect(SearchState.isOpen()).toBe(false);
  expect(SearchState.query()).toBe('teo');
});

it('bounds mounted recent rows while keeping the first result usable', () => {
  mocks.items = () =>
    Array.from({ length: 2000 }, (_, index) => ({
      id: `project-${index}`,
      kind: 'entity',
      bucket: 'initiative',
      data: {
        id: `project-${index}`,
        type: 'initiative',
        name: `Project ${index}`,
        ownerId: 'owner',
      },
      searchText: `Project ${index}`,
      sortTimestamp: 0,
      timestamps: {},
    }));
  render(() => <MobileSearchResults />);
  expect(screen.getAllByRole('button').length).toBeLessThan(50);
  fireEvent.click(screen.getByRole('button', { name: 'Project 0' }));
  expect(mocks.open).toHaveBeenCalled();
  expect(SearchState.isOpen()).toBe(false);
});

it('restores full-text order, query, category, mode and scroll after measuring remounted rows', async () => {
  const email: EntityData = {
    id: 'thread',
    type: 'email',
    name: 'Weekly update',
    ownerId: 'owner',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    isRead: true,
    isDraft: false,
    isImportant: false,
    done: false,
  };
  const other = { ...email, id: 'other', name: 'Earlier update' };
  const [items, setItems] = createSignal<EntityData[]>([other, email]);
  mocks.onOpen = () => setItems([email, other]);
  const [settling, setSettling] = createSignal(false);
  mocks.fullTextData = items;
  mocks.fullTextSettling = settling;
  mocks.hasMore = false;
  SearchState.setQuery('teo');
  SearchState.searchFullText();
  const view = render(() => <MobileSearchResults />);
  const list = screen.getByRole('region', { name: 'Search results' });
  fireEvent.scroll(list, { target: { scrollTop: 1280 } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Weekly update snippet' })
  );
  mocks.setActive(true);
  expect(
    within(list)
      .getAllByRole('button')
      .map((row) => row.textContent)
  ).toEqual(['Earlier update snippet', 'Weekly update snippet']);
  const entry = mocks.entryState;
  view.unmount();

  // A separate dock session must not overwrite this history entry.
  SearchState.open();
  SearchState.setQuery('another query');
  SearchState.close();
  expect(mocks.entryState).toBe(entry);
  mocks.setActive(true);
  setSettling(true);
  setItems([]);
  mocks.deferLayout = true;
  render(() => (
    <>
      <MobileSearchInput />
      <MobileSearchResults />
    </>
  ));
  const input = screen.getByPlaceholderText('Search…');
  expect(input).toHaveProperty('value', 'teo');
  expect(document.activeElement).not.toBe(input);
  expect(SearchState.mode()).toBe('full-text');
  expect(screen.getByText('Searching…')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Weekly update snippet' })
  ).toBeNull();
  mocks.measureLayout();
  setItems([email, other]);
  setSettling(false);
  await waitFor(() =>
    expect(
      screen.getByRole('region', { name: 'Search results' }).scrollTop
    ).toBe(1280)
  );
  expect(
    within(screen.getByRole('region', { name: 'Search results' }))
      .getAllByRole('button')
      .map((row) => row.textContent)
  ).toEqual(['Earlier update snippet', 'Weekly update snippet']);
  expect(screen.getByRole('region', { name: 'Search results' }).scrollTop).toBe(
    1280
  );
  expect(
    screen.getByRole('button', { name: 'Weekly update snippet' })
  ).toBeTruthy();
});

it('reveals the same scrolled results when native Back uncovers search', () => {
  mocks.fullTextItems = [
    {
      id: 'thread',
      type: 'email',
      name: 'Weekly update',
      ownerId: 'owner',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      isRead: true,
      isDraft: false,
      isImportant: false,
      done: false,
    },
  ];
  mocks.hasMore = false;
  SearchState.setQuery('teo');
  SearchState.searchFullText();
  render(() => (
    <>
      <Show when={SearchState.isOpen()}>
        <MobileSearchInput />
      </Show>
      <MobileSearchResults />
    </>
  ));
  const list = screen.getByRole('region', { name: 'Search results' });
  fireEvent.scroll(list, { target: { scrollTop: 940 } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Weekly update snippet' })
  );
  expect(screen.queryByPlaceholderText('Search…')).toBeNull();
  mocks.setActive(true);
  expect(screen.getByRole('region', { name: 'Search results' })).toBe(list);
  expect(list.scrollTop).toBe(940);
  const input = screen.getByPlaceholderText('Search…');
  expect(input).toHaveProperty('value', 'teo');
  expect(document.activeElement).not.toBe(input);
});

it('restores the name list order and scroll after opening promotes a result by recency', async () => {
  mocks.hasMore = false;
  const originalItems: QuickAccessItem[] = Array.from(
    { length: 100 },
    (_, index) => ({
      id: `project-${index}`,
      kind: 'entity',
      bucket: 'initiative',
      data: {
        id: `project-${index}`,
        type: 'initiative',
        name: `Project ${index}`,
        ownerId: 'owner',
      },
      searchText: `Project ${index}`,
      sortTimestamp: 0,
      timestamps: {},
    })
  );
  const [items, setItems] = createSignal(originalItems);
  mocks.items = items;
  mocks.onOpen = () =>
    setItems([
      originalItems[2],
      ...originalItems.filter((item) => item.id !== 'project-2'),
    ]);
  SearchState.setQuery('Project');
  const view = render(() => <MobileSearchResults />);
  fireEvent.scroll(screen.getByRole('region', { name: 'Search results' }), {
    target: { scrollTop: 800 },
  });
  const visibleResults = screen
    .getAllByRole('button')
    .map((row) => row.textContent);
  fireEvent.click(screen.getByRole('button', { name: 'Project 2' }));
  expect(screen.getAllByRole('button').map((row) => row.textContent)).toEqual(
    visibleResults
  );
  // Native Back can uncover the same mounted list before any remount.
  mocks.setActive(true);
  expect(screen.getAllByRole('button').map((row) => row.textContent)).toEqual(
    visibleResults
  );
  expect(mocks.entryState?.['mobileSearch.nameScroll']).toMatchObject({
    offset: 800,
  });
  view.unmount();
  mocks.setActive(true);
  render(() => <MobileSearchResults />);
  expect(SearchState.query()).toBe('Project');
  const restoredList = screen.getByRole('region', { name: 'Search results' });
  await waitFor(() => expect(restoredList.scrollTop).toBe(800));
  fireEvent.scroll(restoredList);
  expect(screen.getByRole('button', { name: 'Project 2' })).toBeTruthy();
  expect(mocks.entryState?.['mobileSearch.nameOrder']).toMatchObject({
    ids: originalItems.map((item) => item.id),
  });
  expect(mocks.entryState?.['mobileSearch.nameScroll']).not.toHaveProperty(
    'cache'
  );
});

it.each(['before navigation', 'while away'])(
  'keeps a person in place when their DM arrives %s',
  async (arrival) => {
    mocks.hasMore = false;
    const people: UserItem[] = Array.from({ length: 100 }, (_, index) => ({
      id: `macro|person-${index}@example.com`,
      kind: 'user',
      bucket: 'person',
      searchText: `Person ${index}`,
      sortTimestamp: 0,
      timestamps: {},
      data: {
        id: `macro|person-${index}@example.com`,
        email: `person-${index}@example.com`,
        name: `Person ${index}`,
      },
    }));
    const [conversations, setConversations] = createSignal<EntityItem[]>([]);
    // Exercise the real person-to-conversation composition. A new DM is also
    // promoted by recency, so its raw channel ID no longer occupies the old slot.
    mocks.items = () =>
      mergeCommandPeople(
        [...conversations(), ...people],
        conversations(),
        'owner'
      );
    const publishConversation = () => {
      setConversations([
        {
          id: 'new-dm',
          kind: 'entity',
          bucket: 'dm',
          searchText: 'Person 2',
          sortTimestamp: Date.now(),
          timestamps: {},
          data: {
            id: 'new-dm',
            type: 'channel',
            name: 'Person 2',
            ownerId: 'owner',
            channelType: 'direct_message',
            participantIds: ['owner', people[2].id],
          },
        },
      ]);
    };
    mocks.directMessage.mockImplementation(() => {
      if (arrival === 'before navigation') publishConversation();
      return okAsync({ channelId: 'new-dm', source: 'server' });
    });
    SearchState.setQuery('Person');
    const view = render(() => <MobileSearchResults />);
    const list = screen.getByRole('region', { name: 'Search results' });
    fireEvent.scroll(list, { target: { scrollTop: 800 } });
    const visiblePeople = () =>
      within(screen.getByRole('region', { name: 'Search results' }))
        .getAllByRole('button')
        .map((row) => row.textContent?.match(/Person \d+/)?.[0]);
    const before = visiblePeople();
    fireEvent.click(screen.getByRole('button', { name: 'Person 2' }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalled());
    mocks.setActive(true);
    expect(visiblePeople()).toEqual(before);
    expect(list.scrollTop).toBe(800);

    view.unmount();
    if (arrival === 'while away') publishConversation();
    mocks.setActive(true);
    render(() => <MobileSearchResults />);
    const restored = screen.getByRole('region', { name: 'Search results' });
    await waitFor(() => expect(restored.scrollTop).toBe(800));
    fireEvent.scroll(restored);
    // Remounting can add an overscan row above the viewport.
    expect(visiblePeople()).toEqual(expect.arrayContaining(before));
    expect(visiblePeople().indexOf('Person 3')).toBe(
      visiblePeople().indexOf('Person 2') + 1
    );
    const person = within(restored).getByRole('button', { name: /Person 2$/ });
    fireEvent.click(person);
    await waitFor(() =>
      expect(mocks.open).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'new-dm', type: 'channel' }),
        expect.anything()
      )
    );
    expect(mocks.directMessage).toHaveBeenCalledOnce();
  }
);

it('reloads name rows on remount instead of storing them in history', async () => {
  const savedItems: QuickAccessItem[] = Array.from(
    { length: 100 },
    (_, index) => ({
      id: `project-${index}`,
      kind: 'entity',
      bucket: 'initiative',
      data: {
        id: `project-${index}`,
        type: 'initiative',
        name: `Project ${index}`,
        ownerId: 'owner',
      },
      searchText: `Project ${index}`,
      sortTimestamp: 0,
      timestamps: {},
    })
  );
  const [items, setItems] = createSignal(savedItems);
  const [loading, setLoading] = createSignal(false);
  mocks.items = items;
  mocks.loadingEntities = loading;
  SearchState.setQuery('Project');
  const view = render(() => <MobileSearchResults />);
  fireEvent.scroll(screen.getByRole('region', { name: 'Search results' }), {
    target: { scrollTop: 800 },
  });
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Search results' })).getAllByRole(
      'button'
    )[0]
  );
  expect(mocks.entryState?.['mobileSearch.nameOrder']).toEqual({
    accountId: 'owner',
    query: 'Project',
    category: 'all',
    ids: savedItems.map((item) => item.id),
  });
  expect(mocks.entryState?.['mobileSearch.nameScroll']).not.toHaveProperty(
    'cache'
  );
  view.unmount();
  setLoading(true);
  setItems([]);
  mocks.setActive(true);
  render(() => <MobileSearchResults />);
  expect(screen.queryByRole('button', { name: 'Project 2' })).toBeNull();
  expect(SearchState.query()).toBe('Project');
  setItems(savedItems);
  setLoading(false);
  const restoredList = screen.getByRole('region', { name: 'Search results' });
  await waitFor(() => expect(restoredList.scrollTop).toBe(800));
  fireEvent.scroll(restoredList);
  expect(screen.getByRole('button', { name: 'Project 2' })).toBeTruthy();
});

it('does not show a loading footer for available name results during a background lookup', () => {
  mocks.items = () => [
    {
      id: 'project',
      kind: 'entity',
      bucket: 'initiative',
      data: {
        id: 'project',
        type: 'initiative',
        name: 'Project',
        ownerId: 'owner',
      },
      searchText: 'Project',
      sortTimestamp: 0,
      timestamps: {},
    },
  ];
  mocks.loadingEntities = () => true;
  render(() => <MobileSearchResults />);
  expect(screen.getByRole('button', { name: 'Project' })).toBeTruthy();
  expect(screen.queryByText('Loading…')).toBeNull();
});

it.each(['name', 'full-text'] as const)(
  'keeps user scrolling after restoring %s results and resets it for another account',
  async (mode) => {
    const [accountId, setAccountId] = createSignal('owner');
    const [authenticated, setAuthenticated] = createSignal(true);
    mocks.accountId = accountId;
    mocks.authenticated = authenticated;
    const [nameItems, setNameItems] = createSignal<QuickAccessItem[]>([
      {
        id: 'first',
        kind: 'entity',
        bucket: 'initiative',
        data: {
          id: 'first',
          type: 'initiative',
          name: 'First',
          ownerId: 'owner',
        },
        searchText: 'First',
        sortTimestamp: 0,
        timestamps: {},
      },
      {
        id: 'second',
        kind: 'entity',
        bucket: 'initiative',
        data: {
          id: 'second',
          type: 'initiative',
          name: 'Second',
          ownerId: 'owner',
        },
        searchText: 'Second',
        sortTimestamp: 0,
        timestamps: {},
      },
    ]);
    const [fullTextItems, setFullTextItems] = createSignal<EntityData[]>([
      {
        id: 'first',
        type: 'email',
        name: 'First',
        ownerId: 'owner',
        isRead: true,
        isDraft: false,
        isImportant: false,
        done: false,
      },
      {
        id: 'second',
        type: 'email',
        name: 'Second',
        ownerId: 'owner',
        isRead: true,
        isDraft: false,
        isImportant: false,
        done: false,
      },
    ]);
    mocks.items = nameItems;
    mocks.fullTextData = fullTextItems;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
      () => mocks.viewportHeight
    );
    SearchState.setQuery('First');
    if (mode === 'full-text') SearchState.searchFullText();
    const view = render(() => <MobileSearchResults />);
    fireEvent.scroll(screen.getByRole('region', { name: 'Search results' }), {
      target: { scrollTop: 300 },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: mode === 'name' ? 'First' : 'First snippet',
      })
    );
    view.unmount();
    // A taller viewport cannot reach the previously saved offset yet.
    mocks.viewportHeight = 600;
    mocks.setActive(true);
    render(() => <MobileSearchResults />);
    const list = screen.getByRole('region', { name: 'Search results' });
    if (mode === 'full-text')
      await waitFor(() => expect(list.scrollTop).toBe(300));
    fireEvent.wheel(list);
    // Simulate the browser clamping the initial offset to the new scroll range.
    fireEvent.scroll(list, { target: { scrollTop: 200 } });
    fireEvent.scroll(list, { target: { scrollTop: 100 } });
    setNameItems([
      { ...nameItems()[0], searchText: 'Updated first' },
      nameItems()[1],
      { ...nameItems()[0], id: 'third', searchText: 'Third' },
    ]);
    setFullTextItems([
      { ...fullTextItems()[0], name: 'Updated first' },
      fullTextItems()[1],
      { ...fullTextItems()[0], id: 'third', name: 'Third' },
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: mode === 'name' ? 'Updated first' : 'Updated first snippet',
        })
      ).toBeTruthy()
    );
    expect(list.scrollTop).toBe(100);
    fireEvent.click(
      screen.getByRole('button', {
        name: mode === 'name' ? 'Updated first' : 'Updated first snippet',
      })
    );
    const scroll =
      mocks.entryState?.[
        mode === 'name'
          ? 'mobileSearch.nameScroll'
          : 'mobileSearch.fullTextScroll'
      ];
    expect(scroll).toMatchObject({ offset: 100 });
    mocks.setActive(true);
    setAccountId('another-account');
    const nextList = screen.getByRole('region', { name: 'Search results' });
    expect(nextList).not.toBe(list);
    expect(nextList.scrollTop).toBe(0);
    cleanup();
    render(() => <MobileSearchResults />);
    expect(
      screen.getByRole('region', { name: 'Search results' }).scrollTop
    ).toBe(0);
    setAuthenticated(false);
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull();
  }
);

it('does not revive saved name rows after a failed refresh or successful empty result', () => {
  const [items, setItems] = createSignal<QuickAccessItem[]>([
    {
      id: 'project',
      kind: 'entity',
      bucket: 'initiative',
      data: {
        id: 'project',
        type: 'initiative',
        name: 'Project',
        ownerId: 'owner',
      },
      searchText: 'Project',
      sortTimestamp: 0,
      timestamps: {},
    },
  ]);
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  mocks.items = items;
  mocks.loadingEntities = loading;
  mocks.refreshError = failed;
  mocks.hasMore = false;
  SearchState.setQuery('Project');
  const view = render(() => <MobileSearchResults />);
  fireEvent.click(screen.getByRole('button', { name: 'Project' }));
  view.unmount();
  setLoading(true);
  setItems([]);
  mocks.setActive(true);
  render(() => <MobileSearchResults />);
  setFailed(true);
  setLoading(false);
  expect(screen.queryByRole('button', { name: 'Project' })).toBeNull();
  expect(mocks.loadMore).not.toHaveBeenCalled();
  setLoading(true);
  setFailed(false);
  setLoading(false);
  expect(screen.queryByRole('button', { name: 'Project' })).toBeNull();
  expect(screen.getByText('No results')).toBeTruthy();
});

it('discards saved full-text rows on access loss even when an old cursor remains', () => {
  const [items, setItems] = createSignal<EntityData[]>([
    {
      id: 'thread',
      type: 'email',
      name: 'Weekly update',
      ownerId: 'owner',
      isRead: true,
      isDraft: false,
      isImportant: false,
      done: false,
    },
  ]);
  mocks.fullTextData = items;
  const [error, setError] = createSignal<Error>();
  mocks.fullTextError = error;
  SearchState.setQuery('teo');
  SearchState.searchFullText();
  render(() => <MobileSearchResults />);
  expect(
    screen.getByRole('button', { name: 'Weekly update snippet' })
  ).toBeTruthy();
  setError(new Error('Network unavailable'));
  expect(
    screen.getByRole('button', { name: 'Weekly update snippet' })
  ).toBeTruthy();
  setError(
    new CombinedError({
      graphQLErrors: [
        { message: 'Forbidden', extensions: { code: 'FORBIDDEN' } },
      ],
    })
  );
  // The real service source removes rows after an authoritative failure.
  setItems([]);
  expect(
    screen.queryByRole('button', { name: 'Weekly update snippet' })
  ).toBeNull();
  expect(mocks.fetchNextPage).not.toHaveBeenCalled();
});

it('keeps a covered native search entry independent of a new dock session', () => {
  SearchState.setQuery('type:email original');
  render(() => <MobileSearchResults />);
  mocks.setActive(false);
  expect(SearchState.isOpen()).toBe(false);
  SearchState.open();
  SearchState.setQuery('type:task new search');
  // The covered entry's starters show and edit its own search.
  expect(screen.queryByRole('button', { name: 'Tasks' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Email' }));
  expect(SearchState.query()).toBe('type:task new search');
  mocks.setActive(true);
  expect(SearchState.query()).toBe('original type:');
});

it('narrows name results with type: and lists other operators as full text', () => {
  render(() => <MobileSearchResults />);
  SearchState.setQuery('type:task teo');
  expect(mocks.entitySearch.at(-1)).toEqual({
    query: 'teo',
    category: 'tasks',
  });
  expect(screen.getByText(/Search full text for/)).toBeTruthy();
  SearchState.setQuery('assignee:me teo');
  expect(mocks.fullText).toHaveBeenCalled();
  expect(screen.queryByText(/Search full text for/)).toBeNull();
});

it('loads another name page near the end without a persistent paging bar', async () => {
  mocks.items = () =>
    Array.from({ length: 100 }, (_, index) => ({
      id: `project-${index}`,
      kind: 'entity',
      bucket: 'initiative',
      data: {
        id: `project-${index}`,
        type: 'initiative',
        name: `Project ${index}`,
        ownerId: 'owner',
      },
      searchText: `Project ${index}`,
      sortTimestamp: 0,
      timestamps: {},
    }));
  render(() => <MobileSearchResults />);
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  const list = screen.getByRole('region', { name: 'Search results' });
  fireEvent.scroll(list, { target: { scrollTop: 1 } });
  expect(mocks.loadMore).not.toHaveBeenCalled();
  fireEvent.scroll(list, { target: { scrollTop: 100000 } });
  await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledOnce());
  mocks.loadingMore = true;
  fireEvent.scroll(list, { target: { scrollTop: 100001 } });
  expect(mocks.loadMore).toHaveBeenCalledOnce();
  mocks.loadingMore = false;
  mocks.hasMore = false;
  fireEvent.scroll(list, { target: { scrollTop: 100002 } });
  expect(mocks.loadMore).toHaveBeenCalledOnce();
});

it('loads full-text pages near the end without a persistent paging bar', () => {
  SearchState.setQuery('teo');
  SearchState.searchFullText();
  render(() => <MobileSearchResults />);
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  const list = screen.getByRole('region', { name: 'Search results' });
  Object.defineProperties(list, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 400 },
  });
  fireEvent.scroll(list, { target: { scrollTop: 100 } });
  expect(mocks.fetchNextPage).not.toHaveBeenCalled();
  fireEvent.scroll(list, { target: { scrollTop: 1550 } });
  expect(mocks.fetchNextPage).toHaveBeenCalledOnce();
  mocks.loadingMore = true;
  fireEvent.scroll(list, { target: { scrollTop: 1551 } });
  expect(mocks.fetchNextPage).toHaveBeenCalledOnce();
  mocks.loadingMore = false;
  mocks.hasMore = false;
  fireEvent.scroll(list, { target: { scrollTop: 1552 } });
  expect(mocks.fetchNextPage).toHaveBeenCalledOnce();
});

it('fills an empty name page without requiring a scroll and stops once rows fill the viewport', async () => {
  const [items, setItems] = createSignal<QuickAccessItem[]>([]);
  mocks.items = items;
  mocks.loadMore.mockImplementationOnce(async () => {
    setItems([]);
  });
  mocks.loadMore.mockImplementationOnce(async () => {
    setItems(
      Array.from({ length: 100 }, (_, index) => ({
        id: `project-${index}`,
        kind: 'entity',
        bucket: 'initiative',
        data: {
          id: `project-${index}`,
          type: 'initiative',
          name: `Project ${index}`,
          ownerId: 'owner',
        },
        searchText: `Project ${index}`,
        sortTimestamp: 0,
        timestamps: {},
      }))
    );
  });
  render(() => <MobileSearchResults />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Project 0' })).toBeTruthy()
  );
  expect(mocks.loadMore).toHaveBeenCalledTimes(2);
});

it('does not automatically retry an unchanged empty page or fetch after closing', async () => {
  const view = render(() => <MobileSearchResults />);
  await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledOnce());
  view.unmount();
  render(() => <MobileSearchResults />).unmount();
  await Promise.resolve();
  expect(mocks.loadMore).toHaveBeenCalledOnce();
});

it('fills empty full-text pages until pagination is exhausted', async () => {
  const [items, setItems] = createSignal<EntityData[]>([]);
  mocks.fullTextData = items;
  mocks.fetchNextPage.mockImplementationOnce(async () => {
    setItems([]);
  });
  mocks.fetchNextPage.mockImplementationOnce(async () => {
    mocks.hasMore = false;
    setItems([]);
  });
  SearchState.setQuery('teo');
  SearchState.searchFullText();
  render(() => <MobileSearchResults />);
  await waitFor(() => expect(mocks.fetchNextPage).toHaveBeenCalledTimes(2));
});

it('uses current source rows during refresh and keeps row identity when pages append', () => {
  const email: EntityData = {
    id: 'thread',
    type: 'email',
    name: 'Weekly update',
    ownerId: 'owner',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    isRead: true,
    isDraft: false,
    isImportant: false,
    done: false,
  };
  const [items, setItems] = createSignal<EntityData[]>([email]);
  const [loading, setLoading] = createSignal(false);
  const [settling, setSettling] = createSignal(false);
  mocks.fullTextData = items;
  mocks.fullTextLoading = loading;
  mocks.fullTextSettling = () => loading() || settling();
  SearchState.setQuery('teo');
  SearchState.searchFullText();
  render(() => <MobileSearchResults />);
  setLoading(true);
  setItems([]);
  expect(
    screen.queryByRole('button', { name: 'Weekly update snippet' })
  ).toBeNull();
  setItems([email]);
  setLoading(false);
  const refreshedRow = screen.getByRole('button', {
    name: 'Weekly update snippet',
  });
  // Service page selection rematerializes existing entities when it appends.
  setItems([
    { ...email, name: 'Updated subject' },
    { ...email, id: 'next', name: 'Next page' },
  ]);
  expect(screen.getByRole('button', { name: 'Updated subject snippet' })).toBe(
    refreshedRow
  );
  expect(
    screen.getByRole('button', { name: 'Next page snippet' })
  ).toBeTruthy();
  // The real source keeps old rows briefly while the new query debounces.
  setSettling(true);
  SearchState.setQuery('different');
  expect(
    screen.queryByRole('button', { name: 'Updated subject snippet' })
  ).toBeNull();
});

it('keeps a full-text top-of-list anchor below the mobile safe-area padding', async () => {
  mocks.fullTextItems = [
    {
      id: 'first',
      type: 'email',
      name: 'First',
      ownerId: 'owner',
      isRead: true,
      isDraft: false,
      isImportant: false,
      done: false,
    },
  ];
  mocks.hasMore = false;
  SearchState.setQuery('First');
  SearchState.searchFullText();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return new DOMRect(0, this.dataset.mobileSearchId ? 80 : 0, 390, 64);
    }
  );
  const view = render(() => <MobileSearchResults />);
  fireEvent.click(screen.getByRole('button', { name: 'First snippet' }));
  expect(mocks.entryState?.['mobileSearch.fullTextScroll']).toMatchObject({
    id: 'first',
    offset: 0,
    within: -80,
  });
  view.unmount();
  mocks.setActive(true);
  render(() => <MobileSearchResults />);
  await waitFor(() =>
    expect(
      screen.getByRole('region', { name: 'Search results' }).scrollTop
    ).toBe(0)
  );
  await Promise.resolve();
  expect(screen.getByRole('region', { name: 'Search results' }).scrollTop).toBe(
    0
  );
});

it('resumes viewport paging when editing a restored search in the dock', async () => {
  mocks.items = () => [
    {
      id: 'first',
      kind: 'entity',
      bucket: 'initiative',
      data: {
        id: 'first',
        type: 'initiative',
        name: 'First',
        ownerId: 'owner',
      },
      searchText: 'First',
      sortTimestamp: 0,
      timestamps: {},
    },
  ];
  mocks.entryState = {
    'mobileSearch.session': {
      query: 'First',
      mode: 'name',
    },
    'mobileSearch.nameScroll': {
      accountId: 'owner',
      query: 'First',
      category: 'all',
      id: 'first',
      offset: 0,
      within: 0,
    },
  };
  render(() => <MobileSearchResults />);
  await Promise.resolve();
  expect(mocks.loadMore).not.toHaveBeenCalled();
  SearchState.setQuery('Next');
  await waitFor(() => expect(mocks.loadMore).toHaveBeenCalledOnce());
});

it('opens on what a tag or the universal input picked, keeping its binding', () => {
  const binding = {
    token: 'tag:"🎉"',
    tags: [{ propertyId: 'prop-1', optionId: 'opt-1' }],
  };
  mocks.entryState = {
    'search.text': 'tag:"🎉"',
    'search.bindings': [binding],
  };
  render(() => (
    <>
      <MobileSearchInput />
      <MobileSearchResults />
    </>
  ));
  // A space follows, so the token isn't read as one still being typed.
  expect(SearchState.query()).toBe('tag:"🎉" ');
  expect(SearchState.mode()).toBe('full-text');
  const bindings = mocks.fullText.mock.calls.at(-1)?.[2] as () => unknown;
  expect(bindings()).toEqual([binding]);
  cleanup();

  mocks.entryState = undefined;
  mocks.params = {
    initialQuery: 'tag:"🎉" launch',
    initialBindings: [binding],
  };
  render(() => (
    <>
      <MobileSearchInput />
      <MobileSearchResults />
    </>
  ));
  expect(SearchState.query()).toBe('tag:"🎉" launch ');
  expect(SearchState.session().bindings()).toEqual([binding]);
  // Editing the token lets go of it.
  fireEvent.input(screen.getByPlaceholderText('Search…'), {
    target: { value: 'tag:"🎉x" launch' },
  });
  expect(SearchState.session().bindings()).toEqual([]);
});

it('restores its own session over what the opener picked', () => {
  mocks.entryState = {
    'search.text': 'tag:"🎉"',
    'mobileSearch.session': { query: 'teo', mode: 'name' },
  };
  render(() => (
    <>
      <MobileSearchInput />
      <MobileSearchResults />
    </>
  ));
  expect(SearchState.query()).toBe('teo');
  expect(SearchState.session().bindings()).toEqual([]);
});
