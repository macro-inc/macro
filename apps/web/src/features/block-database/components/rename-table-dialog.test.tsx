import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenameTableDialog } from './rename-table-dialog';
import { TableNavigation } from './table-navigation';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('rename table dialog', () => {
  it('keeps a failed draft, prevents duplicate submissions, and retries the original name', async () => {
    let reject!: (error: Error) => void;
    const rename = vi
      .fn<(id: string, name: string, previousName: string) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          })
      )
      .mockResolvedValue(undefined);
    const close = vi.fn();
    render(() => (
      <RenameTableDialog
        table={{ id: 'guests', name: 'Guests' }}
        otherNames={['Teams']}
        onRename={rename}
        onClose={close}
      />
    ));
    const input = await screen.findByLabelText('Table name');
    fireEvent.input(input, { target: { value: ' Attendees ' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    expect(rename).toHaveBeenCalledExactlyOnceWith(
      'guests',
      'Attendees',
      'Guests'
    );
    expect((input as HTMLInputElement).readOnly).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    reject(new Error('Connection lost'));
    await screen.findByRole('alert');
    expect((input as HTMLInputElement).value).toBe(' Attendees ');
    expect((input as HTMLInputElement).readOnly).toBe(false);
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(rename).toHaveBeenNthCalledWith(2, 'guests', 'Attendees', 'Guests');
  });

  it('keeps the original table target and name when navigation and refreshed names change during inline rename', async () => {
    const [tables, setTables] = createSignal([
      { id: 'guests', name: 'Guests' },
      { id: 'teams', name: 'Teams' },
    ]);
    const [selected, setSelected] = createSignal('guests');
    const rename = vi.fn(async () => {});
    render(() => (
      <TableNavigation
        tables={tables()}
        activeTableId={selected()}
        canCreate
        onSelect={setSelected}
        onRename={rename}
        onCreate={async () => ({ tableId: 'created', ready: true })}
      />
    ));
    fireEvent.dblClick(screen.getByRole('tab', { name: 'Guests' }));
    const input = await screen.findByLabelText('Table name');
    fireEvent.input(input, { target: { value: 'Attendees' } });
    setSelected('teams');
    setTables([
      { id: 'guests', name: 'Colleagues' },
      { id: 'teams', name: 'Teams' },
    ]);
    expect((input as HTMLInputElement).value).toBe('Attendees');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(rename).toHaveBeenCalledExactlyOnceWith(
        'guests',
        'Attendees',
        'Guests'
      )
    );
  });

  it('does not expose rename through the button, double click, or F2 without edit access', async () => {
    const rename = vi.fn(async () => {});
    render(() => (
      <TableNavigation
        tables={[{ id: 'guests', name: 'Guests' }]}
        activeTableId="guests"
        canCreate={false}
        onSelect={() => {}}
        onRename={rename}
        onCreate={async () => ({ tableId: 'created', ready: true })}
      />
    ));
    const tab = screen.getByRole('tab', { name: 'Guests' });
    expect(screen.queryByRole('button', { name: /Rename table/ })).toBeNull();
    fireEvent.dblClick(tab);
    fireEvent.keyDown(tab, { key: 'F2' });
    fireEvent.contextMenu(tab);
    fireEvent.keyDown(tab, { key: 'F10', shiftKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Table name')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(rename).not.toHaveBeenCalled();
  });
});
