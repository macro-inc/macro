import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionPicker } from './option-picker';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('option picker', () => {
  it('filters options by the typed text, ignoring case', async () => {
    render(() => {
      const [search, setSearch] = createSignal('');
      return (
        <OptionPicker
          column={{
            id: 'status',
            name: 'Status',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'to-do', label: 'To do', color: null },
              { id: 'doing', label: 'Doing', color: '#0091FF' },
              { id: 'shipped', label: 'Shipped', color: null },
            ],
            writable: true,
          }}
          selected={[]}
          search={search()}
          onSearch={setSearch}
          onPick={vi.fn()}
          onClear={vi.fn()}
          onCreate={vi.fn()}
        />
      );
    });
    const options = () =>
      screen.getAllByRole('option').map((row) => row.textContent);
    expect(options()).toEqual(['To do', 'Doing', 'Shipped']);
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Search Status options' }),
      'DO'
    );
    expect(options()).toEqual(['To do', 'Doing', 'Create “DO”']);
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Search Status options' }),
      'ing'
    );
    expect(options()).toEqual(['Doing']);
  });

  it('says there are no options when a numeric select is searched for text', async () => {
    render(() => {
      const [search, setSearch] = createSignal('');
      return (
        <OptionPicker
          column={{
            id: 'points',
            name: 'Points',
            dataType: 'SELECT_NUMBER',
            isMultiSelect: false,
            options: [{ id: 'one', label: '1', color: null }],
            writable: true,
          }}
          selected={[]}
          search={search()}
          onSearch={setSearch}
          onPick={vi.fn()}
          onClear={vi.fn()}
          onCreate={vi.fn()}
        />
      );
    });
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Search Points options' }),
      'abc'
    );
    expect(screen.queryAllByRole('option')).toEqual([]);
    expect(screen.getByText('No options')).toBeTruthy();
  });

  it('offers to create only a name no option has, whatever its case, and creates it trimmed', async () => {
    const onCreate = vi.fn();
    const onPick = vi.fn();
    render(() => {
      const [search, setSearch] = createSignal('');
      return (
        <OptionPicker
          column={{
            id: 'status',
            name: 'Status',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'to-do', label: 'To do', color: null },
              { id: 'done', label: 'Done', color: null },
            ],
            writable: true,
          }}
          selected={[]}
          search={search()}
          onSearch={setSearch}
          onPick={onPick}
          onClear={vi.fn()}
          onCreate={onCreate}
        />
      );
    });
    const search = screen.getByRole('combobox', {
      name: 'Search Status options',
    });
    await userEvent.type(search, 'done');
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual(
      ['Done']
    );
    expect(screen.queryByRole('option', { name: /Create/ })).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, '  Blocked ');
    await userEvent.click(
      screen.getByRole('option', { name: 'Create “Blocked”' })
    );
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('Blocked');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('moves the active row with the arrow keys, wrapping, while focus stays in the search field', async () => {
    const onPick = vi.fn();
    render(() => {
      const [search, setSearch] = createSignal('');
      return (
        <OptionPicker
          column={{
            id: 'status',
            name: 'Status',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'to-do', label: 'To do', color: null },
              { id: 'doing', label: 'Doing', color: null },
              { id: 'done', label: 'Done', color: null },
            ],
            writable: true,
          }}
          selected={[]}
          search={search()}
          onSearch={setSearch}
          onPick={onPick}
          onClear={vi.fn()}
          onCreate={vi.fn()}
        />
      );
    });
    const search = screen.getByRole('combobox', {
      name: 'Search Status options',
    });
    search.focus();
    expect(search.getAttribute('aria-activedescendant')).toBeNull();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(search.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Doing' }).id
    );
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(search.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Done' }).id
    );
    expect(document.activeElement).toBe(search);
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledExactlyOnceWith('Done');
  });

  it('picks the first match with Enter after typing', async () => {
    const onPick = vi.fn();
    const onCreate = vi.fn();
    render(() => {
      const [search, setSearch] = createSignal('');
      return (
        <OptionPicker
          column={{
            id: 'status',
            name: 'Status',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'to-do', label: 'To do', color: null },
              { id: 'doing', label: 'Doing', color: null },
              { id: 'done', label: 'Done', color: null },
            ],
            writable: true,
          }}
          selected={[]}
          search={search()}
          onSearch={setSearch}
          onPick={onPick}
          onClear={vi.fn()}
          onCreate={onCreate}
        />
      );
    });
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Search Status options' }),
      'do{Enter}'
    );
    expect(onPick).toHaveBeenCalledExactlyOnceWith('To do');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('offers Clear value only while something is selected and nothing is typed', async () => {
    const onClear = vi.fn();
    render(() => {
      const [search, setSearch] = createSignal('');
      return (
        <OptionPicker
          column={{
            id: 'status',
            name: 'Status',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'to-do', label: 'To do', color: null },
              { id: 'done', label: 'Done', color: null },
            ],
            writable: true,
          }}
          selected={['Done']}
          search={search()}
          onSearch={setSearch}
          onPick={vi.fn()}
          onClear={onClear}
          onCreate={vi.fn()}
        />
      );
    });
    expect(screen.getAllByRole('option').map((row) => row.textContent)).toEqual(
      ['Clear value', 'To do', 'Done']
    );
    expect(
      screen.getByRole('option', { name: 'Done' }).getAttribute('aria-selected')
    ).toBe('true');
    const search = screen.getByRole('combobox', {
      name: 'Search Status options',
    });
    await userEvent.type(search, 'd');
    expect(screen.queryByRole('option', { name: 'Clear value' })).toBeNull();
    await userEvent.clear(search);
    await userEvent.click(screen.getByRole('option', { name: 'Clear value' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('hands Tab to its owner with the option it would choose', async () => {
    const onKeyDown = vi.fn();
    render(() => {
      const [search, setSearch] = createSignal('');
      return (
        <OptionPicker
          column={{
            id: 'status',
            name: 'Status',
            dataType: 'SELECT_STRING',
            isMultiSelect: false,
            options: [
              { id: 'to-do', label: 'To do', color: null },
              { id: 'done', label: 'Done', color: null },
            ],
            writable: true,
          }}
          selected={[]}
          search={search()}
          onSearch={setSearch}
          onPick={vi.fn()}
          onClear={vi.fn()}
          onCreate={vi.fn()}
          onKeyDown={onKeyDown}
        />
      );
    });
    const search = screen.getByRole('combobox', {
      name: 'Search Status options',
    });
    fireEvent.keyDown(search, { key: 'Tab' });
    expect(onKeyDown).toHaveBeenLastCalledWith(expect.anything(), undefined);
    fireEvent.input(search, { target: { value: 'don' } });
    fireEvent.keyDown(search, { key: 'Tab' });
    expect(onKeyDown).toHaveBeenLastCalledWith(expect.anything(), 'Done');
  });

  it('gives each option an editor only when option editing is offered', () => {
    const { unmount } = render(() => (
      <OptionPicker
        column={{
          id: 'status',
          name: 'Status',
          dataType: 'SELECT_STRING',
          isMultiSelect: false,
          options: [{ id: 'done', label: 'Done', color: null }],
          writable: true,
        }}
        selected={[]}
        search=""
        onSearch={vi.fn()}
        onPick={vi.fn()}
        onClear={vi.fn()}
        onCreate={vi.fn()}
      />
    ));
    expect(screen.queryByRole('button', { name: 'Edit Done' })).toBeNull();
    unmount();
    render(() => (
      <OptionPicker
        column={{
          id: 'status',
          name: 'Status',
          dataType: 'SELECT_STRING',
          isMultiSelect: false,
          options: [{ id: 'done', label: 'Done', color: null }],
          writable: true,
        }}
        selected={[]}
        search=""
        onSearch={vi.fn()}
        onPick={vi.fn()}
        onClear={vi.fn()}
        onCreate={vi.fn()}
        editing={{
          update: vi.fn(() => okAsync(undefined)),
          remove: vi.fn(() => okAsync(undefined)),
        }}
      />
    ));
    expect(screen.getByRole('button', { name: 'Edit Done' })).toBeTruthy();
  });
});
