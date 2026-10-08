import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseRowsSource } from '../context/table-source';
import type { DatabaseApi, DatabaseCapabilities } from '../core/api';
import { createDatabaseController } from './database-controller';

function fixture(
  capabilities: DatabaseCapabilities = { editRows: true, editColumns: true }
) {
  const rows: DatabaseRowsSource = {
    columns: () => [],
    snapshot: () => ({ rows: [], retained: [], version: 7 }),
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    refresh: () => okAsync(undefined),
    retain: () => {},
    addOption: () => okAsync(undefined),
    write: () => okAsync({ insertedRowIds: [], version: 7 }),
  };
  const applyOps = vi.fn<DatabaseApi['applyOps']>(() =>
    okAsync({ results: [] })
  );
  const api: DatabaseApi = {
    key: ['test'],
    readTable: () => errAsync({ kind: 'table-unavailable' }),
    readRows: () => okAsync({ rows: [], tableVersion: 1 }),
    applyOps,
  };
  const refresh = vi.fn(() =>
    errAsync({ kind: 'fetch' as const, message: 'offline' })
  );
  const controller = createDatabaseController({
    api,
    tableId: 'table',
    capabilities: () => capabilities,
    data: {
      rows: { ...rows, refresh },
      table: () => ({
        id: 'table',
        databaseId: 'db',
        name: 'Table',
        columns: [],
        version: 7,
      }),
    },
  });
  return { controller, applyOps, refresh, capabilities };
}

describe('shared database controller', () => {
  it('keeps a committed column creation successful when refreshing fails', async () => {
    const { controller, applyOps, refresh } = fixture();
    const result = await controller.schemaEditing()!.createDefaultColumn();
    expect(result.isOk()).toBe(true);
    expect(applyOps).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('preserves a version refusal without retrying the mutation', async () => {
    const { controller, applyOps, refresh } = fixture();
    applyOps.mockReturnValueOnce(
      errAsync({ code: 'CONFLICT', refusal: null, message: 'Changed' })
    );
    expect((await controller.schemaEditing()!.remove('column')).isErr()).toBe(
      true
    );
    expect(applyOps).toHaveBeenCalledWith({
      ops: [
        {
          kind: 'column',
          table: 'table',
          column: 'column',
          change: { kind: 'delete' },
        },
      ],
      baseVersions: { table: 7 },
    });
    expect(refresh).not.toHaveBeenCalled();
  });
  it('hides unsupported schema actions and rechecks revoked capabilities', async () => {
    const { controller, applyOps, capabilities } = fixture();
    const savedAction = controller.schemaEditing()!.remove;
    capabilities.editColumns = false;
    expect(controller.schemaEditing()).toBeUndefined();
    expect((await savedAction('column')).isErr()).toBe(true);
    expect(applyOps).not.toHaveBeenCalled();
  });
});
