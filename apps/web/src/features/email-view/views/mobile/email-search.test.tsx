import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { createMutable } from 'solid-js/store';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEmailSearchSuggestions } from '../../search/create-email-search-suggestions';
import { EmailMobileSearch } from './email-search';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    'macro:email:recent-searches:v1:user-a',
    JSON.stringify(['budget', 'invoice'])
  );
});

function renderPage(initialSearch = '') {
  const [search, setSearch] = createSignal(initialSearch);
  const onCancel = vi.fn();
  const layoutRefs = createMutable<SplitPanelContextType['layoutRefs']>({});
  const panel = {
    handle: {},
    layoutRefs,
    mobileHeaderOwner: createSignal<symbol>(),
  } as unknown as SplitPanelContextType;

  render(() => {
    const suggestions = createEmailSearchSuggestions({
      userId: () => 'user-a',
      search,
      setSearch,
    });
    return (
      <SplitPanelContext.Provider value={panel}>
        <header>
          <div ref={(element) => (layoutRefs.headerLeft = element)} />
          <div ref={(element) => (layoutRefs.headerRight = element)} />
        </header>
        <EmailMobileSearch
          ref={() => {}}
          search={search()}
          setSearch={setSearch}
          suggestions={suggestions}
          onCancel={onCancel}
        />
      </SplitPanelContext.Provider>
    );
  });

  const field = screen.getByRole('searchbox', { name: 'Search email' });
  return { field, search, onCancel };
}

it('searches as you type and lists matching recent searches while focused', () => {
  const { field, search } = renderPage();
  expect(screen.queryByRole('option')).toBeNull();

  field.focus();
  expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual([
    'budget',
    'invoice',
  ]);

  fireEvent.input(field, { target: { value: 'inv' } });
  expect(search()).toBe('inv');
  expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual([
    'invoice',
  ]);
});

it('runs a picked recent search and drops the keyboard to show its results', () => {
  const { field, search } = renderPage();
  field.focus();

  fireEvent.click(screen.getByRole('option', { name: 'budget' }));

  expect(search()).toBe('budget');
  expect(document.activeElement).not.toBe(field);
});

it('clears the field without leaving it, and Cancel or Escape leaves the page', () => {
  const { field, search, onCancel } = renderPage('budget');
  field.focus();

  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(search()).toBe('');
  expect(document.activeElement).toBe(field);

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledOnce();

  fireEvent.keyDown(field, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(2);
});

it('remembers the search it is left with', () => {
  const { field } = renderPage();
  field.focus();
  fireEvent.input(field, { target: { value: 'quarterly report' } });
  field.blur();
  // The list leaves out the text already typed, so start from an empty field.
  fireEvent.input(field, { target: { value: '' } });

  field.focus();
  expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual([
    'quarterly report',
    'budget',
    'invoice',
  ]);
});
