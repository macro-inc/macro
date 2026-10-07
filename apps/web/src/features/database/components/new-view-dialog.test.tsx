import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseViewColumn } from '../core/database-view';
import { NewViewDialog } from './new-view-dialog';

vi.mock('../../../lib/core/mobile/isMobile', () => ({ isMobile: () => false }));

afterEach(cleanup);

const priority: DatabaseViewColumn = {
  id: 'priority',
  name: 'Priority',
  dataType: 'SELECT_STRING',
  isMultiSelect: false,
  writable: true,
  options: [
    { id: 'high', label: 'High', color: null },
    { id: 'low', label: 'Low', color: null },
  ],
};

describe('new database view', () => {
  it('focuses and selects the name, then tabs to Cancel', async () => {
    render(() => (
      <NewViewDialog
        initialName="Planning"
        columns={[]}
        onSubmit={vi.fn(() => okAsync(undefined))}
        onClose={vi.fn()}
      />
    ));
    const name = screen.getByRole('textbox', {
      name: 'View name',
    }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe(name.value.length);
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cancel' })
    );
  });

  it('creates a board grouped by the first single select, keeping a custom name', async () => {
    const submit = vi.fn(() => okAsync(undefined));
    const close = vi.fn();
    render(() => (
      <NewViewDialog
        initialName="Table view"
        initialLayout="table"
        columns={[priority]}
        onSubmit={submit}
        onClose={close}
      />
    ));
    const input = screen.getByRole('textbox', { name: 'View name' });
    fireEvent.input(input, { target: { value: 'Delivery board' } });
    fireEvent.click(screen.getByRole('button', { name: /Board Cards/ }));
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      name: 'Delivery board',
      layout: 'board',
      groupBy: { kind: 'column', columnId: 'priority' },
    });
  });

  it('keeps the layout and draft, and says why, when creating fails', async () => {
    const submit = vi
      .fn()
      .mockReturnValueOnce(
        errAsync({
          kind: 'ops',
          error: {
            code: 'INVALID_OP',
            message: 'a view named `Board view` already exists on this table',
            refusal: {
              op: 0,
              row: null,
              column: null,
              message: 'a view named `Board view` already exists on this table',
            },
          },
        })
      )
      .mockReturnValueOnce(okAsync(undefined));
    const close = vi.fn();
    render(() => (
      <NewViewDialog
        initialName="Table view"
        initialLayout="table"
        columns={[priority]}
        onSubmit={submit}
        onClose={close}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Board Cards/ }));
    const input = screen.getByRole('textbox', { name: 'View name' });
    fireEvent.submit(input.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'a view named `Board view` already exists on this table'
    );
    expect(close).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('Board view');
    expect(
      screen
        .getByRole('button', { name: /Board Cards/ })
        .getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenLastCalledWith({
      name: 'Board view',
      layout: 'board',
      groupBy: { kind: 'column', columnId: 'priority' },
    });
  });

  it('offers to create a Status column when nothing can group a board, chosen already', async () => {
    const submit = vi.fn(() => okAsync(undefined));
    const close = vi.fn();
    render(() => (
      <NewViewDialog
        initialName="Board view"
        initialLayout="board"
        columns={[
          {
            id: 'name',
            name: 'Name',
            dataType: 'STRING',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        onSubmit={submit}
        onClose={close}
      />
    ));

    expect(screen.getByLabelText('Group board by').textContent).toContain(
      'Create a Status column'
    );
    fireEvent.submit(
      screen.getByRole('textbox', { name: 'View name' }).closest('form')!
    );
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      name: 'Board view',
      layout: 'board',
      groupBy: { kind: 'new-status' },
    });
  });

  it('groups a board by a single-person column', async () => {
    const submit = vi.fn(() => okAsync(undefined));
    render(() => (
      <NewViewDialog
        initialName="By owner"
        initialLayout="board"
        columns={[
          {
            id: 'owner',
            name: 'Owner',
            dataType: 'ENTITY',
            specificEntityType: 'USER',
            isMultiSelect: false,
            writable: true,
            options: [],
          },
        ]}
        onSubmit={submit}
        onClose={vi.fn()}
      />
    ));

    fireEvent.submit(
      screen.getByRole('textbox', { name: 'View name' }).closest('form')!
    );
    await waitFor(() =>
      expect(submit).toHaveBeenCalledExactlyOnceWith({
        name: 'By owner',
        layout: 'board',
        groupBy: { kind: 'column', columnId: 'owner' },
      })
    );
  });

  it('offers a Form beside table and board when given one, creating it under its own name without a view', async () => {
    const submit = vi.fn(() => okAsync(undefined));
    const createForm = vi.fn(async () => undefined);
    const close = vi.fn();
    render(() => (
      <NewViewDialog
        initialName="Table view"
        columns={[priority]}
        form={{ initialName: 'Guests form', onCreate: createForm }}
        onSubmit={submit}
        onClose={close}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Form Collect/ }));
    const input = screen.getByRole('textbox', {
      name: 'Form name',
    }) as HTMLInputElement;
    expect(input.value).toBe('Guests form');
    fireEvent.input(input, { target: { value: 'RSVP' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(createForm).toHaveBeenCalledExactlyOnceWith('RSVP');
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and says why when the form is refused', async () => {
    const close = vi.fn();
    render(() => (
      <NewViewDialog
        initialName="Table view"
        columns={[]}
        form={{
          initialName: 'Guests form',
          onCreate: async () =>
            'Only the database owner can make a form over this table.',
        }}
        onSubmit={vi.fn(() => okAsync(undefined))}
        onClose={close}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Form Collect/ }));
    fireEvent.submit(
      screen.getByRole('textbox', { name: 'Form name' }).closest('form')!
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only the database owner can make a form over this table.'
    );
    expect(close).not.toHaveBeenCalled();
  });

  it('offers no Form when not given one', () => {
    render(() => (
      <NewViewDialog
        initialName="Table view"
        columns={[]}
        onSubmit={vi.fn(() => okAsync(undefined))}
        onClose={vi.fn()}
      />
    ));
    expect(screen.queryByRole('button', { name: /Form Collect/ })).toBeNull();
  });
});
