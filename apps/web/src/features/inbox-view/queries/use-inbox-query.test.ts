import type { EmailEntity, EntityData } from '@entity/types/entity';
import type { SoupAstItemsQuery } from '@queries/soup/items';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { soupPageTimestamp } from '@queries/soup/page-timestamp';
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxViewState } from '../types';
import { type InboxDataSource, useInboxDataSource } from './use-inbox-query';

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  useSearchContext: () => ({ entityPool: () => [] }),
  createSearchState: () => ({
    isSearching: () => false,
    usesServiceSearch: () => false,
    isSettling: () => false,
  }),
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
    get isLoading() {
      return loading();
    },
    get hasNextPage() {
      return more();
    },
    get error() {
      return error();
    },
    isFetching: false,
    isFetchingNextPage: false,
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
    const [state, setState] = createStore<InboxViewState>({
      tab: 'signal',
      search: '',
      groupBy: 'none',
      facets: {},
    });
    const source = useInboxDataSource(state);
    return { source, setState };
  });
}
const rows = (source: InboxDataSource) =>
  source.items().flatMap((row) => (row.kind === 'entity' ? [row.entity] : []));
const ids = (source: InboxDataSource) => rows(source).map((row) => row.id);

describe('Home data source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date(2026, 8, 10, 12));
  });
  afterEach(() => {
    dispose?.();
    vi.useRealTimers();
  });

  it('does not treat older cache-only rows as fetched page coverage', async () => {
    const notifications = makeQuery([email('n9', 9), email('n1', 1)]);
    const activity = makeQuery([
      email('a10', 10),
      email('a8', 8),
      email('cached', 2),
    ]);
    activity.setOldestFetchedTimestamp(new Date(2026, 8, 8).getTime());
    const { source } = mount(notifications, activity);
    expect(ids(source)).toEqual(['a10', 'n9']);
    await source.loadMore();
    expect(activity.fetchNextPage).toHaveBeenCalledOnce();
    expect(notifications.fetchNextPage).not.toHaveBeenCalled();
  });

  it('pages the shallower source and appends history without moving existing rows', async () => {
    const notifications = makeQuery([email('n9', 9), email('n1', 1)]);
    const activity = makeQuery([email('a10', 10), email('a8', 8)]);
    const { source } = mount(notifications, activity);
    expect(ids(source)).toEqual(['a10', 'n9']);
    await source.loadMore();
    expect(activity.fetchNextPage).toHaveBeenCalledOnce();
    expect(notifications.fetchNextPage).not.toHaveBeenCalled();

    activity.setEntities((previous) => [
      ...previous,
      email('a7', 7),
      email('a6', 6),
    ]);
    expect(ids(source)).toEqual(['a10', 'n9', 'a8', 'a7']);
    activity.setMore(false);
    expect(ids(source)).toEqual(['a10', 'n9', 'a8', 'a7', 'a6']);
    await source.loadMore();
    expect(notifications.fetchNextPage).toHaveBeenCalledOnce();
    notifications.setMore(false);
    expect(ids(source)).toEqual(['a10', 'n9', 'a8', 'a7', 'a6', 'n1']);
    expect(source.hasMore()).toBe(false);
  });

  it('uses unfiltered page boundaries when a type facet hides a whole page', async () => {
    const notifications = makeQuery([email('old', 1)], false);
    const activity = makeQuery([
      {
        type: 'chat',
        id: 'chat',
        name: 'chat',
        ownerId: 'alice',
        touchedAt: new Date(2026, 8, 9),
      },
    ]);
    const { source, setState } = mount(notifications, activity);
    setState('facets', { type: ['email'] });
    expect(ids(source)).toEqual([]);
    expect(source.hasMore()).toBe(true);
    await source.loadMore();
    expect(activity.fetchNextPage).toHaveBeenCalledOnce();
    activity.setEntities((previous) => [...previous, email('sent', 8)]);
    activity.setMore(false);
    expect(ids(source)).toEqual(['sent', 'old']);
  });

  it('waits for an initial page without reading its suspending data', () => {
    const notifications = makeQuery([email('old', 1)], false);
    const activity = makeQuery([], false);
    activity.setLoading(true);
    const { source } = mount(notifications, activity);
    expect(ids(source)).toEqual([]);
    expect(source.isLoading()).toBe(true);
    activity.setEntities([email('new', 10)]);
    activity.setLoading(false);
    expect(ids(source)).toEqual(['new', 'old']);
  });

  it('retains usable rows and a retry warning when one source fails', async () => {
    const notifications = makeQuery([email('old', 1)], false);
    const activity = makeQuery([]);
    activity.setError(new Error('Offline'));
    const { source } = mount(notifications, activity);
    expect(ids(source)).toEqual(['old']);
    expect(source.error()).toBeUndefined();
    expect(source.warning()).toBe('Recent activity could not be refreshed.');
    await source.refresh();
    expect(notifications.query.refresh).toHaveBeenCalledOnce();
    expect(activity.query.refresh).toHaveBeenCalledOnce();
  });

  it('can continue a healthy source while its first rows are buffered and the other source failed', async () => {
    const notifications = makeQuery([]);
    notifications.setError(new Error('Offline'));
    const activity = makeQuery([email('boundary', 9)]);
    const { source } = mount(notifications, activity);
    expect(ids(source)).toEqual([]);
    expect(source.error()).toBeUndefined();
    expect(source.warning()).toBe('Notifications could not be refreshed.');
    expect(source.hasMore()).toBe(true);
    await source.loadMore();
    expect(activity.fetchNextPage).toHaveBeenCalledOnce();
    expect(notifications.fetchNextPage).not.toHaveBeenCalled();
    activity.setMore(false);
    expect(ids(source)).toEqual(['boundary']);
  });

  it('keeps newer entity content, attaches a reactive notification accessor, and retains read rows', () => {
    const notifications = makeQuery([email('same', 9)], false);
    const activity = makeQuery(
      [{ ...email('same', 10), name: 'Renamed', isRead: true }],
      false
    );
    const { source, setState } = mount(notifications, activity);
    expect(rows(source)[0].name).toBe('Renamed');
    expect(rows(source)[0].notifications?.()).toEqual([]);
    setState('facets', { read: ['unread'] });
    expect(ids(source)).toEqual([]);
    activity.setEntities([{ ...email('same', 10), name: 'Renamed' }]);
    expect(ids(source)).toEqual(['same']);
    activity.setEntities([
      { ...email('same', 10), name: 'Renamed', isRead: true },
    ]);
    expect(ids(source)).toEqual(['same']);
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

  it('applies type visibility to both sources and hides channels together with replies', () => {
    const channel: EntityData = {
      type: 'channel',
      id: 'channel',
      name: 'Channel',
      ownerId: 'alice',
      channelType: 'public',
      touchedAt: new Date(2026, 8, 9),
    };
    const thread: EntityData = {
      type: 'channel_thread',
      id: 'reply',
      name: 'Reply',
      ownerId: 'alice',
      channelId: channel.id,
      messageId: 'root',
      threadId: 'root',
      senderId: 'alice',
      sender: { id: 'alice', type: 'user' },
      content: '',
      attachments: [],
      reactions: [],
      thread: { replyCount: 1, preview: [] },
      touchedAt: new Date(2026, 8, 8),
    };
    const notifications = makeQuery([email('received', 9)], false);
    const activity = makeQuery([email('sent', 10), channel, thread], false);
    const { source, setState } = mount(notifications, activity);
    expect(ids(source)).toEqual(['sent', 'channel', 'received', 'reply']);
    setState('facets', { type: ['channels'] });
    expect(ids(source)).toEqual(['channel', 'reply']);
    setState('facets', { type: ['email'] });
    expect(ids(source)).toEqual(['sent', 'received']);
    setState('facets', { type: ['none'] });
    expect(ids(source)).toEqual([]);
  });

  it('selects read and unread rows consistently across notification and activity sources', () => {
    const notifications = makeQuery([email('unread', 9)], false);
    const activity = makeQuery([{ ...email('read', 10), isRead: true }], false);
    const { source, setState } = mount(notifications, activity);
    setState('facets', { read: ['read'] });
    expect(ids(source)).toEqual(['read']);
    setState('facets', { read: ['unread'] });
    expect(ids(source)).toEqual(['unread']);
    setState('facets', { read: [] });
    expect(ids(source)).toEqual(['read', 'unread']);
  });

  it('does not drain paginated history when every entity type is hidden', async () => {
    const notifications = makeQuery([email('notification', 9)]);
    const activity = makeQuery([email('activity', 10)]);
    const { source, setState } = mount(notifications, activity);
    setState('facets', { type: ['none'] });
    expect(ids(source)).toEqual([]);
    expect(source.hasMore()).toBe(false);
    expect(source.isLoading()).toBe(false);
    await source.loadMore();
    expect(notifications.fetchNextPage).not.toHaveBeenCalled();
    expect(activity.fetchNextPage).not.toHaveBeenCalled();
  });

  it('can select chats and agent sessions independently', () => {
    const activity = makeQuery(
      [
        {
          type: 'chat',
          id: 'chat',
          name: 'Chat',
          ownerId: 'alice',
          touchedAt: new Date(2026, 8, 9),
        },
        {
          type: 'agent_session',
          id: 'agent',
          name: 'Agent',
          ownerId: 'alice',
          botId: 'bot',
          status: 'idle',
          touchedAt: new Date(2026, 8, 10),
        },
      ],
      false
    );
    const { source, setState } = mount(makeQuery([], false), activity);
    setState('facets', { type: ['chats'] });
    expect(ids(source)).toEqual(['chat']);
    setState('facets', { type: ['agents'] });
    expect(ids(source)).toEqual(['agent']);
  });
});
