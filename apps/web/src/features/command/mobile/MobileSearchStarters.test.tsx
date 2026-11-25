import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

vi.mock(
  '@app/features/next-soup/soup-view/filters-bar/search-operator-values',
  () => ({
    createSearchOperatorValues: () => () => ({
      people: [],
      tags: ['Q3 launch'],
      inboxes: [],
      channels: [],
    }),
  })
);

import { createMobileSearchSuggestions } from './MobileSearchStarters';

const suggest = (initial: string) => {
  const [query, setQuery] = createSignal(initial);
  const suggestions = createMobileSearchSuggestions(query, setQuery);
  return { query, setQuery, suggestions };
};

it('writes a picked row in place of what is typed, then a space', () => {
  createRoot((dispose) => {
    const { query, setQuery, suggestions } = suggest('launch type:ta');
    expect(suggestions.showing()).toBe(true);
    suggestions.pickRow(0);
    expect(query()).toBe('launch type:task ');
    expect(suggestions.showing()).toBe(false);

    setQuery('launch tag:q');
    suggestions.pickRow(0);
    expect(query()).toBe('launch tag:"Q3 launch" ');

    // An operator's name leaves its value to be picked next.
    setQuery('launch ty');
    suggestions.pickRow(0);
    expect(query()).toBe('launch type:');
    dispose();
  });
});

it('offers spans and a picked date for a date operator', () => {
  createRoot((dispose) => {
    const { query, setQuery, suggestions } = suggest('launch newer_than:');
    expect(suggestions.typesDate()).toBe(true);
    suggestions.pickSpan('7d');
    expect(query()).toBe('launch newer_than:7d ');

    setQuery('launch newer_than:');
    suggestions.pickDate('2026-06-01');
    expect(query()).toBe('launch after:2026/06/01 ');

    // A whole date operator at the end offers nothing more.
    setQuery('launch newer_than:7d');
    expect(suggestions.typesDate()).toBe(false);
    dispose();
  });
});
