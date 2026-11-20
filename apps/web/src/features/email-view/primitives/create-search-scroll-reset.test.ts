import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createSearchScrollReset } from './create-search-scroll-reset';

function setup(initial: { query?: string; previous?: boolean } = {}) {
  return createRoot((dispose) => {
    const [query, setQuery] = createSignal(initial.query ?? '');
    const [previous, setPrevious] = createSignal(initial.previous ?? false);
    const reset = vi.fn();
    createSearchScrollReset({ query, showsPreviousRows: previous, reset });
    return { setQuery, setPrevious, reset, dispose };
  });
}

it('scrolls to the top once a new search shows its own results', () => {
  const { setQuery, setPrevious, reset, dispose } = setup();

  // The previous rows stay on screen while the search loads.
  setPrevious(true);
  setQuery('budget');
  expect(reset).not.toHaveBeenCalled();

  setPrevious(false);
  expect(reset).toHaveBeenCalledOnce();
  dispose();
});

it('scrolls to the top at once when no rows are kept, and not for the same query', () => {
  const { setQuery, reset, dispose } = setup();

  setQuery('budget');
  expect(reset).toHaveBeenCalledOnce();

  // Typing a trailing space is the same search.
  setQuery('budget ');
  expect(reset).toHaveBeenCalledOnce();

  setQuery('');
  expect(reset).toHaveBeenCalledTimes(2);
  dispose();
});

it('resets for a search that was still loading when the list mounted', () => {
  const { setPrevious, reset, dispose } = setup({
    query: 'budget',
    previous: true,
  });
  expect(reset).not.toHaveBeenCalled();

  setPrevious(false);
  expect(reset).toHaveBeenCalledOnce();
  dispose();
});

it('keeps the restored position of a list that mounts on its own results', () => {
  const { reset, dispose } = setup({ query: 'budget', previous: false });

  expect(reset).not.toHaveBeenCalled();
  dispose();
});
