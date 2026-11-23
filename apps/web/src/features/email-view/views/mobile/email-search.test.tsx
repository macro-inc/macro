import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEmailSearchSuggestions } from '../../search/create-email-search-suggestions';
import {
  EmailMobileSearchField,
  EmailMobileSearchSuggestions,
} from './email-search';

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
  let input: HTMLInputElement | undefined;

  render(() => {
    const suggestions = createEmailSearchSuggestions({
      userId: () => 'user-a',
      search,
      setSearch,
      scopeAvailable: () => true,
    });
    return (
      <>
        <EmailMobileSearchField
          ref={(element) => {
            input = element;
          }}
          search={search()}
          setSearch={setSearch}
          suggestions={suggestions}
          onCancel={onCancel}
        />
        <EmailMobileSearchSuggestions
          suggestions={suggestions}
          onPicked={() => input?.blur()}
        />
      </>
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
  // A press on a row keeps the field's focus (and the iOS keyboard) up to
  // the pick; iOS still sends mousedown after a cancelled pointerdown.
  const row = screen.getByRole('option', { name: 'budget' });
  expect(fireEvent.pointerDown(row)).toBe(false);
  expect(fireEvent.mouseDown(row)).toBe(false);

  fireEvent.click(screen.getByRole('option', { name: 'budget' }));

  expect(search()).toBe('budget');
  expect(document.activeElement).not.toBe(field);
});

it('clears the field without leaving it, and Cancel or Escape leaves the page', () => {
  const { field, search, onCancel } = renderPage('budget');
  field.focus();

  const clear = screen.getByRole('button', { name: 'Clear search' });
  expect(fireEvent.pointerDown(clear)).toBe(false);
  expect(fireEvent.mouseDown(clear)).toBe(false);
  fireEvent.click(clear);
  expect(search()).toBe('');
  expect(document.activeElement).toBe(field);

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledOnce();

  // Android Back arrives as this Escape; it must be marked handled.
  expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(false);
  expect(onCancel).toHaveBeenCalledTimes(2);
});

it('turns a picked view into a chip, keeps the keyboard up, and Backspace takes it off', () => {
  const { field, search } = renderPage();
  field.focus();
  fireEvent.input(field, { target: { value: 'invoice in:se' } });

  fireEvent.click(screen.getByRole('option', { name: /^Sent/ }));
  expect(search()).toBe('in:sent invoice');
  expect(document.activeElement).toBe(field);
  expect((field as HTMLInputElement).value).toBe('invoice');
  expect(screen.getByRole('group', { name: 'In' }).textContent).toContain(
    'Sent'
  );

  (field as HTMLInputElement).setSelectionRange(0, 0);
  fireEvent.keyDown(field, { key: 'Backspace' });
  expect(search()).toBe('invoice');
  expect(screen.queryByRole('group', { name: 'In' })).toBeNull();
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

it('keeps the keyboard up for the Enter that commits a composition', () => {
  const { field } = renderPage('zhong');
  field.focus();

  fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
  expect(document.activeElement).toBe(field);

  fireEvent.keyDown(field, { key: 'Enter' });
  expect(document.activeElement).not.toBe(field);
});

it('leaves the page on Escape after Search has dropped focus from the field', () => {
  const { field, onCancel } = renderPage('budget');
  field.focus();
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(document.activeElement).not.toBe(field);

  expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false);
  expect(onCancel).toHaveBeenCalledOnce();
});

it('leaves Escape to an open menu, another field and a composition', () => {
  const { field, onCancel } = renderPage('budget');
  const menu = document.createElement('div');
  menu.tabIndex = -1;
  const other = document.createElement('textarea');
  document.body.append(menu, other);

  fireEvent.keyDown(menu, { key: 'Escape' });
  fireEvent.keyDown(other, { key: 'Escape' });
  field.focus();
  fireEvent.keyDown(field, { key: 'Escape', isComposing: true });

  expect(onCancel).not.toHaveBeenCalled();
  menu.remove();
  other.remove();
});
