import { queryClient } from '@queries/client';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { okAsync } from 'neverthrow';
import { createRenderEffect, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { type SearchSoupQueryArgs, useSearchSoupQuery } from './search';

const server = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { staleTime: 5 * 60_000, retry: false } },
    }),
  };
});
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_SEARCH_SERVICE: true,
}));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channels: () => [] }),
}));
vi.mock('@service-search/client', () => ({
  searchClient: { search: server.search },
}));
vi.mock('@queries/soup/transform-utils', () => ({
  createSearchResponseItemMapper:
    () =>
    ({ id }: { id: string }) => [{ type: 'calendar_event', id, search: {} }],
  mapChannelSearchResultItem: vi.fn(),
}));

afterEach(() => {
  cleanup();
  queryClient.clear();
  server.search.mockReset();
});

const args = (): SearchSoupQueryArgs => ({
  params: { cursor: null, page_size: 10 },
  body: { match_type: 'partial', search_on: 'name', query: 'quokka' },
});

function answer(...ids: string[]) {
  return okAsync({ results: ids.map((id) => ({ id })), next_cursor: null });
}

function searchTwice(staleTime?: number) {
  const [shown, setShown] = createSignal(true);
  const seen: string[][] = [];
  function Menu() {
    const query = useSearchSoupQuery(args, () => ({ staleTime }));
    createRenderEffect(() =>
      seen.push(query.isSuccess ? query.data.map(({ id }) => id) : [])
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      {shown() ? <Menu /> : null}
    </QueryClientProvider>
  ));
  return { seen, hide: () => setShown(false), show: () => setShown(true) };
}

it('asks again when a search with no stale time is shown again, keeping the earlier answer until it lands', async () => {
  server.search
    .mockReturnValueOnce(answer('shared-event'))
    .mockReturnValueOnce(answer());
  const menu = searchTwice(0);
  await waitFor(() => expect(menu.seen.at(-1)).toEqual(['shared-event']));

  menu.hide();
  menu.show();
  expect(menu.seen.at(-1)).toEqual(['shared-event']);
  await waitFor(() => expect(menu.seen.at(-1)).toEqual([]));
  expect(server.search).toHaveBeenCalledTimes(2);
});

it('replays a fresh answer when shown again under the default stale time', async () => {
  server.search.mockReturnValue(answer('shared-event'));
  const menu = searchTwice();
  await waitFor(() => expect(menu.seen.at(-1)).toEqual(['shared-event']));

  menu.hide();
  menu.show();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(menu.seen.at(-1)).toEqual(['shared-event']);
  expect(server.search).toHaveBeenCalledTimes(1);
});
