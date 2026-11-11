import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const track = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));
vi.mock('./context', () => ({ useOptionalSearchContext: () => undefined }));

const [query, setQuery] = createStore({
  isSuccess: false,
  isPlaceholderData: false,
  isFetching: false,
  isFetchingNextPage: false,
  data: [] as { id: string }[],
});
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => query,
  validateSearchServiceText: (text: string) => text.length >= 3,
}));

import { createSearchState } from './create-search-state';

beforeEach(() => {
  vi.useFakeTimers();
  track.mockReset();
  setQuery({ isSuccess: false, isFetching: false, data: [] });
});
afterEach(() => {
  vi.useRealTimers();
});

function land(count: number) {
  setQuery({
    isSuccess: true,
    isFetching: false,
    data: Array.from({ length: count }, (_, index) => ({ id: `${index}` })),
  });
}

it('reports only the query the user settles on', () => {
  const [text, setText] = createSignal('');
  const dispose = createRoot((dispose) => {
    createSearchState({
      surface: () => 'email',
      text,
      disableLocalSearch: () => true,
      buildRequest: ({ query, matchType }) => ({
        params: {},
        body: { query, match_type: matchType },
      }),
    });
    return dispose;
  });

  setText('inv');
  vi.advanceTimersByTime(300);
  land(3);
  setQuery({ isFetching: true });
  setText('invoice');
  vi.advanceTimersByTime(300);
  land(12);
  vi.advanceTimersByTime(1500);
  // A refetch or a later page of the same query is not another search.
  setQuery({ isFetching: true });
  land(40);
  vi.advanceTimersByTime(1500);
  dispose();

  expect(track).toHaveBeenCalledExactlyOnceWith('search_performed', {
    surface: 'email',
    matchType: 'partial',
    resultCount: '10-49',
  });
});

it('reports a pending search when the surface closes', () => {
  const dispose = createRoot((dispose) => {
    createSearchState({
      surface: () => 'drive',
      text: () => '"roadmap"',
      disableLocalSearch: () => true,
      buildRequest: ({ query, matchType }) => ({
        params: {},
        body: { query, match_type: matchType },
      }),
    });
    return dispose;
  });
  land(0);
  expect(track).not.toHaveBeenCalled();
  dispose();
  expect(track).toHaveBeenCalledExactlyOnceWith('search_performed', {
    surface: 'drive',
    matchType: 'exact',
    resultCount: '0',
  });
});

it('counts the same query again after the box is cleared', () => {
  const [text, setText] = createSignal('');
  const dispose = createRoot((dispose) => {
    createSearchState({
      surface: () => 'search',
      text,
      disableLocalSearch: () => true,
      buildRequest: ({ query, matchType }) => ({
        params: {},
        body: { query, match_type: matchType },
      }),
    });
    return dispose;
  });

  setText('invoice');
  vi.advanceTimersByTime(300);
  land(3);
  vi.advanceTimersByTime(1500);
  setText('');
  vi.advanceTimersByTime(300);
  setText('invoice');
  vi.advanceTimersByTime(300);
  land(3);
  vi.advanceTimersByTime(1500);
  dispose();

  expect(track).toHaveBeenCalledTimes(2);
});
