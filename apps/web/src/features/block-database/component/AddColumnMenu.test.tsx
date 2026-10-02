import type { DatabaseOpsError } from '@service-storage/databases';
import type { OpResult } from '@service-storage/generated/schemas/opResult';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { err, okAsync, type Result, ResultAsync } from 'neverthrow';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import { AddColumnMenu } from './AddColumnMenu';

const storage = vi.hoisted(() => ({
  applyDatabaseOps: vi.fn(),
  invalidateDatabase: vi.fn(),
}));
vi.mock('@queries/storage/databases', () => storage);
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('immediate column creation', () => {
  it('creates an inferred Text column under a minted id without a popup and focuses its header', async () => {
    storage.applyDatabaseOps.mockReturnValue(
      okAsync([
        {
          kind: 'column',
          table: 'table',
          column: 'column',
          tableVersion: 2,
          change: { kind: 'created' },
        },
      ])
    );
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
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(storage.applyDatabaseOps).toHaveBeenCalledExactlyOnceWith('db', [
      {
        kind: 'column',
        table: 'table',
        column: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        ),
        change: {
          kind: 'create',
          definition: {
            source: 'new',
            name: 'Unnamed',
            type: { type: 'text' },
            inferType: true,
          },
        },
      },
    ]);
    const [[, [op]]] = storage.applyDatabaseOps.mock.calls;
    assert(op.kind === 'column');
    expect(created).toHaveBeenCalledExactlyOnceWith(op.column);
    expect(storage.invalidateDatabase).toHaveBeenCalledExactlyOnceWith('db');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('prevents repeated clicks during creation and preserves errors', async () => {
    let settle!: (result: Result<OpResult[], DatabaseOpsError>) => void;
    storage.applyDatabaseOps.mockImplementation(
      () =>
        new ResultAsync(
          new Promise<Result<OpResult[], DatabaseOpsError>>((resolve) => {
            settle = resolve;
          })
        )
    );
    render(() => (
      <AddColumnMenu databaseId="db" tableId="table" columns={[]} />
    ));
    const add = screen.getByRole('button', { name: 'Add column' });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(storage.applyDatabaseOps).toHaveBeenCalledTimes(1);
    settle(
      err({ code: 'NETWORK_ERROR', message: 'Connection lost', refusal: null })
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your change could not be sent. Check your connection.'
    );
  });
});
