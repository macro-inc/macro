import type { EntityData, SearchLocation } from '@entity';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EntitySearchItem } from '../queries/entity-search';
import { MobileSearchInput } from './MobileSearchInput';
import { MobileSearchResults } from './MobileSearchResults';
import { SearchState } from './mobileSearchState';

const mocks = vi.hoisted(() => ({
  fullText: vi.fn(),
  fullTextItems: [] as EntityData[],
  fullTextData: (() => []) as Accessor<EntityData[]>,
  fullTextLoading: (() => false) as Accessor<boolean>,
  fullTextSettling: (() => false) as Accessor<boolean>,
  open: vi.fn(),
  directMessage: vi.fn(),
  failure: vi.fn(),
  loadMore: vi.fn(),
  hasMore: true,
  loadingMore: false,
  fetchNextPage: vi.fn(),
  items: (() => []) as Accessor<EntitySearchItem[]>,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
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
  useSplitPanelOrThrow: () => ({ handle: {} }),
}));
vi.mock('@components/app/mobile/use-mobile-nav', () => ({
  useForegroundMobileView: () => () => 'search',
  useMobileNavNavigate: () => vi.fn(),
}));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
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
  useGetOrCreateDirectMessageMutation: () => ({
    mutateAsync: mocks.directMessage,
  }),
}));
vi.mock('@queries/storage/databases', () => ({
  useDatabaseDiscoverySync: vi.fn(),
}));
vi.mock('../CommandItem', () => ({
  ItemDisplay: (props: { item: EntitySearchItem }) => (
    <span>{props.item.searchText}</span>
  ),
}));
vi.mock('@entity', () => ({
  ListEntityMetadataQueryProvider: (props: {
    children: import('solid-js').JSX.Element;
  }) => props.children,
  ListLayoutProvider: (props: { children: import('solid-js').JSX.Element }) =>
    props.children,
  ListEntity: (props: {
    entity: EntityData;
    onContentHitClick: (event: MouseEvent, location: SearchLocation) => void;
  }) => (
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
  ),
}));
vi.mock('../queries/entity-search', () => ({
  useEntitySearch: () => ({
    items: () => mocks.items(),
    rankItems: (items: EntitySearchItem[]) => items,
    isLoadingEntities: () => false,
    pagination: {
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
      error: () => undefined,
      hasNextPage: () => mocks.hasMore,
      isFetchingNextPage: () => mocks.loadingMore,
      fetchNextPage: mocks.fetchNextPage,
    };
  },
}));
beforeEach(() => {
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
              contentRect: new DOMRect(0, 0, 400, 400),
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
  mocks.loadingMore = false;
  mocks.items = () => [];
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
  SearchState.setCategory('email');
  expect(mocks.fullText).toHaveBeenCalledOnce();
  fireEvent.input(input, { target: { value: '  ' } });
  expect(SearchState.mode()).toBe('name');
  expect(SearchState.category()).toBe('email');
  expect(screen.queryByText(/Search full text for/)).toBeNull();
  expect(screen.getByPlaceholderText('Search…')).toBe(input);
});

it('omits full text for Projects and ends the session on result opening', async () => {
  const [items, setItems] = createSignal<EntitySearchItem[]>([]);
  mocks.items = items;
  render(() => <MobileSearchResults />);
  SearchState.setQuery('teo');
  SearchState.searchFullText();
  SearchState.setCategory('projects');
  expect(screen.queryByText(/Search full text for/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  setItems([
    {
      id: 'project',
      kind: 'initiative',
      bucket: 'initiative',
      name: 'Teo project',
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
  expect(SearchState.category()).toBe('all');
});

it('preserves the search after a failed person lookup and closes after a successful retry', async () => {
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
  mocks.directMessage.mockRejectedValueOnce(new Error('Unavailable'));
  mocks.directMessage.mockResolvedValueOnce({ channel_id: 'direct-message' });
  SearchState.setQuery('teo');
  SearchState.setCategory('people');
  render(() => <MobileSearchResults />);
  fireEvent.click(screen.getByRole('button', { name: 'Teo' }));
  await waitFor(() =>
    expect(mocks.failure).toHaveBeenCalledWith(
      'Unable to open result. Please try again.'
    )
  );
  expect(mocks.open).not.toHaveBeenCalled();
  expect(SearchState.isOpen()).toBe(true);
  expect(SearchState.query()).toBe('teo');
  expect(SearchState.category()).toBe('people');
  expect(SearchState.mode()).toBe('name');
  fireEvent.click(screen.getByRole('button', { name: 'Teo' }));
  expect(SearchState.isOpen()).toBe(true);
  await waitFor(() =>
    expect(mocks.open).toHaveBeenCalledWith(
      { type: 'channel', id: 'direct-message' },
      { reopen: 'latest' }
    )
  );
  expect(SearchState.isOpen()).toBe(false);
  expect(SearchState.query()).toBe('');
  expect(SearchState.category()).toBe('all');
});

it('opens the selected full-text message and resets the session', () => {
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
  SearchState.setCategory('email');
  SearchState.searchFullText();
  render(() => <MobileSearchResults />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Weekly update snippet' })
  );
  expect(mocks.open).toHaveBeenCalledWith(email, {
    splitHandle: {},
    location: { type: 'email', messageId: 'matching-message' },
  });
  expect(SearchState.isOpen()).toBe(false);
  expect(SearchState.query()).toBe('');
  expect(SearchState.category()).toBe('all');
});

it('bounds mounted recent rows while keeping the first result usable', () => {
  mocks.items = () =>
    Array.from({ length: 2000 }, (_, index) => ({
      id: `project-${index}`,
      kind: 'initiative',
      bucket: 'initiative',
      name: `Project ${index}`,
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

it('loads another name page near the end without a persistent paging bar', async () => {
  mocks.items = () =>
    Array.from({ length: 100 }, (_, index) => ({
      id: `project-${index}`,
      kind: 'initiative',
      bucket: 'initiative',
      name: `Project ${index}`,
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
  const [items, setItems] = createSignal<EntitySearchItem[]>([]);
  mocks.items = items;
  mocks.loadMore.mockImplementationOnce(async () => {
    setItems([]);
  });
  mocks.loadMore.mockImplementationOnce(async () => {
    setItems(
      Array.from({ length: 100 }, (_, index) => ({
        id: `project-${index}`,
        kind: 'initiative',
        bucket: 'initiative',
        name: `Project ${index}`,
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

it('keeps full-text rows mounted during same-query refreshes but clears them for a new query', () => {
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
  const row = screen.getByRole('button', { name: 'Weekly update snippet' });
  setLoading(true);
  setItems([]);
  expect(screen.getByRole('button', { name: 'Weekly update snippet' })).toBe(
    row
  );
  expect(screen.queryByText('Searching…')).toBeNull();
  setItems([email]);
  setLoading(false);
  expect(screen.getByRole('button', { name: 'Weekly update snippet' })).toBe(
    row
  );
  // Service page selection rematerializes existing entities when it appends.
  setItems([
    { ...email, name: 'Updated subject' },
    { ...email, id: 'next', name: 'Next page' },
  ]);
  expect(screen.getByRole('button', { name: 'Updated subject snippet' })).toBe(
    row
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
