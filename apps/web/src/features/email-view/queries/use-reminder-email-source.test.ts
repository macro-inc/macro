import type { EmailEntity } from '@entity';
import type { EmailReminderSummary } from '@service-storage/generated/schemas/emailReminderSummary';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import type { EmailViewState } from '../types';
import { useEmailDetailListNavigation } from '../use-email-detail-list-navigation';
import { useReminderEmailSource } from './use-reminder-email-source';

const mocks = vi.hoisted(() => ({
  collection: vi.fn(),
  hydration: vi.fn(),
  view: vi.fn(),
  open: vi.fn(),
  failure: vi.fn(),
  flag: vi.fn(),
}));
vi.mock('../email-view-context', () => ({ useEmailView: mocks.view }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock(
  '@app/components/list',
  async () => await import('@app/components/list/use-list-detail-navigation')
);
vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  ...(await import('@app/features/soup/collection/row-store')),
}));
vi.mock('@entity', async () => await import('@entity/types/entity'));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => mocks.flag,
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
          { items: [] as EmailReminderSummary[], nextCursor: 'continue' },
        ],
      },
      fetchNextPage: vi.fn(async () => {}),
      refetch: vi.fn(async () => {}),
    });
    const [hydration, setHydration] = createStore({
      isPending: false,
      isPlaceholderData: false,
      isFetching: false,
      data: { entities: [] as EmailEntity[] } as
        | { entities: EmailEntity[] }
        | undefined,
      error: null as Error | null,
      refresh: vi.fn(async () => {}),
    });
    const [laterHydration, setLaterHydration] = createStore({
      isPending: true,
      isPlaceholderData: false,
      isFetching: true,
      data: undefined as { entities: EmailEntity[] } | undefined,
      error: null as Error | null,
      refresh: vi.fn(async () => {}),
    });
    mocks.collection.mockReturnValue(collection);
    mocks.hydration
      .mockReturnValueOnce(hydration)
      .mockReturnValue(laterHydration);
    const [flag, setFlag] = createStore({ enabled: true, loading: false });
    mocks.flag.mockImplementation(() => flag);
    const source = useReminderEmailSource(state, {
      tagSets: () => [],
      tagSetsReady: () => true,
    });
    mocks.view.mockReturnValue({ source, openThread: mocks.open });
    const navigation = useEmailDetailListNavigation(() => 'first');
    return {
      source,
      setFlag,
      navigation,
      setState,
      collection,
      setCollection,
      setHydration,
      laterHydration,
      setLaterHydration,
    };
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

function item(
  threadId: string,
  count = 1,
  reminderId = `${threadId}-reminder`
): EmailReminderSummary {
  return {
    threadId,
    count,
    nearest: {
      reminder: {
        id: reminderId,
        entityId: threadId,
        entityType: 'email_thread',
        description: 'Follow up',
        enabled: true,
        nextRunAt: '2026-10-05T12:00:00Z',
        createdAt: '2026-10-01T12:00:00Z',
        updatedAt: '2026-10-01T12:00:00Z',
        schedule: { type: 'once', remindAt: '2026-10-05T12:00:00Z' },
      },
    },
  };
}

it('uses collection clock metadata only for hydrated rows and clears it outside the tab', () => {
  const { source, setCollection, setHydration, setState } = mount();
  setCollection('data', 'pages', [
    { items: [item('first', 2), item('revoked')], nextCursor: '' },
  ]);
  setHydration('data', 'entities', [email('first')]);
  expect(source.reminderForThread?.('first')).toMatchObject({
    count: 2,
    nearest: { id: 'first-reminder' },
  });
  expect(source.reminderForThread?.('revoked')).toBeUndefined();
  setCollection('data', 'pages', [
    { items: [item('first', 1, 'replacement')], nextCursor: '' },
  ]);
  expect(source.reminderForThread?.('first')).toMatchObject({
    count: 1,
    nearest: { id: 'replacement' },
  });
  setState('tab', 'all');
  expect(source.reminderForThread?.('first')).toBeUndefined();
});

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
      items: [item('older'), item('newer'), item('revoked')],
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
    { items: [item('email')], nextCursor: 'continue' },
  ]);
  setHydration({ data: undefined, error: new Error('Retry hydration') });
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

it('shares the in-flight final-page wait until native hydration publishes the next email', async () => {
  const {
    source,
    navigation,
    collection,
    setCollection,
    setHydration,
    setLaterHydration,
  } = mount();
  setCollection('data', 'pages', [
    { items: [item('first')], nextCursor: 'last' },
  ]);
  setHydration('data', { entities: [email('first')] });
  let release!: () => void;
  collection.fetchNextPage.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = () => {
          setCollection({
            hasNextPage: false,
            isFetchingNextPage: false,
            data: {
              pages: [
                { items: [item('first')], nextCursor: 'last' },
                { items: [item('last')], nextCursor: '' },
              ],
            },
          });
          resolve();
        };
      })
  );
  const first = source.loadMore();
  const nextEmail = navigation.afterReminderSaved?.();
  const concurrent = source.loadMore();
  expect(concurrent).toBe(first);
  let settled = false;
  void first.then(() => {
    settled = true;
  });
  await Promise.resolve();
  release();
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(mocks.open).not.toHaveBeenCalled();
  expect(source.isLoadingMore()).toBe(true);
  expect(source.hasMore()).toBe(true);
  expect(source.items().filter((row) => row.kind === 'entity')).toHaveLength(1);
  setLaterHydration({
    isPending: false,
    isFetching: false,
    data: { entities: [email('last')] },
  });
  await first;
  await nextEmail;
  expect(mocks.open).toHaveBeenCalledWith({ id: 'last', fallbackName: 'last' });
  expect(
    source
      .items()
      .flatMap((row) => (row.kind === 'entity' ? [row.entity.id] : []))
  ).toEqual(['first', 'last']);
  expect(source.hasMore()).toBe(false);
  expect(collection.fetchNextPage).toHaveBeenCalledOnce();
});

it('retains earlier rows and retries failed final-page hydration without fetching past it', async () => {
  const {
    source,
    collection,
    setCollection,
    setHydration,
    laterHydration,
    setLaterHydration,
  } = mount();
  setCollection({
    hasNextPage: false,
    data: {
      pages: [
        { items: [item('first')], nextCursor: 'last' },
        { items: [item('last')], nextCursor: '' },
      ],
    },
  });
  setHydration('data', { entities: [email('first')] });
  setLaterHydration({
    isPending: false,
    isFetching: false,
    error: new Error('Native page failed'),
  });
  expect(source.error()).toEqual(new Error('Native page failed'));
  expect(source.items().map((row) => row.kind)).toEqual([
    'entity',
    'load-more',
  ]);
  expect(source.hasMore()).toBe(true);
  laterHydration.refresh.mockImplementationOnce(async () => {
    setLaterHydration({ error: null, data: { entities: [email('last')] } });
  });
  await source.loadMore();
  expect(laterHydration.refresh).toHaveBeenCalledOnce();
  expect(collection.fetchNextPage).not.toHaveBeenCalled();
  expect(source.error()).toBeUndefined();
  expect(source.items().map((row) => row.kind)).toEqual(['entity', 'entity']);
  setLaterHydration('error', new Error('Background failure with cached rows'));
  expect(source.error()).toBeUndefined();
});

it('rejects a pending navigation wait when the selected inbox changes', async () => {
  const { source, setCollection, setState, setHydration } = mount();
  setCollection('data', 'pages', [
    { items: [item('first')], nextCursor: 'next' },
  ]);
  setHydration({ isPending: true, data: undefined });
  const pending = source.loadMore();
  await Promise.resolve();
  setState('inboxIds', ['another-inbox']);
  await expect(pending).rejects.toThrow('Email view changed');
});

it('reconciles live non-read facets and refills while keeping read admission stable', async () => {
  const { source, collection, setCollection, setState, setHydration } = mount();
  setState('facets', { done: ['not-done'], read: ['unread'] });
  setCollection('data', 'pages', [
    { items: [item('first')], nextCursor: 'next' },
  ]);
  setHydration('data', { entities: [email('first')] });
  expect(source.items().filter((row) => row.kind === 'entity')).toHaveLength(1);
  setHydration('data', { entities: [{ ...email('first'), isRead: true }] });
  expect(source.items().filter((row) => row.kind === 'entity')).toHaveLength(1);
  collection.refetch.mockClear();
  setHydration('data', { entities: [{ ...email('first'), done: true }] });
  expect(source.items().filter((row) => row.kind === 'entity')).toHaveLength(0);
  await Promise.resolve();
  expect(collection.refetch).toHaveBeenCalledOnce();
});

it('keeps a restored Reminders view loading until the feature flag resolves', () => {
  const { source, setFlag } = mount();
  const options = mocks.collection.mock.calls[0][0];
  setFlag({ enabled: false, loading: true });
  expect(source.isLoading()).toBe(true);
  expect(options().enabled).toBe(false);
  setFlag({ enabled: true, loading: false });
  expect(source.isLoading()).toBe(false);
  expect(options().enabled).toBe(true);
});
