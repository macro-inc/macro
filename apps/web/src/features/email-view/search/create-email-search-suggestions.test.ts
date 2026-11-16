import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it } from 'vitest';
import { createEmailSearchSuggestions } from './create-email-search-suggestions';

beforeEach(() => localStorage.clear());

function setup(initialSearch = '') {
  const [search, setSearch] = createSignal(initialSearch);
  const suggestions = createEmailSearchSuggestions({
    userId: () => 'user-a',
    search,
    setSearch,
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
    expect(suggestions.listed()).toEqual(['budget']);
    dispose();
  });
});

it('lists recent searches only while the field has focus', () => {
  createRoot((dispose) => {
    const { setSearch, suggestions } = setup('invoice');
    suggestions.setFocused(true);
    suggestions.setFocused(false);
    setSearch('');

    expect(suggestions.listed()).toEqual([]);
    expect(suggestions.count()).toBe(0);

    suggestions.setFocused(true);
    expect(suggestions.listed()).toEqual(['invoice']);
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
    expect(suggestions.listed()).toEqual(['budget', 'quarterly budget']);

    suggestions.setActive(1);
    setSearch('q');
    // Typing narrowed the list to one row.
    expect(suggestions.listed()).toEqual(['quarterly budget']);
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
