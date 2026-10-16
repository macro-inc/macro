import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  calls: [] as { args: () => unknown; options: () => unknown }[],
  query: {} as Record<string, unknown>,
}));
vi.mock('@core/util/debounce', () => ({
  debouncedDependent: (value: () => string) => value,
}));
vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: (args: () => unknown, options: () => unknown) => {
    fixture.calls.push({ args, options });
    return fixture.query;
  },
}));

import {
  createScopedTaskSearch,
  scopedTaskSearchText,
} from './scoped-task-search';

it('matches quoted phrases without their quotes', () => {
  expect(scopedTaskSearchText('  "renewal call" ')).toBe('renewal call');
  expect(scopedTaskSearchText(' renewal ')).toBe('renewal');
  expect(scopedTaskSearchText('"')).toBe('"');
});

it('pages the scoped list query by name and stays off without text', () => {
  fixture.calls = [];
  fixture.query = {
    isPending: false,
    isPlaceholderData: false,
    isFetching: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    error: null,
    data: { entities: [{ id: 'task' }] },
    fetchNextPage: vi.fn(),
  };
  createRoot((dispose) => {
    try {
      const [text, setText] = createSignal('');
      const search = createScopedTaskSearch({
        text,
        enabled: () => true,
        args: (nameContains) => ({
          params: { limit: 100 },
          body: { crma: { company: 'acme' }, nc: nameContains },
          groupBy: { type: 'date' },
        }),
      });
      const call = fixture.calls[0];
      expect(search.isSearching()).toBe(false);
      expect(call?.options()).toEqual({ enabled: false });
      expect(search.data()).toEqual([]);
      expect(search.hasNextPage()).toBe(false);

      setText('renewal');
      expect(call?.options()).toEqual({ enabled: true });
      // Search pages flat through the scoped query's own cursor.
      expect(call?.args()).toEqual({
        params: { limit: 100 },
        body: { crma: { company: 'acme' }, nc: 'renewal' },
      });
      expect(search.usesServiceSearch()).toBe(true);
      expect(search.data()).toEqual([{ id: 'task' }]);
      expect(search.hasNextPage()).toBe(true);
    } finally {
      dispose();
    }
  });
});
