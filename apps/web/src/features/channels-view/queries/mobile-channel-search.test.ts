import type { ChannelEntity } from '@entity/types/entity';
import type { SearchSoupQueryArgs } from '@queries/soup/search';
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelsQueryScope } from '../types';

const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: mocks.search,
  validateSearchServiceText: (text: string) => text.length >= 3,
}));
vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery: vi.fn() }));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
}));

import { useMobileChannelSearch } from './mobile-channel-search';

const channel = (
  id: string,
  name: string,
  channelType: ChannelEntity['channelType'] = 'direct_message'
): ChannelEntity => ({
  id,
  name,
  channelType,
  type: 'channel',
  ownerId: 'viewer',
});

const julia = channel('julia', 'Julia Westphal');
const hutch = channel('hutch', 'hutch');
let dispose: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});

function setup(initialText = '') {
  return createRoot((rootDispose) => {
    dispose = rootDispose;
    const [text, setText] = createSignal(initialText);
    const [scope, setScope] =
      createSignal<ChannelsQueryScope>('direct_messages');
    const [rows, setRows] = createSignal<ChannelEntity[]>([julia, hutch]);
    const [state, setState] = createStore({
      isSuccess: false,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      isPlaceholderData: false,
      hasNextPage: false,
      error: null as Error | null,
      data: [] as ChannelEntity[],
    });
    const fetchNextPage = vi.fn(async () => {});
    const refetch = vi.fn(async () => {});
    let args: () => SearchSoupQueryArgs;
    let enabled: () => { enabled: boolean };
    mocks.search.mockImplementation((getArgs, getOptions) => {
      args = getArgs;
      enabled = getOptions;
      return {
        get isSuccess() {
          return state.isSuccess;
        },
        get isLoading() {
          return state.isLoading;
        },
        get isFetching() {
          return state.isFetching;
        },
        get isFetchingNextPage() {
          return state.isFetchingNextPage;
        },
        get isPlaceholderData() {
          return state.isPlaceholderData;
        },
        get hasNextPage() {
          return state.hasNextPage;
        },
        get error() {
          return state.error;
        },
        get isEnabled() {
          return enabled().enabled;
        },
        get data() {
          if (!state.isSuccess)
            throw new Error('Pending data read would suspend');
          return state.data;
        },
        fetchNextPage,
        refetch,
      };
    });
    const source = {
      items: rows,
      isLoading: () => false,
      isFetching: () => false,
      isLoadingMore: () => false,
      hasMore: () => true,
      error: () => undefined,
      loadMore: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    };
    const result = useMobileChannelSearch({
      text,
      scope,
      source: () => source,
    });
    return {
      result,
      source,
      setText,
      setScope,
      setRows,
      setState,
      fetchNextPage,
      refetch,
      args: () => args(),
      enabled: () => enabled().enabled,
    };
  });
}

describe('mobile channel search', () => {
  it('filters loaded DMs immediately and never reads disabled/pending data', () => {
    const test = setup();
    expect(test.result.items()).toEqual([julia, hutch]);
    test.setText(' JU ');
    expect(test.result.items()).toEqual([julia]);
    expect(test.enabled()).toBe(false);
    expect(test.result.isLoading()).toBe(false);
    test.setText('Julia');
    expect(test.result.items()).toEqual([julia]);
    expect(test.enabled()).toBe(false);
  });

  it('searches beyond the loaded page with a debounced participant-only name query', async () => {
    const test = setup();
    test.setRows([hutch]);
    test.setText(' Julia ');
    expect(test.result.items()).toEqual([]);
    expect(test.result.isLoading()).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(test.enabled()).toBe(true);
    expect(test.args().body).toMatchObject({
      query: 'Julia',
      search_on: 'name',
      match_type: 'partial',
      filters: {
        channel_filters: {
          is_participant: true,
          channel_types: ['direct_message'],
        },
        document_filters: {
          document_ids: ['00000000-0000-0000-0000-000000000000'],
        },
      },
    });
    test.setState({ isSuccess: true, data: [julia] });
    expect(test.result.items()).toEqual([julia]);
    expect(test.result.isLoading()).toBe(false);
  });

  it('deduplicates remote hits while retaining the loaded row metadata', () => {
    const test = setup('Julia');
    test.setRows([{ ...julia, participantIds: ['viewer', 'julia-user'] }]);
    test.setState({
      isSuccess: true,
      data: [julia, channel('julian', 'Julian')],
    });
    expect(test.result.items().map((row) => row.id)).toEqual([
      'julia',
      'julian',
    ]);
    expect(test.result.items()[0].participantIds).toEqual([
      'viewer',
      'julia-user',
    ]);
  });

  it('changes tab filters and excludes placeholder results from the previous tab', () => {
    const test = setup('Julia');
    test.setState({ isSuccess: true, data: [julia] });
    test.setRows([]);
    test.setScope('channels');
    test.setState('isPlaceholderData', true);
    expect(test.result.items()).toEqual([]);
    expect(test.args().body.filters?.channel_filters?.channel_types).toEqual([
      'public',
      'private',
      'team',
    ]);
    const team = channel('team', 'Julia project', 'team');
    test.setState({ isPlaceholderData: false, data: [team, julia] });
    expect(test.result.items()).toEqual([team]);
    test.setScope('recents');
    expect(
      test.args().body.filters?.channel_filters?.channel_types
    ).toBeUndefined();
    expect(test.result.items()).toEqual([team, julia]);
  });

  it('hides stale hits during debounce and placeholder data after changing the text', async () => {
    const test = setup('Julia');
    test.setState({ isSuccess: true, data: [julia], hasNextPage: true });
    test.setText('hutch');
    expect(test.result.items()).toEqual([hutch]);
    expect(test.result.hasMore()).toBe(false);
    test.setState('isPlaceholderData', true);
    await vi.advanceTimersByTimeAsync(300);
    expect(test.result.items()).toEqual([hutch]);
    expect(test.result.hasMore()).toBe(false);
    test.setText('zzzzzz');
    test.setState({ isSuccess: false, isPlaceholderData: false });
    await vi.advanceTimersByTimeAsync(300);
    expect(test.result.items()).toEqual([]);
  });

  it('paginates search results without discarding hits and restores browse pagination on clear', async () => {
    const test = setup('Julia');
    test.setState({ isSuccess: true, data: [julia], hasNextPage: true });
    await test.result.loadMore();
    expect(test.fetchNextPage).toHaveBeenCalledOnce();
    expect(test.source.loadMore).not.toHaveBeenCalled();
    test.setState({ isFetching: true, isFetchingNextPage: true });
    expect(test.result.items()).toEqual([julia]);
    expect(test.result.isLoadingMore()).toBe(true);
    await test.result.loadMore();
    expect(test.fetchNextPage).toHaveBeenCalledOnce();
    test.setText('');
    expect(test.result.items()).toEqual([julia, hutch]);
    await test.result.loadMore();
    expect(test.source.loadMore).toHaveBeenCalledOnce();
  });

  it('reports search failures without losing local hits and retries only valid searches', async () => {
    const test = setup('Julia');
    const error = new Error('offline');
    test.setState('error', error);
    expect(test.result.items()).toEqual([julia]);
    expect(test.result.error()).toBe(error);
    await test.result.refresh();
    expect(test.refetch).toHaveBeenCalledWith({ throwOnError: true });
    test.setText('Ju');
    expect(test.result.error()).toBeUndefined();
    await test.result.refresh();
    expect(test.refetch).toHaveBeenCalledOnce();
    expect(test.source.refresh).toHaveBeenCalledTimes(2);
  });
});
