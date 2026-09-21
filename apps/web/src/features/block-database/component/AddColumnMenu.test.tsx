import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddColumnMenu } from './AddColumnMenu';

const createColumn = vi.hoisted(() => vi.fn());
vi.mock('@queries/storage/databases', () => ({
  createDatabaseColumn: createColumn,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('immediate column creation', () => {
  it('creates an inferred Text column without a popup and focuses its header', async () => {
    createColumn.mockResolvedValue('column');
    const created = vi.fn(() => true);
    render(() => (
      <AddColumnMenu
        databaseId="db"
        tableId="table"
        columns={[]}
        onCreated={created}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    await waitFor(() =>
      expect(created).toHaveBeenCalledExactlyOnceWith('column')
    );
    expect(createColumn).toHaveBeenCalledExactlyOnceWith({
      databaseId: 'db',
      tableId: 'table',
      request: {
        infer_type: true,
        binding: {
          kind: 'new',
          name: 'Unnamed',
          data_type: 'STRING',
          is_multi_select: false,
        },
      },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('prevents repeated clicks during creation and preserves errors', async () => {
    let reject!: (error: Error) => void;
    createColumn.mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    render(() => (
      <AddColumnMenu databaseId="db" tableId="table" columns={[]} />
    ));
    const add = screen.getByRole('button', { name: 'Add column' });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(createColumn).toHaveBeenCalledTimes(1);
    reject(new Error('Connection lost'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Connection lost'
    );
  });
});
