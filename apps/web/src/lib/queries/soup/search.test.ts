import { QueryClient } from '@tanstack/solid-query';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useSearchSoupQuery } from './search';

const search = vi.hoisted(() => vi.fn());
const channelState = vi.hoisted(() => ({
  channels: () => [{ id: 'channel', name: 'Original' }],
}));
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

vi.mock('@core/constant/featureFlags', () => ({ ENABLE_SEARCH_SERVICE: true }));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => channelState,
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'Untitled',
  itemToSafeName: (name: string) => name,
}));
vi.mock('@core/user', () => ({ emailToId: (email: string) => email }));
vi.mock('@core/util/result', () => ({
  throwOnErr: (run: () => Promise<unknown>) => run(),
}));
vi.mock('@service-search/client', () => ({ searchClient: { search } }));
vi.mock('@tanstack/solid-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/solid-query')>();
  return {
    ...actual,
    useInfiniteQuery: (
      options: Parameters<typeof actual.useInfiniteQuery>[0]
    ) => actual.useInfiniteQuery(options, () => client),
  };
});

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  client.clear();
  vi.clearAllMocks();
});

it('updates channel names without refetching and binds pagination to each request', async () => {
  search.mockResolvedValue({
    results: [
      {
        type: 'channelMessage',
        channel_id: 'channel',
        message_id: 'message',
        channel_type: 'public',
        sender_id: 'sender',
        created_at: '2026-09-23',
        highlight: {},
      },
    ],
    next_cursor: 'next',
  });
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    const [channels, setChannels] = createSignal([
      { id: 'channel', name: 'Original' },
    ]);
    channelState.channels = channels;
    const [text, setText] = createSignal(' first ');
    const query = useSearchSoupQuery(() => ({
      params: { page_size: 20 },
      body: { query: text(), match_type: 'partial' },
    }));
    return { query, setChannels, setText };
  });

  await vi.waitFor(() => expect(state.query.isSuccess).toBe(true));
  expect(state.query.data?.[0].name).toBe('Original');
  expect(search.mock.calls[0][0]).toMatchObject({
    params: { cursor: null, page_size: 20 },
    request: { query: 'first' },
  });
  state.setChannels([{ id: 'channel', name: 'Renamed' }]);
  await vi.waitFor(() => expect(state.query.data?.[0].name).toBe('Renamed'));
  expect(search).toHaveBeenCalledTimes(1);

  await state.query.fetchNextPage();
  expect(search.mock.calls[1][0]).toMatchObject({
    params: { cursor: 'next', page_size: 20 },
    request: { query: 'first' },
  });
  state.setText(' second ');
  await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(3));
  expect(search.mock.calls[2][0]).toMatchObject({
    params: { cursor: null, page_size: 20 },
    request: { query: 'second' },
  });
  expect(search.mock.calls[2][1].signal).toBeInstanceOf(AbortSignal);
});
