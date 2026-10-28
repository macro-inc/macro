import { err, errAsync, ok, okAsync, ResultAsync } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseRowsSource } from '../context/table-source';
import type { DatabaseApi, DatabaseCapabilities } from '../core/api';
import type { DatabaseViewColumn } from '../core/database-view';
import { createDatabaseController } from './database-controller';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));

function fixture(
  capabilities: DatabaseCapabilities = { editRows: true, editColumns: true }
) {
  const [columns, setColumns] = createSignal<DatabaseViewColumn[]>([]);
  const rows: DatabaseRowsSource = {
    columns,
    snapshot: () => ({ rows: [], retained: [], version: 7 }),
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    refresh: () => okAsync(undefined),
    retain: () => {},
    addOption: () => okAsync(undefined),
    write: vi.fn(() => okAsync({ insertedRowIds: [], version: 7 })),
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
  const controller = createRoot((dispose) => {
    disposers.push(dispose);
    return createDatabaseController({
      api,
      tableId: 'table',
      capabilities: () => capabilities,
      data: {
        rows: { ...rows, refresh },
        table: () => ({
          id: 'table',
          databaseId: 'db',
          name: 'Table',
          columns: columns(),
          version: 7,
        }),
      },
    });
  });
  return { controller, applyOps, refresh, capabilities, rows, setColumns };
}

describe('shared database controller', () => {
  it('keeps a committed column creation successful when refreshing fails', async () => {
    const { controller, applyOps, refresh } = fixture();
    const result = await controller.schemaEditing()!.createDefaultColumn();
    expect(result.isOk()).toBe(true);
    expect(applyOps).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(controller.data.rows.columns().map((column) => column.id)).toEqual([
      result._unsafeUnwrap(),
    ]);
  });
  it('shows and focuses a column immediately, and saves its rename after creation', async () => {
    const { controller, applyOps } = fixture();
    let finish!: (result: Awaited<ReturnType<DatabaseApi['applyOps']>>) => void;
    applyOps.mockReturnValueOnce(
      new ResultAsync(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
    );
    const onCreated = vi.fn();
    const created = controller.schemaEditing()!.createDefaultColumn(onCreated);
    const column = controller.data.rows.columns()[0];
    expect(column.name).toBe('Unnamed');
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(column.id);
    const rename = controller
      .schemaEditing()!
      .rename(column.id, 'Tasks', 'Unnamed');
    await vi.waitFor(() => expect(applyOps).toHaveBeenCalledTimes(1));
    finish(ok({ results: [] }));
    expect((await created).isOk()).toBe(true);
    expect((await rename).isOk()).toBe(true);
    expect(applyOps.mock.calls[1][0].ops[0]).toMatchObject({
      column: column.id,
      change: { kind: 'rename', name: 'Tasks' },
    });
  });
  it('rolls back a refused column and rejects dependent cell writes', async () => {
    const { controller, applyOps, rows } = fixture();
    let finish!: (result: Awaited<ReturnType<DatabaseApi['applyOps']>>) => void;
    applyOps.mockReturnValueOnce(
      new ResultAsync(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
    );
    const created = controller.schemaEditing()!.createDefaultColumn();
    const column = controller.data.rows.columns()[0];
    const write = controller.data.rows.write(
      { kind: 'cell', rowId: 'row', columnId: column.id, value: 'Draft' },
      7,
      false
    );
    const failure = {
      code: 'FORBIDDEN' as const,
      refusal: null,
      message: 'Denied',
    };
    await vi.waitFor(() => expect(applyOps).toHaveBeenCalledTimes(1));
    expect(rows.write).not.toHaveBeenCalled();
    finish(err(failure));
    expect((await created).isErr()).toBe(true);
    expect(await write).toEqual(err({ kind: 'ops', error: failure }));
    expect(controller.data.rows.columns()).toEqual([]);
    expect(rows.write).not.toHaveBeenCalled();
  });
  it('does not duplicate an acknowledged column or resurrect it after deletion', async () => {
    const { controller, setColumns } = fixture();
    await controller.schemaEditing()!.createDefaultColumn();
    const column = controller.data.rows.columns()[0];
    setColumns([column]);
    expect(controller.data.rows.columns()).toEqual([column]);
    setColumns([]);
    expect(controller.data.rows.columns()).toEqual([]);
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
