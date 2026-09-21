import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddColumnMenu } from './AddColumnMenu';

const createColumn = vi.hoisted(() => vi.fn());
vi.mock('@queries/storage/databases', () => ({
  createDatabaseColumn: createColumn,
  useDatabaseDetailQuery: () => ({
    isSuccess: true,
    isError: false,
    data: { tables: [{ table: { id: 'customers', name: 'Customers' } }] },
  }),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

let menuStyles: HTMLStyleElement;
beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  createColumn.mockResolvedValue('customer-column');
  menuStyles = document.createElement('style');
  menuStyles.textContent =
    '[role=menu], [role=dialog] { animation-name: none; }';
  document.head.append(menuStyles);
});
afterEach(() => {
  cleanup();
  menuStyles.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('AddColumnMenu relation adapter', () => {
  it('creates a many-record relation to the chosen table in the current database', async () => {
    render(() => (
      <AddColumnMenu databaseId="support" tableId="tickets" columns={[]} />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    const name = await screen.findByLabelText('Column name');
    fireEvent.input(name, { target: { value: 'Customer' } });
    const type = screen.getByRole('button', { name: 'Column type: Text' });
    type.focus();
    fireEvent.keyDown(type, { key: 'ArrowDown' });
    const relation = await screen.findByRole('menuitemradio', {
      name: 'Relation',
    });
    relation.focus();
    fireEvent.keyDown(relation, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    const table = screen.getByRole('button', {
      name: 'Related table: Choose a table',
    });
    table.focus();
    fireEvent.keyDown(table, { key: 'ArrowDown' });
    const customers = await screen.findByRole('menuitemradio', {
      name: 'Customers',
    });
    customers.focus();
    fireEvent.keyDown(customers, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    );
    fireEvent.submit(name.closest('form')!);
    await waitFor(() =>
      expect(createColumn).toHaveBeenCalledExactlyOnceWith({
        databaseId: 'support',
        tableId: 'tickets',
        request: {
          infer_type: false,
          binding: {
            kind: 'new',
            name: 'Customer',
            data_type: 'ENTITY',
            is_multi_select: true,
          },
          linkToTableId: 'customers',
          linkToDatabaseId: 'support',
        },
      })
    );
  });
});
