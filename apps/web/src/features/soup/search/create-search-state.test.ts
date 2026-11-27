import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const track = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));

const [query, setQuery] = createStore({
  isSuccess: false,
  isPlaceholderData: false,
  isFetching: false,
  isFetchingNextPage: false,
  data: [] as { id: string }[],
});
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => query,
  validateSearchServiceText: (text: string) =>
    text.replaceAll('"', '').trim().length > 0,
}));

const verify = vi.hoisted(() => vi.fn());
vi.mock('@queries/soup/graphql/document-reconcile', () => ({
  createDocumentVerifier: () => ({ verify, dispose: () => {} }),
}));

import type { EntityData } from '@entity/types/entity';
import { createSearchState, soupSearchMatchType } from './create-search-state';

beforeEach(() => {
  vi.useFakeTimers();
  track.mockReset();
  verify.mockReset();
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

it('searches for one quoted phrase exactly, in straight or curly quotes', () => {
  for (const query of ['"team lunch"', '“team lunch”', '„team lunch“']) {
    expect(soupSearchMatchType(query)).toBe('exact');
  }
  for (const query of ['team lunch', '“team lunch” menu', '“team” “lunch”']) {
    expect(soupSearchMatchType(query)).toBe('partial');
  }
});

it('settles once the name text does, when operators leave it empty', () => {
  const [text, setText] = createSignal('');
  const [nameText, setNameText] = createSignal('');
  const { state, dispose } = createRoot((dispose) => ({
    state: createSearchState({
      surface: () => 'search',
      text,
      nameText,
      disableLocalSearch: () => true,
      buildRequest: ({ query, matchType }) => ({
        params: {},
        body: { query, match_type: matchType },
      }),
    }),
    dispose,
  }));

  setText('budget');
  setNameText('budget');
  vi.advanceTimersByTime(300);
  expect(state.isLocalSearchSettling()).toBe(false);

  // `tag:work` narrows past name matches, so the name text empties.
  setText('budget tag:work');
  setNameText('');
  vi.advanceTimersByTime(300);
  expect(state.isLocalSearchSettling()).toBe(false);
  dispose();
});

it('checks on the server the documents local search features', () => {
  // The cache can hold a document deleted while this client missed the
  // realtime patch; local search alone would keep featuring it.
  const pool = [
    { id: 'doc-1', type: 'document', name: 'Launch checklist' },
    { id: 'channel-1', type: 'channel', name: 'Launch channel' },
    { id: 'doc-2', type: 'document', name: 'Launch plan' },
  ].map((data) => ({ data: data as unknown as EntityData }));
  const [text, setText] = createSignal('');
  const dispose = createRoot((dispose) => {
    createSearchState({
      surface: () => 'search',
      text,
      localPool: () => pool,
      buildRequest: ({ query, matchType }) => ({
        params: {},
        body: { query, match_type: matchType },
      }),
    });
    return dispose;
  });

  setText('launch');
  vi.advanceTimersByTime(100);
  expect(verify).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  dispose();

  expect(verify).toHaveBeenCalledOnce();
  expect([...(verify.mock.calls[0]?.[0] ?? [])].sort()).toEqual([
    'doc-1',
    'doc-2',
  ]);
});

it('checks nothing on the server while the search is paused', () => {
  const pool = [
    { id: 'doc-1', type: 'document', name: 'Launch checklist' },
  ].map((data) => ({ data: data as unknown as EntityData }));
  const [text, setText] = createSignal('');
  const dispose = createRoot((dispose) => {
    createSearchState({
      surface: () => 'search',
      text,
      searchPaused: () => true,
      localPool: () => pool,
      buildRequest: ({ query, matchType }) => ({
        params: {},
        body: { query, match_type: matchType },
      }),
    });
    return dispose;
  });

  setText('launch');
  vi.advanceTimersByTime(1_000);
  dispose();

  expect(verify).not.toHaveBeenCalled();
});
