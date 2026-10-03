import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DriveSelection } from '../context/drive-source';

const mocks = vi.hoisted(() => ({
  database: {
    isSuccess: true,
    isPending: false,
    isFetching: false,
    error: null as unknown,
    data: [] as ListedDatabase[],
    refetch: vi.fn(async () => {}),
  },
  soup: {
    isPending: false,
    isSuccess: true,
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null as unknown,
    data: { entities: [] },
    refresh: vi.fn(async () => {}),
    fetchNextPage: vi.fn(async () => {}),
  },
}));
vi.mock('@queries/storage/databases', () => ({
  useDatabasesQuery: () => mocks.database,
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: () => mocks.soup,
}));
vi.mock('@queries/soup/transform-utils', () => ({
  isDisplayableSoupItem: () => true,
  mapApiSoupItemToEntity: vi.fn(),
}));
vi.mock('@app/features/soup/entity-notifications', () => ({
  withEntityNotifications: (entity: unknown) => entity,
}));
vi.mock('@app/features/soup/search', () => ({
  useOptionalSearchContext: () => undefined,
  createSearchState: ({ text }: { text: () => string }) => ({
    isSearching: () => !!text(),
    data: () => [],
    isLocalSearchSettling: () => false,
    isFetching: () => false,
    featuredIds: () => [],
    error: () => undefined,
    hasNextPage: () => false,
    isFetchingNextPage: () => false,
    refresh: async () => {},
    fetchNextPage: async () => {},
  }),
}));

import { createDriveDataSource } from './drive-data-source';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.clearAllMocks();
});
function setup() {
  mocks.database.data = [
    {
      database: {
        id: 'db',
        name: 'Book Organizer',
        owner_id: 'me',
        created_at: '2026-09-01T00:00:00Z',
        trashed_at: null,
      },
      grant: 'owner',
      tables: [],
    },
  ];
  mocks.database.error = null;
  mocks.database.isSuccess = true;
  mocks.soup.hasNextPage = false;
  mocks.soup.error = null;
  mocks.soup.isSuccess = true;
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [enabled, setEnabled] = createSignal(true);
    const [selection, setSelection] = createSignal<DriveSelection>({
      location: { kind: 'tab', tab: 'owned' },
      scope: 'default',
      sort: 'updated_at',
      search: '',
      facets: {},
    });
    const source = createDriveDataSource({
      selection,
      databasesEnabled: enabled,
      userId: () => 'me',
      tagSets: () => [],
      tagSetsReady: () => true,
      // Notification enrichment is replaced above; this capability is unused.
      notificationSource: {} as never,
    });
    return { source, setSelection, selection, setEnabled };
  });
}
describe('Drive database source integration', () => {
  it('merges databases with files, searches names and applies type facets', () => {
    const { source, setSelection, selection } = setup();
    expect(source.items().map((row) => row.entity.name)).toEqual([
      'Book Organizer',
    ]);
    setSelection({
      ...selection(),
      search: 'organizer',
      facets: { type: ['database'] },
    });
    expect(source.items()).toHaveLength(1);
    setSelection({ ...selection(), facets: { type: ['doc-markdown'] } });
    expect(source.items()).toHaveLength(0);
  });
  it('removes cached databases immediately when the flag turns off', () => {
    const { source, setEnabled } = setup();
    expect(source.items()).toHaveLength(1);
    setEnabled(false);
    expect(source.items()).toHaveLength(0);
  });
  it('refreshes both transports to recover database failures', async () => {
    const { source } = setup();
    await source.refresh();
    expect(mocks.database.refetch).toHaveBeenCalledOnce();
    expect(mocks.soup.refresh).toHaveBeenCalledOnce();
  });
  it('retains cached database rows after a failed refetch without blocking file pagination', async () => {
    const { source, setSelection, selection } = setup();
    expect(source.items()).toHaveLength(1);
    mocks.database.error = new Error('catalog unavailable');
    mocks.database.isSuccess = false;
    mocks.soup.hasNextPage = true;
    setSelection({ ...selection() });
    expect(source.items()).toHaveLength(1);
    expect(source.databaseError()).toBe(mocks.database.error);
    expect(source.error()).toBeUndefined();
    expect(source.isFetching()).toBe(false);
    await source.loadMore();
    expect(mocks.soup.fetchNextPage).toHaveBeenCalledOnce();
  });
  it('keeps database rows visible when the file transport fails', () => {
    const { source } = setup();
    mocks.soup.error = new Error('files unavailable');
    mocks.soup.isSuccess = false;
    expect(source.hasData()).toBe(true);
    expect(source.error()).toBe(mocks.soup.error);
  });
});
