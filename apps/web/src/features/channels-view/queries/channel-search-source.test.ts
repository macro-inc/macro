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
    const [rows, setRows] = createSignal([localChannel, localDm]);
    const [remote, setRemote] = createStore<{
      data: ChannelEntity[];
      isFetching: boolean;
      isFetchingNextPage: boolean;
      hasNextPage: boolean;
      isSuccess: boolean;
      isPlaceholderData: boolean;
      error: Error | null;
    }>({
      data: [],
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: true,
      isSuccess: true,
      isPlaceholderData: false,
      error: null,
    });
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
            if (!remote.isSuccess)
              throw new Error('Pending data read would suspend');
            return remote.data;
          },
          get isSuccess() {
            return remote.isSuccess;
          },
          get isPlaceholderData() {
            return remote.isPlaceholderData;
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
          get hasNextPage() {
            return remote.hasNextPage;
          },
          fetchNextPage: serverNextPage,
          refetch: serverRefresh,
        };
      }
    );
    const local: ChannelsDataSource = {
      items: rows,
      isLoading: vi.fn(() => false),
      isFetching: vi.fn(() => false),
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
      setRows,
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

  it('merges local and remote matches once, retaining loaded conversation metadata', () => {
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
      'Alpha channel'
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
    expect(ids(s.source)).toEqual(['channel', 'dm']); // Search includes conversations without message metadata.
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

  it('finishes an empty search while the ordinary list is still loading', async () => {
    const s = setup('nonexistent');
    vi.mocked(s.local.isLoading).mockReturnValue(true);
    vi.mocked(s.local.isFetching).mockReturnValue(true);
    s.setRemote({ isFetching: true });
    expect(s.source.isLoading()).toBe(true);
    expect(s.source.isFetching()).toBe(true);

    s.setRemote({ isFetching: false });
    expect(ids(s.source)).toEqual([]);
    expect(s.source.isLoading()).toBe(false);
    expect(s.source.isFetching()).toBe(false);
    await s.source.loadMore();
    expect(s.serverNextPage).toHaveBeenCalledOnce();
    expect(s.local.loadMore).not.toHaveBeenCalled();

    s.setText('');
    expect(s.source.isFetching()).toBe(true);
    await s.source.loadMore();
    expect(s.local.loadMore).not.toHaveBeenCalled();
    vi.mocked(s.local.isFetching).mockReturnValue(false);
    await s.source.loadMore();
    expect(s.local.loadMore).toHaveBeenCalledOnce();
  });

  it('uses ordinary loading state only when the query is empty', async () => {
    const s = setup('nonexistent');
    s.setRows([]);
    vi.mocked(s.local.isLoading).mockReturnValue(true);
    vi.mocked(s.local.isFetching).mockReturnValue(true);
    s.setText('');
    expect(s.source.isLoading()).toBe(true);
    s.setText('zz');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.queryEnabled()).toBe(false);
    expect(s.source.isLoading()).toBe(false);
    expect(s.source.isFetching()).toBe(false);
    s.setEnabled(false);
    expect(s.source.isLoading()).toBe(false);
    expect(s.source.isFetching()).toBe(false);
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

  it('includes remote-only Recent hits without message metadata and preserves loaded previews', () => {
    const s = setup('alpha');
    const local = {
      ...localChannel,
      participantIds: ['viewer'],
      latestRootMessage: {
        messageId: 'message',
        senderId: 'viewer',
        content: 'Hello',
        mentions: [],
        createdAt: '2026-09-28T12:00:00Z',
      },
    };
    s.setRows([local]);
    s.setScope('recents');
    s.setRemote('data', [
      channel('channel', 'Alpha remote copy'),
      channel('remote', 'Alpha remote', true),
    ]);
    expect(ids(s.source)).toEqual(['channel', 'remote']);
    expect(s.source.items()[0]).toMatchObject(local);
    expect(s.source.items()[1].latestRootMessage).toBeUndefined();
    expect(s.serverNextPage).not.toHaveBeenCalled();
    expect(s.request().body.filters?.channel_filters).toEqual({
      is_participant: true,
      channel_types: undefined,
    });
  });

  it('never reads pending data or exposes placeholder hits and pagination', async () => {
    const s = setup('alpha');
    s.setRemote({ isSuccess: false });
    expect(ids(s.source)).toEqual(['channel', 'dm']);
    s.setRemote({
      isSuccess: true,
      data: [channel('remote', 'Alpha remote')],
      isPlaceholderData: true,
    });
    expect(ids(s.source)).toEqual(['channel', 'dm']);
    expect(s.source.hasMore()).toBe(false);
    await s.source.loadMore();
    expect(s.serverNextPage).not.toHaveBeenCalled();
    s.setRemote('isPlaceholderData', false);
    expect(ids(s.source)).toContain('remote');
    s.setScope('direct_messages');
    s.setRemote('isPlaceholderData', true);
    expect(ids(s.source)).toEqual(['dm']);
    expect(s.source.hasMore()).toBe(false);
  });

  it('ignores an old service fetch for short queries and refreshes search even when browse fails', async () => {
    const s = setup('alpha');
    s.local.refresh = vi.fn(async () => {
      throw new Error('Browse failed');
    });
    await expect(s.source.refresh()).rejects.toThrow('Browse failed');
    expect(s.serverRefresh).toHaveBeenCalledOnce();
    s.setRemote({ isFetching: true, isFetchingNextPage: true });
    s.setText('zz');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.source.isFetching()).toBe(false);
    expect(s.source.isLoadingMore()).toBe(false);
    expect(s.source.hasMore()).toBe(false);
  });

  it('reports only errors from the active source', async () => {
    const s = setup();
    const listError = new Error('List failed');
    const searchError = new Error('Search failed');
    s.local.error = () => listError;
    expect(s.source.error()).toBe(listError);
    s.setText('alpha');
    expect(s.source.error()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    expect(s.source.error()).toBeUndefined();
    s.setRemote('error', searchError);
    expect(s.source.error()).toBe(searchError);
    s.setText('zz');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.source.error()).toBeUndefined();
    s.setText('');
    expect(s.source.error()).toBe(listError);
    s.setEnabled(false);
    expect(s.source.error()).toBeUndefined();
  });
});
