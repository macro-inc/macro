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
    navigate?: (direction: 1 | -1) => boolean;
  } = {}
) {
  const [value, setValue] = createSignal<DatabaseCellValue>(
    options.value ?? '["acme-id"]'
  );
  const write = vi.fn(async (next: DatabaseCellValue) => {
    if (options.fail) return false;
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
