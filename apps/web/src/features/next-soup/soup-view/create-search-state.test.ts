import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const pool = vi.hoisted(() => vi.fn(() => []));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@app/features/soup/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/features/soup/search')>()),
  useSearchContext: () => ({ entityPool: pool }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => ({ isSuccess: false }),
  validateSearchServiceText: (text: string) => text.length >= 3,
}));
vi.mock('@app/features/next-soup/filters/configs/', () => ({
  SOUP_FILTERS: [],
}));
vi.mock('@app/features/next-soup/soup-view/sort-options', () => ({
  SORT_CONFIGS: {
    updated_at: { id: 'updated_at', fn: () => 0 },
  },
}));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));
vi.mock('@core/component/EntityIcon', () => ({ getIconConfig: vi.fn() }));

import { createSoupState } from '../create-soup-state';
import { createSearchState } from './create-search-state';

afterEach(() => vi.useRealTimers());
it('does not demand the entity pool until local search has text', () => {
  vi.useFakeTimers();
  const [text, setText] = createSignal('');
  const { search, dispose } = createRoot((dispose) => ({
    dispose,
    search: createSearchState({
      surface: () => 'home',
      soup: createSoupState(),
      filters: () => ({ include: {}, exclude: {} }),
      assignees: () => [],
      searchText: text,
      setSearchText: setText,
    }),
  }));
  expect(search.localFuzzyResults()).toEqual([]);
  expect(pool).not.toHaveBeenCalled();
  setText('budget');
  vi.advanceTimersByTime(20);
  expect(search.localFuzzyResults()).toEqual([]);
  expect(pool).toHaveBeenCalledOnce();
  setText('');
  vi.advanceTimersByTime(20);
  expect(pool).toHaveBeenCalledOnce();
  dispose();
});
