import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../core/database-view';
import { DatabaseRelationCell } from './database-relation-cell';

const column: DatabaseViewColumn = {
  id: 'customer',
  name: 'Customer',
  dataType: 'STRING',
  isMultiSelect: false,
  options: [],
  writable: true,
  relation: { databaseId: 'db', tableId: 'customers' },
};
const source = {
  name: () => 'Customers',
  rows: () => [
    { id: 'acme-id', name: 'Acme' },
    { id: 'north-id', name: 'Northwind' },
  ],
  loading: () => false,
  error: () => undefined,
  refresh: async () => {},
};
let presenceStyles: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  presenceStyles = document.createElement('style');
  presenceStyles.textContent = '[role=dialog] { animation-name: none; }';
  document.head.append(presenceStyles);
});
afterEach(() => {
  cleanup();
  presenceStyles.remove();
  vi.restoreAllMocks();
});

function setup(
  options: {
    canEdit?: boolean;
    value?: DatabaseCellValue;
    fail?: boolean;
    save?: (next: DatabaseCellValue) => Promise<boolean>;
    navigate?: (direction: 1 | -1) => boolean;
  } = {}
) {
  const [value, setValue] = createSignal<DatabaseCellValue>(
    options.value ?? '["acme-id"]'
  );
  const write = vi.fn(async (next: DatabaseCellValue) => {
    if (options.fail) return false;
    if (options.save && !(await options.save(next))) return false;
    setValue(next);
    return true;
  });
  const open = vi.fn();
  render(() => (
    <>
      <DatabaseRelationCell
        column={column}
        value={value()}
        canEdit={options.canEdit ?? true}
        source={source}
        onWrite={write}
        onOpen={open}
        onNavigate={options.navigate}
      />
      <button type="button">After cell</button>
    </>
  ));
  return { write, open, value };
}

describe('database relationships', () => {
  it.each([false, true])(
    'does not advance after a pending Tab selection is dismissed (reopen: %s)',
    async (reopen) => {
      let complete!: (saved: boolean) => void;
      const navigate = vi.fn(() => true);
      const { value } = setup({
        value: '[]',
        navigate,
        save: () => new Promise((resolve) => (complete = resolve)),
      });
      const trigger = screen.getByRole('button', {
        name: /Choose related records/,
      });
      fireEvent.click(trigger);
      const input = await screen.findByRole('combobox');
      fireEvent.input(input, { target: { value: 'Acme' } });
      fireEvent.keyDown(input, { key: 'Tab' });
      fireEvent.keyDown(input, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
      if (reopen) {
        fireEvent.click(trigger);
        await screen.findByRole('combobox');
      }
      complete(true);
      await waitFor(() => expect(value()).toBe('["acme-id"]'));
      // Let the acknowledgement's entire promise chain finish before checking
      // that a deferred focus change did not happen.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(navigate).not.toHaveBeenCalled();
      if (reopen) {
        expect(screen.getByRole('combobox')).toBe(document.activeElement);
      } else {
        expect(document.activeElement).toBe(trigger);
      }
    }
  );

  it('drains selections queued during retry before closing the picker', async () => {
    const complete: Array<(saved: boolean) => void> = [];
    const { write, value } = setup({
      value: '[]',
      save: () => new Promise((resolve) => complete.push(resolve)),
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Choose related records/ })
    );
    fireEvent.click(await screen.findByRole('option', { name: 'Acme' }));
    complete[0](false);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('option', { name: 'Northwind' }));
    expect(write).toHaveBeenCalledTimes(2);
    complete[1](true);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(write).toHaveBeenLastCalledWith('["acme-id","north-id"]');
    expect(screen.getByRole('combobox')).toBeTruthy();
    complete[2](true);
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    expect(value()).toBe('["acme-id","north-id"]');
  });

  it('queues rapid selections and waits for the final write before Tab advances', async () => {
    const complete: Array<(saved: boolean) => void> = [];
    const navigate = vi.fn(() => true);
    const { write, value } = setup({
      value: '[]',
      navigate,
      save: () => new Promise((resolve) => complete.push(resolve)),
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Choose related records/ })
    );
    const input = await screen.findByRole('combobox');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Remove Northwind' })
    ).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
    complete[0](true);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenLastCalledWith('["acme-id","north-id"]');
    expect(navigate).not.toHaveBeenCalled();
    complete[1](true);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(1));
    expect(value()).toBe('["acme-id","north-id"]');
  });

  it('keeps the complete queued selection after failure and retries it without advancing', async () => {
    const complete: Array<(saved: boolean) => void> = [];
    const navigate = vi.fn(() => true);
    const { write, value } = setup({
      value: '[]',
      navigate,
      save: () => new Promise((resolve) => complete.push(resolve)),
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Choose related records/ })
    );
    const input = await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('option', { name: 'Acme' }));
    fireEvent.click(screen.getByRole('option', { name: 'Northwind' }));
    fireEvent.keyDown(input, { key: 'Tab' });
    complete[0](false);
    await screen.findByRole('alert');
    expect(navigate).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Remove Acme' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Remove Northwind' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(write).toHaveBeenLastCalledWith('["acme-id","north-id"]');
    complete[1](true);
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    expect(value()).toBe('["acme-id","north-id"]');
  });

  it('saves a searched customer on Tab before advancing, and keeps a rejected selection in the picker', async () => {
    const navigate = vi.fn(() => true);
    const { write } = setup({ navigate });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Customer: Acme. Choose related records',
      })
    );
    const input = await screen.findByRole('combobox');
    fireEvent.input(input, { target: { value: 'North' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(1));
    expect(write).toHaveBeenCalledWith('["acme-id","north-id"]');
  });

  it('preserves a failed searched selection and focus instead of navigating away', async () => {
    const navigate = vi.fn(() => true);
    setup({ navigate, fail: true });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Customer: Acme. Choose related records',
      })
    );
    const input = await screen.findByRole('combobox');
    fireEvent.input(input, { target: { value: 'North' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    await screen.findByRole('alert');
    expect(navigate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Remove Northwind' })
    ).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it('shows customer names for a relation backed by a legacy scalar Text definition, then picks/removes rows', async () => {
    const { write } = setup();
    const trigger = screen.getByRole('button', {
      name: 'Customer: Acme. Choose related records',
    });
    expect(trigger.textContent).toContain('Acme');
    expect(trigger.textContent).not.toContain('acme-id');
    fireEvent.click(trigger);
    const input = await screen.findByRole('combobox', {
      name: 'Search Customers',
    });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.input(input, { target: { value: 'north' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith('["acme-id","north-id"]')
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Remove Acme' })
          .hasAttribute('disabled')
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Acme' }));
    await waitFor(() => expect(write).toHaveBeenLastCalledWith('["north-id"]'));
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('opens the selected related record, and read-only cells never write', async () => {
    const { open, write } = setup({ canEdit: false });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Customer: Acme. View related records',
      })
    );
    await screen.findByRole('combobox');
    expect(screen.queryByRole('button', { name: 'Remove Acme' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Acme' }));
    expect(open).toHaveBeenCalledWith('acme-id');
    expect(write).not.toHaveBeenCalled();
  });

  it('Tab leaves the picker for the next cell without applying a highlighted suggestion', async () => {
    const navigate = vi.fn(() => true);
    const { write } = setup({ navigate });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Customer: Acme. Choose related records',
      })
    );
    const input = await screen.findByRole('combobox');
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(navigate).toHaveBeenCalledWith(-1);
    expect(write).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });

  it('keeps unavailable references when another row is selected', async () => {
    const { write } = setup({ value: '["missing-id"]' });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Customer: Unavailable record. Choose related records',
      })
    );
    const option = await screen.findByRole('option', { name: 'Acme' });
    fireEvent.click(option);
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith('["missing-id","acme-id"]')
    );
  });

  it('keeps the selected names visible when saving fails', async () => {
    setup({ fail: true });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Customer: Acme. Choose related records',
      })
    );
    fireEvent.click(await screen.findByRole('option', { name: 'Northwind' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'This link could not be saved'
    );
    expect(
      screen.getByRole('button', { name: 'Remove Northwind' })
    ).toBeTruthy();
  });
});
