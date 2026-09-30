import type { ReminderEntity } from '@entity/types/entity';
import {
  type SoupAstItemsQuery,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailViewState } from '../types';
import { useReminderSource } from './use-reminder-source';

const searchQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@app/features/soup', async () => ({
  ...(await import('@app/features/soup/filters')),
  ...(await import('@app/features/soup/collection/rows')),
  ...(await import('@app/features/soup/search/create-search-state')),
}));
vi.mock('@entity', async () => ({
  ...(await import('@entity/types/entity')),
  ...(await import('@entity/utils/notification')),
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

const HOUR = 60 * 60 * 1000;

function reminder(
  id: string,
  overrides: Partial<ReminderEntity> = {}
): ReminderEntity {
  return {
    type: 'reminder',
    id,
    name: id,
    description: id,
    scheduleType: 'once',
    nextRunAt: new Date(Date.now() - HOUR).toISOString(),
    ...overrides,
  } as ReminderEntity;
}

const ids = (source: ReturnType<typeof useReminderSource>) =>
  source
    .items()
    .flatMap((row) => (row.kind === 'entity' ? [row.entity.id] : []));

let dispose: (() => void) | undefined;
function mount(tab: EmailViewState['tab'] = 'reminders') {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [state, setState] = createStore<EmailViewState>({
      tab,
      search: '',
      inboxIds: undefined,
      facets: {},
      collapsedSidebarSectionIds: [],
    });
    const [entities, setEntities] = createSignal<ReminderEntity[]>([]);
    const [loading, setLoading] = createSignal(false);
    searchQueryMock.mockReturnValue({
      data: [],
      isEnabled: false,
      isSuccess: false,
      isPlaceholderData: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      error: null,
      refetch: vi.fn(async () => {}),
    });
    const query: SoupAstItemsQuery = {
      get data() {
        if (loading()) throw new Error('Read pending query data');
        return { entities: entities(), groups: undefined };
      },
      get isPending() {
        return loading();
      },
      get isLoading() {
        return loading();
      },
      isPlaceholderData: false,
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
    };
    vi.mocked(useSoupAstItemsQuery).mockReturnValue(query);
    const source = useReminderSource(state);
    return { source, query, state, setState, setEntities, setLoading };
  });
}

describe('reminder source', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => dispose?.());

  it('asks Soup for the Active slice only while the tab is showing', () => {
    mount('noise');
    const [args, options] = vi.mocked(useSoupAstItemsQuery).mock.calls[0]!;
    expect(options?.().enabled).toBe(false);
    expect(JSON.stringify(args().body.remf)).toContain('"fired":true');
    expect(args().params.sort_direction).toBe('desc');
  });

  it('follows the status filter into the query', () => {
    const { setState } = mount();
    const [args, options] = vi.mocked(useSoupAstItemsQuery).mock.calls[0]!;
    expect(options?.().enabled).toBe(true);

    setState('facets', { reminders: ['scheduled'] });
    expect(JSON.stringify(args().body.remf)).toContain('"fired":false');
    expect(args().params.sort_direction).toBe('asc');

    setState('facets', { reminders: ['done'] });
    expect(JSON.stringify(args().body.remf)).toContain('"comp":true');
  });

  it('lists the page flat and drops rows that left the status optimistically', () => {
    const { source, setEntities, setState } = mount();
    const fired = reminder('fired');
    const upcoming = reminder('upcoming', {
      nextRunAt: new Date(Date.now() + HOUR).toISOString(),
    });
    setEntities([fired, upcoming]);
    // Active: only the fired one belongs, whatever the page carried.
    expect(ids(source)).toEqual(['fired']);
    expect(source.items().every((row) => row.kind === 'entity')).toBe(true);

    // Marking it done stamps `completedAt` in the cache before the refetch.
    setEntities([
      { ...fired, completedAt: new Date().toISOString() },
      upcoming,
    ]);
    expect(ids(source)).toEqual([]);

    setState('facets', { reminders: ['scheduled'] });
    expect(ids(source)).toEqual(['upcoming']);
  });

  it('shows nothing from the previous status while the next page loads', () => {
    const { source, setEntities, setLoading } = mount();
    setEntities([reminder('fired')]);
    expect(ids(source)).toEqual(['fired']);

    setLoading(true);
    expect(ids(source)).toEqual([]);
    expect(source.isLoading()).toBe(true);
    expect(source.hasMore()).toBe(false);
  });

  it('narrows the loaded page by description while searching', () => {
    const { source, setEntities, setState } = mount();
    setEntities([
      reminder('Ping about invoice'),
      reminder('Follow up with Teo'),
    ]);
    expect(ids(source)).toEqual(['Ping about invoice', 'Follow up with Teo']);

    setState('search', 'teo');
    expect(ids(source)).toEqual(['Follow up with Teo']);
    expect(source.isLoading()).toBe(false);

    setState('search', 'zzzz');
    expect(ids(source)).toEqual([]);
  });

  it('refreshes the Soup page', async () => {
    const { source, query } = mount();
    await source.refresh();
    expect(query.refresh).toHaveBeenCalledOnce();
  });
});
