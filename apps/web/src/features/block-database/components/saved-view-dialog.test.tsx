import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveViewDialog } from './saved-view-dialog';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

afterEach(cleanup);

describe('new database view', () => {
  it.each(['save', 'rename'] as const)(
    'focuses and selects the name when opening %s, then tabs to Cancel',
    async (mode) => {
      render(() => (
        <SaveViewDialog
          mode={mode}
          initialName="Planning"
          onSubmit={vi.fn(async () => {})}
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
    }
  );

  it('creates a board from a table without replacing the custom name', async () => {
    const submit = vi.fn(async () => {});
    const close = vi.fn();
    render(() => (
      <SaveViewDialog
        mode="save"
        initialName="Table view"
        initialLayout="table"
        columns={[
          {
            id: 'priority',
            name: 'Priority',
            dataType: 'SELECT_STRING',
            isMultiSelect: true,
            writable: true,
            options: ['High', 'Low'],
          },
        ]}
        onSubmit={submit}
        onClose={close}
      />
    ));
    const input = screen.getByRole('textbox', { name: 'View name' });
    fireEvent.input(input, { target: { value: 'Delivery board' } });
    fireEvent.click(screen.getByRole('button', { name: /Board Cards/ }));
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledExactlyOnceWith(
      'Delivery board',
      'board',
      'priority'
    );
  });

  it('retains the selected layout and draft when saving fails', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(undefined);
    const close = vi.fn();
    render(() => (
      <SaveViewDialog
        mode="save"
        initialName="Table view"
        initialLayout="table"
        columns={[
          {
            id: 'priority',
            name: 'Priority',
            dataType: 'SELECT_STRING',
            isMultiSelect: true,
            writable: true,
            options: ['High', 'Low'],
          },
        ]}
        onSubmit={submit}
        onClose={close}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Board Cards/ }));
    const input = screen.getByRole('textbox', { name: 'View name' });
    fireEvent.submit(input.closest('form')!);
    await screen.findByRole('alert');
    expect(close).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('Board view');
    expect(
      screen
        .getByRole('button', { name: /Board Cards/ })
        .getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenLastCalledWith('Board view', 'board', 'priority');
  });
});
