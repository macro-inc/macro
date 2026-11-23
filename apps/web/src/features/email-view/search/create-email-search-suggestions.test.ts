import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it } from 'vitest';
import {
  createEmailSearchSuggestions,
  type EmailSearchSuggestions,
} from './create-email-search-suggestions';

beforeEach(() => localStorage.clear());

const recentListed = (suggestions: EmailSearchSuggestions) =>
  suggestions
    .listed()
    .map((row) => (row.kind === 'recent' ? row.search : `view:${row.scope}`));

function setup(initialSearch = '') {
  const [search, setSearch] = createSignal(initialSearch);
  const suggestions = createEmailSearchSuggestions({
    userId: () => 'user-a',
    search,
    setSearch,
    scopeAvailable: (scope) => scope !== 'focus',
  });
  return { search, setSearch, suggestions };
}

it('remembers a search once the field is left with it', () => {
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup();

    suggestions.setFocused(true);
    setSearch('bud');
    setSearch('budget');
    suggestions.setFocused(false);

    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['budget']);
    dispose();
  });
});

it('lists recent searches only while the field has focus', () => {
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup('invoice');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    setSearch('');

    expect(recentListed(suggestions)).toEqual([]);
    expect(suggestions.count()).toBe(0);

    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['invoice']);
    dispose();
  });
});

it('runs the picked search and keeps the active row inside the list', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup('quarterly budget');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    setSearch('budget');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['budget', 'quarterly budget']);

    suggestions.setActive(1);
    setSearch('q');
    // Typing narrowed the list to one row.
    expect(recentListed(suggestions)).toEqual(['quarterly budget']);
    expect(suggestions.active()).toBe(0);

    suggestions.pick(0);
    expect(search()).toBe('quarterly budget');
    dispose();
  });
});

it('waits for a picked search until its results are taken or the field is used again', () => {
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup('budget');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    setSearch('');
    suggestions.setFocused(true);

    suggestions.pick(0);
    suggestions.setFocused(false);
    expect(suggestions.awaitsPickedResults()).toBe(true);
    suggestions.pickedResultsTaken();
    expect(suggestions.awaitsPickedResults()).toBe(false);

    setSearch('');
    suggestions.setFocused(true);
    suggestions.pick(0);
    suggestions.setFocused(false);
    suggestions.setFocused(true);
    expect(suggestions.awaitsPickedResults()).toBe(false);
    dispose();
  });
});

it('lists the views an in: being typed can name, leaving out ones the person lacks', () => {
  createRoot((dispose) => {
    const { search, setSearch, suggestions } = setup();
    suggestions.setFocused(true);

    setSearch('invoice in:');
    expect(recentListed(suggestions)).toEqual([
      'view:inbox',
      'view:signal',
      'view:noise',
      'view:favorites',
      'view:sent',
      'view:drafts',
      'view:calendar',
      'view:shared',
      'view:archived',
    ]);
    setSearch('invoice in:s');
    expect(recentListed(suggestions)).toEqual([
      'view:signal',
      'view:sent',
      'view:shared',
    ]);

    // Picking one makes it the chip and keeps the words typed before it.
    expect(suggestions.editsQuery?.(1)).toBe(true);
    suggestions.pick(1);
    expect(search()).toBe('in:sent invoice');
    expect(suggestions.awaitsPickedResults()).toBe(false);
    dispose();
  });
});

it('remembers a search with its in: filter, and never the filter alone', () => {
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup();
    suggestions.setFocused(true);
    setSearch('in:sent ');
    suggestions.setFocused(false);

    suggestions.setFocused(true);
    setSearch('in:sent invoice');
    suggestions.setFocused(false);

    setSearch('');
    suggestions.setFocused(true);
    expect(recentListed(suggestions)).toEqual(['in:sent invoice']);
    dispose();
  });
});
