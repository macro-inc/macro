import type { CreateSearchStateOptions } from '@app/features/soup/search';
import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { DriveSelection } from '../context/drive-source';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  search: vi.fn(),
  pool: vi.fn(),
}));
vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery: mocks.query }));
vi.mock('@app/features/soup/search', () => ({
  createSearchState: mocks.search,
  useOptionalSearchContext: () => ({ entityPool: mocks.pool }),
}));
vi.mock('@app/features/soup/entity-notifications', () => ({
  withEntityNotifications: (entity: EntityData) => entity,
}));
vi.mock('@queries/soup/transform-utils', () => ({
  isDisplayableSoupItem: () => true,
  mapApiSoupItemToEntity: (item: { data: EntityData }) => item.data,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableSnippets: {},
  isFeatureEnabled: () => false,
}));

import { createDriveDataSource } from './drive-data-source';

const pdf: EntityData = {
  type: 'document',
  id: 'pdf',
  name: 'Report',
  fileType: 'pdf',
  ownerId: 'me',
};
function fixture() {
  const [selection, setSelection] = createSignal<DriveSelection>({
    location: { kind: 'tab', tab: 'owned' },
    scope: 'default',
    sort: 'updated_at',
    search: '',
    facets: {},
  });
  const [rows, setRows] = createSignal<EntityData[] | undefined>([pdf]);
  const [fetching, setFetching] = createSignal(false);
  const [placeholder, setPlaceholder] = createSignal(false);
  const [pool, setPool] = createSignal<EntityData[]>([]);
  mocks.pool.mockImplementation(() => pool().map((data) => ({ data })));
  const [error, setError] = createSignal<Error>();
  const [searchPending, setSearchPending] = createSignal(false);
  const [searchNextPage, setSearchNextPage] = createSignal(false);
  const [searchRows, setSearchRows] = createSignal<EntityData[]>([]);
  const [tagsReady, setTagsReady] = createSignal(true);
  const fetchNextPage = vi.fn(async () => {});
  mocks.query.mockReturnValue({
    get data() {
      const entities = rows();
      return entities ? { entities } : undefined;
    },
    get error() {
      return error();
    },
    get isFetching() {
      return fetching();
    },
    isLoading: false,
    get isPlaceholderData() {
      return placeholder();
    },
    isFetchingNextPage: false,
    hasNextPage: true,
    fetchNextPage,
    refresh: vi.fn(async () => {}),
  });
  mocks.search.mockImplementation((options: CreateSearchStateOptions) => ({
    data: searchRows,
    isSearching: () => options.text().length > 0,
    isFetching: () => searchPending() || searchNextPage(),
    isSettling: searchPending,
    isLocalSearchSettling: () => false,
    featuredIds: () => [],
    error: () => undefined,
    hasNextPage: () => false,
    isFetchingNextPage: searchNextPage,
    fetchNextPage: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  }));
  const list = createDriveDataSource({
    selection,
    userId: () => 'me',
    tagSets: () => [],
    tagSetsReady: tagsReady,
    notificationSource: {} as NotificationSource,
  });
  const queryOptions = mocks.query.mock.lastCall![1];
  return {
    list,
    selection,
    setSelection,
    setRows,
    setFetching,
    setPlaceholder,
    setPool,
    searchOptions: mocks.search.mock.lastCall![0] as CreateSearchStateOptions,
    setError,
    setSearchPending,
    setSearchNextPage,
    setSearchRows,
    setTagsReady,
    fetchNextPage,
    queryOptions,
  };
}

function withFixture(test: (value: ReturnType<typeof fixture>) => void) {
  createRoot((dispose) => {
    try {
      test(fixture());
    } finally {
      dispose();
    }
  });
}

describe('Drive data source', () => {
  it('treats a fetching zero-row query as loading, not empty', () =>
    withFixture(({ list, setRows, setFetching }) => {
      setRows([]);
      expect(list.items()).toEqual([]);
      setRows(undefined);
      setFetching(true);
      expect(list.items()).toEqual([]);
      expect(list.isLoading()).toBe(true);
      setRows([]);
      setFetching(false);
      expect(list.isLoading()).toBe(false);
      expect(list.hasData()).toBe(true);
    }));

  it('uses service-search results and status instead of unrelated list pages', () =>
    withFixture(({ list, setSelection, setSearchPending, setSearchRows }) => {
      expect(list.items()).toHaveLength(1);
      setSelection((current) => ({ ...current, search: 'report' }));
      setSearchPending(true);
      expect(list.isLoading()).toBe(true);
      expect(list.hasMore()).toBe(false);
      setSearchRows([pdf]);
      setSearchPending(false);
      expect(list.items().map((row) => row.entity.id)).toEqual(['pdf']);
      expect(list.isLoading()).toBe(false);
    }));

  it('keeps zero-row search pagination pending until a matching page arrives', () =>
    withFixture(({ list, setSelection, setSearchNextPage, setSearchRows }) => {
      setSelection((current) => ({ ...current, search: 'report' }));
      setSearchNextPage(true);
      expect(list.items()).toEqual([]);
      expect(list.isLoading()).toBe(true);
      expect(list.isLoadingMore()).toBe(true);
      setSearchRows([pdf]);
      expect(list.isLoading()).toBe(false);
    }));

  it('waits for restored tag definitions rather than leaking unfiltered rows', () =>
    withFixture(({ list, setSelection, setTagsReady, queryOptions }) => {
      setTagsReady(false);
      setSelection((current) => ({
        ...current,
        facets: { tags: ['deleted-tag'] },
      }));
      expect(queryOptions().enabled).toBe(false);
      expect(list.items()).toEqual([]);
      expect(list.isLoading()).toBe(true);
      setTagsReady(true);
      expect(queryOptions().enabled).toBe(true);
      expect(list.isLoading()).toBe(false);
    }));

  it('ORs type facets and keeps cached query membership tied to its location', () =>
    withFixture(({ list, setSelection, setRows, queryOptions }) => {
      const image: EntityData = { ...pdf, id: 'image', fileType: 'png' };
      setRows([pdf, image]);
      setSelection((current) => ({
        ...current,
        facets: { type: ['file-pdf', 'file-image'] },
      }));
      expect(list.items()).toHaveLength(2);
      setSelection((current) => ({
        ...current,
        location: { kind: 'tab', tab: 'shared' },
      }));
      const sharedFilter = queryOptions().meta.itemFilter;
      expect(list.items()).toEqual([]);
      setSelection((current) => ({
        ...current,
        location: { kind: 'tab', tab: 'owned' },
      }));
      expect(list.items()).toHaveLength(2);
      expect(sharedFilter({ tag: 'document', data: pdf })).toBe(false);
    }));

  it('uses authoritative query membership for attachment-scoped local documents', () =>
    withFixture(({ searchOptions, setPool, setSelection, queryOptions }) => {
      const unknown: EntityData = { ...pdf, id: 'unknown-attachment-status' };
      setPool([pdf, unknown]);
      expect(searchOptions.localPool?.().map((entry) => entry.data.id)).toEqual(
        ['pdf']
      );
      expect(
        queryOptions().meta.insertFilter({ tag: 'document', data: unknown })
      ).toBe(false);
      setSelection((current) => ({ ...current, scope: 'all' }));
      expect(searchOptions.localPool?.()).toHaveLength(2);
      expect(
        queryOptions().meta.insertFilter({ tag: 'document', data: unknown })
      ).toBe(true);
    }));

  it('does not show placeholders or trust their local membership after a scope change', () =>
    withFixture(
      ({
        list,
        searchOptions,
        setPool,
        setSelection,
        setPlaceholder,
        setFetching,
      }) => {
        setPool([pdf]);
        setSelection((current) => ({ ...current, scope: 'attachments' }));
        setPlaceholder(true);
        setFetching(true);
        expect(list.items()).toEqual([]);
        expect(searchOptions.localPool?.()).toEqual([]);
        expect(list.isLoading()).toBe(true);
      }
    ));

  it('trusts unknown email membership only for fetched folder results', () =>
    withFixture(
      ({
        list,
        searchOptions,
        setRows,
        setPool,
        setSelection,
        queryOptions,
      }) => {
        const email: EntityData = {
          type: 'email',
          id: 'email',
          name: 'Mail',
          ownerId: 'me',
          isRead: true,
          isDraft: false,
          isImportant: true,
          done: false,
        };
        setSelection((current) => ({
          ...current,
          location: { kind: 'folder', id: 'folder' },
        }));
        setRows([email]);
        setPool([email]);
        expect(list.items()).toHaveLength(1);
        expect(searchOptions.localPool?.()).toEqual([]);
        expect(
          queryOptions().meta.itemFilter({ tag: 'emailThread', data: email })
        ).toBe(false);
      }
    ));

  it('rejects a load-more promise that resolves with an error', async () => {
    await createRoot(async (dispose) => {
      try {
        const { list, setError, fetchNextPage } = fixture();
        fetchNextPage.mockImplementationOnce(async () => {
          setError(new Error('offline'));
        });
        await expect(list.loadMore()).rejects.toThrow('offline');
      } finally {
        dispose();
      }
    });
  });
});
