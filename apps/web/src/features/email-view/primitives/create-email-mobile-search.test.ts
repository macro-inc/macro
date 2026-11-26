import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createEmailMobileSearch } from './create-email-mobile-search';

function setup(options: { search?: string; available?: boolean } = {}) {
  return createRoot((dispose) => {
    const [search, setSearch] = createSignal(options.search ?? '');
    const [available, setAvailable] = createSignal(options.available ?? true);
    const page = createEmailMobileSearch({ available, search, setSearch });
    return { page, search, setSearch, setAvailable, dispose };
  });
}

it('opens only when search is available, and Cancel ends its search', () => {
  const { page, search, setSearch, setAvailable, dispose } = setup({
    available: false,
  });

  page.open();
  expect(page.searching()).toBe(false);

  setAvailable(true);
  expect(page.searching()).toBe(true);

  setSearch('budget');
  page.close();
  expect(page.searching()).toBe(false);
  expect(search()).toBe('');
  dispose();
});

it('opens on its results when the view is restored with a search', () => {
  const { page, dispose } = setup({ search: 'budget' });

  expect(page.searching()).toBe(true);
  dispose();
});

it('ends its search when it goes away without Cancel', () => {
  const { page, search, setSearch, setAvailable, dispose } = setup();
  page.open();
  setSearch('budget');

  // The flag turns off, or the tab changes to one that cannot search.
  setAvailable(false);

  expect(search()).toBe('');
  setAvailable(true);
  expect(page.searching()).toBe(false);
  dispose();
});
