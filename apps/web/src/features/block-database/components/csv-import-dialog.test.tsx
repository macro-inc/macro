import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsvImportDialog } from './csv-import-dialog';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
afterEach(cleanup);
const data = { columns: ['Customer', 'Postal code'], rows: [['Ada', '00123']] };

describe('CSV import dialog lifecycle', () => {
  it('focuses the title, preserves retry identity after an unknown outcome, and returns focus after success', async () => {
    const onImport = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValueOnce(undefined);
    const [open, setOpen] = createSignal(true);
    let trigger!: HTMLButtonElement;
    render(() => (
      <>
        <button ref={trigger}>Import CSV</button>
        <Show when={open()}>
          <CsvImportDialog
            data={data}
            initialName="Contacts"
            onImport={onImport}
            onClose={() => setOpen(false)}
            returnFocus={trigger}
          />
        </Show>
      </>
    ));
    const name = screen.getByRole('textbox', {
      name: 'Table name',
    }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe('Contacts'.length);
    fireEvent.submit(name.closest('form')!);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Connection interrupted'
      )
    );
    expect(name.disabled).toBe(true);
    const first = onImport.mock.calls[0][0];
    expect(first.rows[0][1]).toBe('00123');
    fireEvent.submit(name.closest('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onImport.mock.calls[1][0]).toEqual(first);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('unlocks a rejected name and makes a fresh request only after a definite validation refusal', async () => {
    const onImport = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('Choose another name'), {
          code: 'INVALID_SCHEMA',
        })
      )
      .mockResolvedValueOnce(undefined);
    render(() => (
      <CsvImportDialog
        data={data}
        initialName="Contacts"
        onImport={onImport}
        onClose={vi.fn()}
      />
    ));
    const name = screen.getByRole('textbox', {
      name: 'Table name',
    }) as HTMLInputElement;
    fireEvent.submit(name.closest('form')!);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Choose another name')
    );
    expect(name.disabled).toBe(false);
    fireEvent.input(name, { target: { value: 'Customer list' } });
    fireEvent.submit(name.closest('form')!);
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
    expect(onImport.mock.calls[1][0].name).toBe('Customer list');
    expect(onImport.mock.calls[1][0].requestId).not.toBe(
      onImport.mock.calls[0][0].requestId
    );
  });
});
