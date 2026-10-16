import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OptionEditor } from './option-editor';

beforeEach(() => {
  // JSDOM reports an empty animation name; presence expects CSS's default none.
  const style = document.createElement('style');
  style.textContent = '[role="dialog"] { animation-name: none; }';
  document.head.append(style);
});
afterEach(() => {
  cleanup();
  document.head.querySelectorAll('style').forEach((style) => style.remove());
  vi.restoreAllMocks();
});

describe('option editor', () => {
  it('renames the option on Enter', async () => {
    const editing = {
      update: vi.fn(() => okAsync(undefined)),
      remove: vi.fn(() => okAsync(undefined)),
    };
    render(() => (
      <OptionEditor
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
        option={{ id: 'done', label: 'Done', color: null }}
        editing={editing}
      />
    ));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Done' }));
    const input = await screen.findByRole('textbox', { name: 'Option name' });
    expect((input as HTMLInputElement).value).toBe('Done');
    await userEvent.clear(input);
    await userEvent.type(input, 'Finished{Enter}');
    expect(editing.update).toHaveBeenCalledExactlyOnceWith('status', 'done', {
      label: 'Finished',
    });
  });

  it('renames the option when the name field loses focus, and not when the name is unchanged', async () => {
    const editing = {
      update: vi.fn(() => okAsync(undefined)),
      remove: vi.fn(() => okAsync(undefined)),
    };
    render(() => (
      <OptionEditor
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
        option={{ id: 'done', label: 'Done', color: null }}
        editing={editing}
      />
    ));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Done' }));
    const input = await screen.findByRole('textbox', { name: 'Option name' });
    fireEvent.blur(input);
    expect(editing.update).not.toHaveBeenCalled();
    fireEvent.input(input, { target: { value: 'Shipped' } });
    fireEvent.blur(input);
    expect(editing.update).toHaveBeenCalledExactlyOnceWith('status', 'done', {
      label: 'Shipped',
    });
  });

  it('refuses a name another option already has, ignoring case', async () => {
    const editing = {
      update: vi.fn(() => okAsync(undefined)),
      remove: vi.fn(() => okAsync(undefined)),
    };
    render(() => (
      <OptionEditor
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
        option={{ id: 'done', label: 'Done', color: null }}
        editing={editing}
      />
    ));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Done' }));
    const input = await screen.findByRole('textbox', { name: 'Option name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'to DO{Enter}');
    expect(screen.getByRole('alert').textContent).toBe(
      'Another option already has this name.'
    );
    expect(editing.update).not.toHaveBeenCalled();
  });

  it('sets the colour a swatch names', async () => {
    const editing = {
      update: vi.fn(() => okAsync(undefined)),
      remove: vi.fn(() => okAsync(undefined)),
    };
    render(() => (
      <OptionEditor
        column={{
          id: 'status',
          name: 'Status',
          dataType: 'SELECT_STRING',
          isMultiSelect: false,
          options: [{ id: 'done', label: 'Done', color: '#46A758' }],
          writable: true,
        }}
        option={{ id: 'done', label: 'Done', color: '#46A758' }}
        editing={editing}
      />
    ));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Done' }));
    expect(
      (await screen.findByRole('radio', { name: 'Green' })).getAttribute(
        'aria-checked'
      )
    ).toBe('true');
    await userEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    expect(editing.update).toHaveBeenCalledExactlyOnceWith('status', 'done', {
      color: '#0091FF',
    });
  });

  it('asks before deleting the option and deletes it on confirmation', async () => {
    const editing = {
      update: vi.fn(() => okAsync(undefined)),
      remove: vi.fn(() => okAsync(undefined)),
    };
    render(() => (
      <OptionEditor
        column={{
          id: 'status',
          name: 'Status',
          dataType: 'SELECT_STRING',
          isMultiSelect: false,
          options: [{ id: 'done', label: 'Done', color: null }],
          writable: true,
        }}
        option={{ id: 'done', label: 'Done', color: null }}
        editing={editing}
      />
    ));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Done' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete option' })
    );
    const confirmation = screen.getByRole('alertdialog', {
      name: 'Delete Done?',
    });
    expect(confirmation.textContent).toContain(
      'Cells using “Done” will be cleared.'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(editing.remove).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Delete option' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(editing.remove).toHaveBeenCalledExactlyOnceWith('status', 'done');
  });

  it('says a change reaches everywhere only for a property shared outside the database', async () => {
    const editing = {
      update: vi.fn(() => okAsync(undefined)),
      remove: vi.fn(() => okAsync(undefined)),
    };
    const { unmount } = render(() => (
      <OptionEditor
        column={{
          id: 'status',
          name: 'Status',
          dataType: 'SELECT_STRING',
          isMultiSelect: false,
          options: [{ id: 'done', label: 'Done', color: null }],
          writable: true,
          sharedOutsideDatabase: false,
        }}
        option={{ id: 'done', label: 'Done', color: null }}
        editing={editing}
      />
    ));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Done' }));
    await screen.findByRole('textbox', { name: 'Option name' });
    expect(
      screen.queryByText('Changes everywhere this property is used.')
    ).toBeNull();
    unmount();

    render(() => (
      <OptionEditor
        column={{
          id: 'status',
          name: 'Status',
          dataType: 'SELECT_STRING',
          isMultiSelect: false,
          options: [{ id: 'done', label: 'Done', color: null }],
          writable: true,
          sharedOutsideDatabase: true,
        }}
        option={{ id: 'done', label: 'Done', color: null }}
        editing={editing}
      />
    ));
    await userEvent.click(screen.getByRole('button', { name: 'Edit Done' }));
    expect(
      await screen.findByText('Changes everywhere this property is used.')
    ).toBeTruthy();
  });
});
