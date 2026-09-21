import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DatabaseRowsSnapshot,
  type DatabaseRowsSource,
  DatabaseWriteOutcomeUnknown,
} from '../context/table-source';
import type { DatabaseRowMutation } from '../core/table';
import { createDraftRows } from './draft-rows';
import { createTableController } from './table-controller';

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
function fixture() {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [snapshot, setSnapshot] = createSignal<DatabaseRowsSnapshot>({
      version: 1,
      rows: [],
    });
    let database: DatabaseRowsSnapshot = { version: 1, rows: [] };
    let sequence = 0;
    const persisted: DatabaseRowMutation[] = [];
    const persist = async (
      mutation: DatabaseRowMutation,
      version: number | undefined
    ) => {
      expect(version).toBe(database.version);
      persisted.push(structuredClone(mutation));
      const insertedRowIds =
        mutation.kind === 'create' ? [`server-${++sequence}`] : [];
      database = {
        version: (database.version ?? 0) + 1,
        rows:
          mutation.kind === 'create'
            ? [
                ...database.rows,
                { rowId: insertedRowIds[0], cells: { ...mutation.values } },
              ]
            : database.rows.flatMap((row) =>
                row.rowId !== mutation.rowId
                  ? [row]
                  : mutation.kind === 'delete'
                    ? []
                    : [
                        {
                          ...row,
                          cells: {
                            ...row.cells,
                            [mutation.columnId]: mutation.value,
                          },
                        },
                      ]
              ),
      };
      return { version: database.version, insertedRowIds };
    };
    const source: DatabaseRowsSource = {
      columns: () => [],
      snapshot,
      loading: () => false,
      refreshing: () => false,
      error: () => undefined,
      write: vi.fn(persist),
      refresh: vi.fn(async () => {
        setSnapshot(database);
      }),
      addOption: vi.fn(async () => {
        database = { ...database, version: (database.version ?? 0) + 1 };
      }),
    };
    const controller = createTableController(source);
    const drafts = createDraftRows(controller);
    return {
      source,
      controller,
      drafts,
      persist,
      persisted,
      database: () => database,
      dispose,
    };
  });
}

describe('editable blank row', () => {
  it('preserves an uncertain draft without inserting it twice after refresh, retry, dismissal, or more typing', async () => {
    const { source, controller, drafts, persist, database } = fixture();
    vi.mocked(source.write).mockImplementationOnce(
      async (mutation, version) => {
        await persist(mutation, version);
        throw new DatabaseWriteOutcomeUnknown('The response was lost.');
      }
    );
    const id = drafts.blankId();
    expect(await drafts.write(id, 'name', 'Saved once')).toBe(false);
    expect(controller.failure()?.outcomeUnknown).toBe(true);
    expect(controller.rows()).toEqual(database().rows);
    expect(drafts.project(controller.rows())).toContainEqual({
      rowId: id,
      cells: { name: 'Saved once' },
    });
    await controller.retry();
    expect(await drafts.retry(id)).toBe(false);
    controller.dismissFailure();
    expect(await drafts.write(id, 'notes', 'Keep this unsaved note')).toBe(
      false
    );
    await controller.save(
      { kind: 'create', values: { name: 'Saved once' } },
      'new record',
      undefined,
      id
    );
    expect(source.write).toHaveBeenCalledOnce();
    expect(database().rows).toHaveLength(1);
    expect(drafts.project(controller.rows())).toContainEqual({
      rowId: id,
      cells: { name: 'Saved once', notes: 'Keep this unsaved note' },
    });
    drafts.discardUncertain(id);
    expect(drafts.has(id)).toBe(false);
    expect(database().rows).toHaveLength(1);
    expect(drafts.project(controller.rows())).toContainEqual(
      database().rows[0]
    );
  });

  it('finishes accepted fields against the original row after its owner is disposed', async () => {
    const {
      source,
      controller,
      drafts,
      persist,
      persisted,
      database,
      dispose,
    } = fixture();
    let release!: () => void;
    vi.mocked(source.write).mockImplementationOnce(
      async (mutation, version) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return persist(mutation, version);
      }
    );
    const id = drafts.blankId();
    const name = drafts.write(id, 'name', 'First table record');
    const notes = drafts.write(id, 'notes', 'Keep these accepted notes');
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledOnce());
    dispose();

    expect(await drafts.write(id, 'notes', 'Too late')).toBe(false);
    expect(await drafts.retry(id)).toBe(false);
    expect(
      await controller.save({ kind: 'create', values: { name: 'Too late' } })
    ).toBeUndefined();
    await controller.addGroup('status', 'Too late');
    expect(source.addOption).not.toHaveBeenCalled();

    release();
    expect(await Promise.all([name, notes])).toEqual([true, true]);
    expect(persisted).toEqual([
      { kind: 'create', values: { name: 'First table record' } },
      {
        kind: 'cell',
        rowId: 'server-1',
        columnId: 'notes',
        value: 'Keep these accepted notes',
      },
    ]);
    expect(database().rows).toEqual([
      {
        rowId: 'server-1',
        cells: {
          name: 'First table record',
          notes: 'Keep these accepted notes',
        },
      },
    ]);
    expect(
      vi.mocked(source.write).mock.calls.map(([, version]) => version)
    ).toEqual([1, 2]);
  });

  it('finishes an accepted new option and its field after the create owner is disposed', async () => {
    const { source, drafts, persist, database, dispose } = fixture();
    let release!: () => void;
    vi.mocked(source.write).mockImplementationOnce(
      async (mutation, version) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return persist(mutation, version);
      }
    );
    const id = drafts.blankId();
    const name = drafts.write(id, 'name', 'Accepted record');
    const status = drafts.write(id, 'status', 'In review', 'In review');
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledOnce());
    dispose();
    release();
    expect(await Promise.all([name, status])).toEqual([true, true]);
    expect(source.addOption).toHaveBeenCalledExactlyOnceWith(
      'status',
      'In review'
    );
    expect(database().rows).toEqual([
      {
        rowId: 'server-1',
        cells: { name: 'Accepted record', status: 'In review' },
      },
    ]);
    expect(
      vi.mocked(source.write).mock.calls.map(([, version]) => version)
    ).toEqual([1, 3]);
    expect(database().version).toBe(4);
  });

  it('drops a failed mention type when its draft is replaced with plain text', async () => {
    const { source, drafts, persisted, database } = fixture();
    vi.mocked(source.write).mockRejectedValueOnce(
      new Error('Could not infer the column type')
    );
    const id = drafts.blankId();
    expect(
      await drafts.write(id, 'owner', 'macro|ada@example.com', undefined, {
        dataType: 'ENTITY',
        entityType: 'USER',
      })
    ).toBe(false);
    expect(drafts.project([])[0].cells.owner).toBe('macro|ada@example.com');

    expect(await drafts.write(id, 'owner', 'A plain text value')).toBe(true);
    expect(persisted).toEqual([
      { kind: 'create', values: { owner: 'A plain text value' } },
    ]);
    expect(database().rows).toEqual([
      { rowId: 'server-1', cells: { owner: 'A plain text value' } },
    ]);
  });

  it('carries a mention type through creation and queued field writes', async () => {
    const { source, drafts, persist, persisted } = fixture();
    let release!: () => void;
    vi.mocked(source.write).mockImplementationOnce(
      async (mutation, version) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return persist(mutation, version);
      }
    );
    const id = drafts.blankId();
    const first = drafts.write(
      id,
      'owner',
      'macro|ada@example.com',
      undefined,
      { dataType: 'ENTITY', entityType: 'USER' }
    );
    const second = drafts.write(id, 'reference', 'document-id', undefined, {
      dataType: 'ENTITY',
      entityType: 'DOCUMENT',
    });
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledOnce());
    release();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(persisted[0]).toMatchObject({
      kind: 'create',
      columnTypes: { owner: { dataType: 'ENTITY', entityType: 'USER' } },
    });
    expect(persisted[1]).toMatchObject({
      kind: 'cell',
      columnId: 'reference',
      columnTypes: {
        reference: { dataType: 'ENTITY', entityType: 'DOCUMENT' },
      },
    });
  });

  it('keeps one empty row local without creating records for empty commits', async () => {
    const { source, controller, drafts } = fixture();
    const id = drafts.blankId();
    await drafts.write(id, 'name', null);
    await drafts.write(id, 'notes', '');
    expect(drafts.project(controller.rows())).toEqual([
      { rowId: id, cells: {} },
    ]);
    expect(controller.rows()).toEqual([]);
    expect(source.write).not.toHaveBeenCalled();
  });

  it('creates once while rapid multi-field edits wait, preserving the UI row ID and every latest value', async () => {
    const { source, controller, drafts, persist, database, persisted } =
      fixture();
    let release!: () => void;
    vi.mocked(source.write).mockImplementationOnce(
      async (mutation, version) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return persist(mutation, version);
      }
    );
    const id = drafts.blankId();
    const first = drafts.write(id, 'name', 'First name');
    const second = drafts.write(id, 'notes', 'Typed while saving');
    const third = drafts.write(id, 'name', 'Final name');
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledTimes(1));
    const rows = drafts.project(controller.rows());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rowId: id,
      cells: { name: 'Final name', notes: 'Typed while saving' },
    });
    expect(rows[1].cells).toEqual({});
    release();
    expect(await Promise.all([first, second, third])).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      persisted.filter((mutation) => mutation.kind === 'create')
    ).toHaveLength(1);
    expect(database().rows).toEqual([
      {
        rowId: 'server-1',
        cells: { name: 'Final name', notes: 'Typed while saving' },
      },
    ]);
    expect(drafts.project(controller.rows())[0].rowId).toBe(id);
    expect(drafts.project(controller.rows())).toHaveLength(2);
  });

  it('retries a failed creation with all fields typed since its first request', async () => {
    const { source, controller, drafts, database } = fixture();
    let reject!: () => void;
    vi.mocked(source.write).mockImplementationOnce(async () => {
      await new Promise<void>((_resolve, fail) => {
        reject = () => fail(new Error('Offline'));
      });
      throw new Error('unreachable');
    });
    const id = drafts.blankId();
    const first = drafts.write(id, 'name', 'Old name');
    const next = drafts.write(id, 'notes', 'Keep these notes');
    const revised = drafts.write(id, 'name', 'Revised name');
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledOnce());
    reject();
    expect(await Promise.all([first, next, revised])).toEqual([
      false,
      false,
      false,
    ]);
    expect(database().rows).toEqual([]);
    expect(drafts.retryTarget(controller.failure()!)).toBe(id);
    expect(await drafts.retry(id)).toBe(true);
    expect(source.write).toHaveBeenCalledTimes(2);
    expect(database().rows).toEqual([
      {
        rowId: 'server-1',
        cells: { name: 'Revised name', notes: 'Keep these notes' },
      },
    ]);
    expect(controller.failure()).toBeUndefined();
    expect(drafts.error()).toBeUndefined();
  });

  it('does not insert twice after an acknowledged create whose refresh fails', async () => {
    const { source, controller, drafts, database, persisted } = fixture();
    vi.mocked(source.refresh).mockRejectedValueOnce(new Error('Read offline'));
    const id = drafts.blankId();
    expect(await drafts.write(id, 'name', 'Saved record')).toBe(true);
    expect(controller.refreshWarning()).toBe(true);
    expect(drafts.project(controller.rows())[0]).toEqual({
      rowId: id,
      cells: { name: 'Saved record' },
    });
    expect(await drafts.write(id, 'notes', 'Still editable')).toBe(true);
    expect(await drafts.retry(id)).toBe(true);
    expect(
      persisted.filter((mutation) => mutation.kind === 'create')
    ).toHaveLength(1);
    expect(database().rows[0].cells).toEqual({
      name: 'Saved record',
      notes: 'Still editable',
    });
    expect(drafts.project(controller.rows())[0].rowId).toBe(id);
  });

  it('keeps a focused promoted row through filtering, then reconciles when focus leaves', async () => {
    const { controller, drafts } = fixture();
    const id = drafts.blankId();
    drafts.setActive(id);
    await drafts.write(id, 'name', 'Outside the filter');
    expect(drafts.project([])[0]).toEqual({
      rowId: id,
      cells: { name: 'Outside the filter' },
    });
    drafts.setActive(undefined);
    expect(drafts.project([])).toEqual([
      { rowId: drafts.blankId(), cells: {} },
    ]);
    expect(controller.rows()).toHaveLength(1);
  });

  it('retains a new option and row when adding the option fails, and retries without an empty insert', async () => {
    const { source, drafts, database } = fixture();
    vi.mocked(source.addOption).mockRejectedValueOnce(
      new Error('Option offline')
    );
    const id = drafts.blankId();
    expect(await drafts.write(id, 'status', 'In review', 'In review')).toBe(
      false
    );
    expect(drafts.error()?.error).toBe('Option offline');
    expect(source.write).not.toHaveBeenCalled();
    expect(await drafts.retry(id)).toBe(true);
    expect(source.addOption).toHaveBeenCalledTimes(2);
    expect(database().rows).toEqual([
      { rowId: 'server-1', cells: { status: 'In review' } },
    ]);
  });

  it('retries the same failed cell with its latest text and does not resurrect deleted rows', async () => {
    const { source, controller, drafts, database } = fixture();
    const id = drafts.blankId();
    await drafts.write(id, 'name', 'New record');
    vi.mocked(source.write).mockRejectedValueOnce(new Error('Offline'));
    expect(await drafts.write(id, 'notes', 'Old draft')).toBe(false);
    expect(await drafts.write(id, 'notes', 'Updated draft')).toBe(true);
    expect(controller.failure()).toBeUndefined();
    expect(database().rows[0].cells.notes).toBe('Updated draft');
    await controller.save({ kind: 'delete', rowId: drafts.serverId(id)! });
    expect(database().rows).toEqual([]);
    expect(drafts.project(controller.rows())).toEqual([
      { rowId: drafts.blankId(), cells: {} },
    ]);
  });
});
