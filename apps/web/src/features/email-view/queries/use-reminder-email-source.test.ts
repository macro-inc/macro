import type { EmailEntity } from '@entity';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmailViewState } from '../types';
import { useReminderEmailSource } from './use-reminder-email-source';

const mocks = vi.hoisted(() => ({ collection: vi.fn(), hydration: vi.fn() }));
vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  ...(await import('@app/features/soup/collection/row-store')),
}));
vi.mock('@entity', async () => await import('@entity/types/entity'));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ notificationsByEntity: () => ({}) }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@queries/reminders/email-collection', () => ({
  useEmailReminderCollection: mocks.collection,
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: mocks.hydration,
}));
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.clearAllMocks();
});
function mount() {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [state, setState] = createStore<EmailViewState>({
      tab: 'reminders',
      search: 'persisted text',
      inboxIds: ['selected-inbox'],
      facets: {},
      collapsedSidebarSectionIds: [],
    });
    const [collection, setCollection] = createStore({
      isPending: false,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: true,
      error: null as Error | null,
      data: {
        pages: [
          { items: [] as { threadId: string }[], nextCursor: 'continue' },
        ],
      },
      fetchNextPage: vi.fn(async () => {}),
      refetch: vi.fn(async () => {}),
    });
    const [hydration, setHydration] = createStore({
      isPending: false,
      isPlaceholderData: false,
      isFetching: false,
      data: { entities: [] as EmailEntity[] },
      error: null as Error | null,
      refresh: vi.fn(async () => {}),
    });
    mocks.collection.mockReturnValue(collection);
    mocks.hydration.mockReturnValue(hydration);
    const source = useReminderEmailSource(state, {
      tagSets: () => [],
      tagSetsReady: () => true,
    });
    return { source, setState, collection, setCollection, setHydration };
  });
}
function email(id: string): EmailEntity {
  return {
    type: 'email',
    id,
    name: id,
    ownerId: 'alice',
    linkId: 'selected-inbox',
    isRead: false,
    isDraft: false,
    isImportant: true,
    done: false,
  };
}

it('follows an empty budget-limited continuation without reporting an empty collection', async () => {
  const { source, collection } = mount();
  expect(source.items().map((row) => row.kind)).toEqual(['load-more']);
  expect(source.hasMore()).toBe(true);
  await source.loadMore();
  expect(collection.fetchNextPage).toHaveBeenCalledOnce();
  const options = mocks.collection.mock.calls[0][0]();
  expect(options.filters).not.toHaveProperty('search');
  expect(options.filters.inboxIds).toEqual(['selected-inbox']);
});

it('intersects authorized IDs with native hydration and restores schedule order', () => {
  const { source, setCollection, setHydration } = mount();
  setCollection('data', 'pages', [
    {
      items: [
        { threadId: 'older' },
        { threadId: 'newer' },
        { threadId: 'revoked' },
      ],
      nextCursor: 'continue',
    },
  ]);
  setHydration('data', 'entities', [
    email('newer'),
    email('older'),
    email('unrelated'),
  ]);
  expect(
    source
      .items()
      .flatMap((row) => (row.kind === 'entity' ? [row.entity.id] : []))
  ).toEqual(['older', 'newer']);
  setCollection('error', new Error('Background failed'));
  expect(source.error()).toBeUndefined();
  expect(source.items().filter((row) => row.kind === 'entity')).toHaveLength(2);
});

it('surfaces initial hydration failures for retry without fabricating preview rows', () => {
  const { source, setCollection, setHydration } = mount();
  setCollection('data', 'pages', [
    { items: [{ threadId: 'email' }], nextCursor: 'continue' },
  ]);
  setHydration('error', new Error('Retry hydration'));
  expect(source.error()).toEqual(new Error('Retry hydration'));
  expect(source.items().filter((row) => row.kind === 'entity')).toEqual([]);
});
vi.mock('@notifications', async () => await import('@notifications/types'));
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
