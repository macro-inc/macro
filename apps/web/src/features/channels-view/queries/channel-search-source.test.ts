import type { ChannelEntity } from '@entity/types/entity';
import type { useSearchSoupQuery } from '@queries/soup/search';
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelsDataSource, ChannelsSourceScope } from '../queries';
import { createChannelSearchSource } from './channel-search-source';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: queryMock,
  validateSearchServiceText: (text: string) => text.length >= 3,
}));
vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery: vi.fn() }));
vi.mock('@app/features/soup/search/context', () => ({
  useOptionalSearchContext: () => undefined,
}));
vi.mock('@entity', async () => await import('@entity/types/entity'));

const channel = (id: string, name: string, direct = false): ChannelEntity => ({
  id,
  name,
  type: 'channel',
  ownerId: 'viewer',
  isParticipant: true,
  channelType: direct ? 'direct_message' : 'private',
});
const localChannel = channel('channel', 'Alpha channel');
const localDm = channel('dm', 'Alpha person', true);
let dispose: (() => void) | undefined;

function setup(initialText = '', initialScope: ChannelsSourceScope = 'search') {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [text, setText] = createSignal(initialText);
    const [scope, setScope] = createSignal(initialScope);
    const [enabled, setEnabled] = createSignal(true);
    const [remote, setRemote] = createStore<{
      data: ChannelEntity[];
      isFetching: boolean;
      isFetchingNextPage: boolean;
      error: Error | null;
    }>({ data: [], isFetching: false, isFetchingNextPage: false, error: null });
    const serverNextPage = vi.fn(async () => {});
    const serverRefresh = vi.fn(async () => {});
    let request!: Parameters<typeof useSearchSoupQuery>[0];
    let queryEnabled!: () => boolean;
    queryMock.mockImplementation(
      (
        args: typeof request,
        options: Parameters<typeof useSearchSoupQuery>[1]
      ) => {
        request = args;
        queryEnabled = () => options?.().enabled ?? true;
        return {
          get data() {
            return remote.data;
          },
          get isEnabled() {
            return queryEnabled();
          },
          get isFetching() {
            return remote.isFetching;
          },
          get isFetchingNextPage() {
            return remote.isFetchingNextPage;
          },
          get error() {
            return remote.error;
          },
          hasNextPage: true,
          fetchNextPage: serverNextPage,
          refetch: serverRefresh,
        };
      }
    );
    const local: ChannelsDataSource = {
      items: () => [localChannel, localDm],
      isLoading: () => false,
      isFetching: () => false,
      error: () => undefined,
      hasMore: () => true,
      isLoadingMore: () => false,
      loadMore: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    };
    const source = createChannelSearchSource({
      text,
      scope,
      enabled,
      source: () => local,
    });
    return {
      source,
      local,
      request,
      queryEnabled,
      setText,
      setScope,
      setEnabled,
      setRemote,
      serverNextPage,
      serverRefresh,
    };
  });
}

const ids = (source: ChannelsDataSource) =>
  source.items().map((item) => item.id);

describe('shared channel search source', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    dispose?.();
    vi.useRealTimers();
  });

  it('shows the ordinary list for an empty query and restores it on clear', async () => {
    const s = setup();
    expect(ids(s.source)).toEqual(['channel', 'dm']);
    expect(s.queryEnabled()).toBe(false);
    s.setText('nonexistent');
    await vi.advanceTimersByTimeAsync(300);
    expect(ids(s.source)).toEqual([]);
    expect(s.queryEnabled()).toBe(true);
    s.setText('');
    expect(ids(s.source)).toEqual(['channel', 'dm']);
    expect(s.queryEnabled()).toBe(false);
  });

  it('merges local and remote matches once, preferring the service entity', () => {
    const s = setup('alpha');
    s.setRemote('data', [
      channel('channel', 'Alpha updated'),
      channel('remote', 'Alpha remote'),
    ]);
    expect(new Set(ids(s.source))).toEqual(
      new Set(['channel', 'dm', 'remote'])
    );
    expect(s.source.items().filter((row) => row.id === 'channel')).toHaveLength(
      1
    );
    expect(s.source.items().find((row) => row.id === 'channel')?.name).toBe(
      'Alpha updated'
    );
  });

  it('shares the request while enforcing desktop All and mobile tab scopes', () => {
    const s = setup('alpha');
    expect(s.request().body).toMatchObject({
      query: 'alpha',
      search_on: 'name',
      match_type: 'partial',
      filters: { channel_filters: { is_participant: true } },
    });
    expect(ids(s.source)).toHaveLength(2);
    s.setScope('direct_messages');
    expect(s.request().body.filters?.channel_filters?.channel_types).toEqual([
      'direct_message',
    ]);
    expect(ids(s.source)).toEqual(['dm']);
    s.setScope('channels');
    expect(s.request().body.filters?.channel_filters?.channel_types).toEqual([
      'public',
      'private',
      'team',
    ]);
    expect(ids(s.source)).toEqual(['channel']);
    s.setScope('recents');
    expect(ids(s.source)).toEqual([]); // Neither fixture has messages.
  });

  it('paginates and refreshes search results instead of the unfiltered list', async () => {
    const s = setup();
    await s.source.loadMore();
    expect(s.local.loadMore).toHaveBeenCalledOnce();
    s.setText('alpha');
    await vi.advanceTimersByTimeAsync(300);
    await s.source.loadMore();
    expect(s.serverNextPage).toHaveBeenCalledOnce();
    expect(s.local.loadMore).toHaveBeenCalledOnce();
    s.setRemote({ isFetching: true, isFetchingNextPage: true });
    await s.source.loadMore();
    expect(s.serverNextPage).toHaveBeenCalledOnce();
    s.setRemote({ isFetching: false, isFetchingNextPage: false });
    await s.source.refresh();
    expect(s.local.refresh).toHaveBeenCalledOnce();
    expect(s.serverRefresh).toHaveBeenCalledOnce();
  });

  it('hides stale service matches during debounce and stops work when closed', async () => {
    const s = setup('alpha');
    s.setRemote('data', [channel('remote', 'Alpha remote')]);
    s.setText('bravo');
    expect(s.queryEnabled()).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(ids(s.source)).toEqual([]);
    s.setRemote({ isFetching: true });
    await vi.advanceTimersByTimeAsync(280);
    expect(s.source.isLoading()).toBe(true);
    s.setRemote({ isFetching: false, error: new Error('offline'), data: [] });
    expect(s.source.error()).toEqual(new Error('offline'));
    s.setEnabled(false);
    expect(s.queryEnabled()).toBe(false);
    expect(ids(s.source)).toEqual([]);
    expect(s.source.error()).toBeUndefined();
    expect(s.source.hasMore()).toBe(false);
    await s.source.loadMore();
    await s.source.refresh();
    expect(s.serverNextPage).not.toHaveBeenCalled();
    expect(s.local.refresh).not.toHaveBeenCalled();
  });
});
