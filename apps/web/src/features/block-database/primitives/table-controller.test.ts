import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  type DatabaseRowsSnapshot,
  type DatabaseRowsSource,
  DatabaseWriteConflict,
  type DatabaseWriteResult,
} from '../context/table-source';
import type { DatabaseRowMutation } from '../core/table';
import { createTableController } from './table-controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(onSaved?: Parameters<typeof createTableController>[1]) {
  const [snapshot, setSnapshot] = createSignal<DatabaseRowsSnapshot>({
    rows: [
      { rowId: 'record', cells: { status: 'To do', title: 'Plan launch' } },
    ],
    version: 1,
  });
  const source: DatabaseRowsSource = {
    columns: () => [],
    snapshot,
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    refresh: vi.fn(async () => {}),
    write: vi.fn(async (_mutation, version) => ({
      insertedRowIds: [],
      version: (version ?? 0) + 1,
    })),
    addOption: vi.fn(async () => {}),
  };
  let dispose!: () => void;
  const controller = createRoot((cleanup) => {
    dispose = cleanup;
    return createTableController(source, onSaved);
  });
  return { controller, source, snapshot, setSnapshot, dispose };
}

const move: DatabaseRowMutation = {
  kind: 'cell',
  rowId: 'record',
  columnId: 'status',
  value: 'Done',
};

describe('table controller', () => {
  it('serializes adding a group with row writes and uses the schema refresh version', async () => {
    const { controller, source, setSnapshot, snapshot, dispose } = setup();
    const option = deferred<void>();
    vi.mocked(source.addOption).mockImplementation(() => option.promise);
    vi.mocked(source.refresh).mockImplementation(async () => {
      setSnapshot({ ...snapshot(), version: 4 });
    });
    const group = controller.addGroup('status', 'Done');
    const write = controller.save(move);
    await vi.waitFor(() =>
      expect(source.addOption).toHaveBeenCalledWith('status', 'Done')
    );
    expect(source.write).not.toHaveBeenCalled();
    option.resolve();
    await Promise.all([group, write]);
    expect(source.write).toHaveBeenCalledWith(move, 4);
    expect(controller.pending()).toBe(false);
    dispose();
  });
  it('serializes rapid edits and uses each acknowledged version even before the cache catches up', async () => {
    const { controller, source, dispose } = setup();
    const first = deferred<DatabaseWriteResult>();
    vi.mocked(source.write).mockImplementationOnce(() => first.promise);
    const a = controller.save(move, 'Status');
    const b = controller.save(
      {
        kind: 'cell',
        rowId: 'record',
        columnId: 'title',
        value: 'Ship launch',
      },
      'Title'
    );
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledTimes(1));
    expect(controller.rows()[0].cells).toEqual({
      status: 'Done',
      title: 'Ship launch',
    });
    first.resolve({ insertedRowIds: [], version: 2 });
    await Promise.all([a, b]);
    expect(vi.mocked(source.write).mock.calls.map((call) => call[1])).toEqual([
      1, 2,
    ]);
    expect(controller.pending()).toBe(false);
    dispose();
  });

  it('loads the latest rows after a conflict and retains the lost edit after a queued success', async () => {
    const { controller, source, setSnapshot, snapshot, dispose } = setup();
    vi.mocked(source.write).mockRejectedValueOnce(
      new DatabaseWriteConflict('Conflict')
    );
    vi.mocked(source.refresh).mockImplementation(async () => {
      setSnapshot({ ...snapshot(), version: 7 });
    });
    await Promise.all([
      controller.save(move, 'Status'),
      controller.save(
        {
          kind: 'cell',
          rowId: 'record',
          columnId: 'title',
          value: 'A newer title',
        },
        'Title'
      ),
    ]);
    expect(vi.mocked(source.write).mock.calls.map((call) => call[1])).toEqual([
      1, 7,
    ]);
    expect(controller.failure()?.label).toBe('Status');
    expect(controller.failure()?.conflict).toBe(true);
    expect(controller.rows()[0].cells.status).toBe('To do');
    await controller.retry();
    expect(vi.mocked(source.write).mock.calls[2]).toEqual([move, 8]);
    expect(controller.failure()).toBeUndefined();
    dispose();
  });

  it('retains each failed edit for an explicit retry or dismissal', async () => {
    const { controller, source, dispose } = setup();
    vi.mocked(source.write).mockRejectedValue(new Error('Offline'));
    await Promise.all([
      controller.save(move, 'Status'),
      controller.save({ kind: 'delete', rowId: 'record' }, 'Delete'),
    ]);
    expect(controller.failure()?.label).toBe('Status');
    controller.dismissFailure();
    expect(controller.failure()?.label).toBe('Delete');
    expect(controller.rows()).toHaveLength(1);
    dispose();
  });

  it('does not report a committed insert as failed or offer a duplicate insert retry if refresh fails', async () => {
    const { controller, source, setSnapshot, snapshot, dispose } = setup();
    vi.mocked(source.write).mockResolvedValue({
      insertedRowIds: ['new-row'],
      version: 2,
    });
    vi.mocked(source.refresh).mockRejectedValue(new Error('Offline'));
    const result = await controller.save({
      kind: 'create',
      values: { status: 'Done' },
    });
    expect(result?.insertedRowIds).toEqual(['new-row']);
    expect(controller.rows()).toContainEqual({
      rowId: 'new-row',
      cells: { status: 'Done' },
    });
    expect(controller.failure()).toBeUndefined();
    expect(controller.refreshWarning()).toBe(true);
    await controller.retry();
    expect(source.write).toHaveBeenCalledTimes(1);
    setSnapshot({
      version: 2,
      rows: [
        ...snapshot().rows,
        {
          rowId: 'new-row',
          cells: { status: 'Done', title: 'Server title' },
        },
      ],
    });
    expect(controller.rows().filter((row) => row.rowId === 'new-row')).toEqual([
      { rowId: 'new-row', cells: { status: 'Done', title: 'Server title' } },
    ]);
    dispose();
  });

  it('announces only committed writes, including a successful explicit retry', async () => {
    const saved = vi.fn();
    const { controller, source, dispose } = setup(saved);
    vi.mocked(source.write).mockRejectedValueOnce(new Error('Offline'));
    await controller.save(move);
    expect(saved).not.toHaveBeenCalled();
    await controller.retry();
    expect(saved).toHaveBeenCalledExactlyOnceWith(move, {
      insertedRowIds: [],
      version: 2,
    });
    expect(controller.pending()).toBe(false);
    dispose();
  });

  it('replaces a failed board draft on resubmit and retires its old Retry action', async () => {
    const { controller, source, dispose } = setup();
    vi.mocked(source.write)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ insertedRowIds: ['created'], version: 2 });
    await controller.save(
      { kind: 'create', values: { title: 'First draft' } },
      'new record',
      undefined,
      'draft'
    );
    expect(controller.failure()).toBeDefined();
    await controller.save(
      { kind: 'create', values: { title: 'Final draft' } },
      'new record',
      undefined,
      'draft'
    );
    expect(controller.failure()).toBeUndefined();
    await controller.retry();
    expect(source.write).toHaveBeenCalledTimes(2);
    expect(controller.rows().filter((row) => row.rowId === 'created')).toEqual([
      { rowId: 'created', cells: { title: 'Final draft' } },
    ]);
    dispose();
  });

  it('acknowledges an already retried draft without inserting again when its composer is submitted', async () => {
    const saved = vi.fn();
    const { controller, source, dispose } = setup(saved);
    vi.mocked(source.write)
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ insertedRowIds: ['created'], version: 2 });
    await controller.save(
      { kind: 'create', values: { title: 'Draft' } },
      'new record',
      undefined,
      'draft'
    );
    await controller.retry();
    await expect(
      controller.save(
        { kind: 'create', values: { title: 'Draft' } },
        'new record',
        undefined,
        'draft'
      )
    ).resolves.toEqual({ insertedRowIds: ['created'], version: 2 });
    expect(source.write).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('serializes simultaneous retries of one draft into one insert and one completion notice', async () => {
    const saved = vi.fn();
    const { controller, source, dispose } = setup(saved);
    const first = deferred<DatabaseWriteResult>();
    vi.mocked(source.write).mockImplementationOnce(() => first.promise);
    const a = controller.save(
      { kind: 'create', values: { title: 'Draft' } },
      'new record',
      undefined,
      'draft'
    );
    const b = controller.save(
      { kind: 'create', values: { title: 'Draft' } },
      'new record',
      undefined,
      'draft'
    );
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledTimes(1));
    first.resolve({ insertedRowIds: ['created'], version: 2 });
    expect(await Promise.all([a, b])).toEqual([
      { insertedRowIds: ['created'], version: 2 },
      { insertedRowIds: ['created'], version: 2 },
    ]);
    expect(source.write).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('retains an acknowledged insert while a successful read is waiting to publish its newer snapshot', async () => {
    const { controller, source, setSnapshot, snapshot, dispose } = setup();
    vi.mocked(source.write).mockResolvedValue({
      insertedRowIds: ['created'],
      version: 2,
    });
    await controller.save({ kind: 'create', values: { title: 'Draft' } });
    expect(controller.refreshWarning()).toBe(false);
    expect(controller.rows()).toContainEqual({
      rowId: 'created',
      cells: { title: 'Draft' },
    });
    setSnapshot({
      version: 2,
      rows: [
        ...snapshot().rows,
        { rowId: 'created', cells: { title: 'Draft', status: 'To do' } },
      ],
    });
    expect(controller.rows().filter((row) => row.rowId === 'created')).toEqual([
      { rowId: 'created', cells: { title: 'Draft', status: 'To do' } },
    ]);
    dispose();
  });

  it('keeps a committed cell visible if refresh fails, until a newer snapshot arrives', async () => {
    const { controller, source, setSnapshot, dispose } = setup();
    vi.mocked(source.refresh).mockRejectedValue(new Error('Offline'));
    await controller.save(move);
    expect(controller.rows()[0].cells.status).toBe('Done');
    setSnapshot({
      version: 3,
      rows: [{ rowId: 'record', cells: { status: 'In review' } }],
    });
    expect(controller.rows()[0].cells.status).toBe('In review');
    dispose();
  });

  it('registers a new option and refreshes its version before writing the selected label', async () => {
    const { controller, source, setSnapshot, snapshot, dispose } = setup();
    vi.mocked(source.refresh).mockImplementation(async () => {
      setSnapshot({ ...snapshot(), version: 4 });
    });
    await controller.save(move, 'Status', 'Done');
    expect(source.addOption).toHaveBeenCalledWith('status', 'Done');
    expect(source.write).toHaveBeenCalledWith(move, 4);
    dispose();
  });

  it('finishes already queued edits on the owned source after disposal and accepts no new edits', async () => {
    const { controller, source, dispose } = setup();
    const first = deferred<DatabaseWriteResult>();
    vi.mocked(source.write).mockImplementationOnce(() => first.promise);
    const a = controller.save(move);
    const b = controller.save({
      kind: 'cell',
      rowId: 'record',
      columnId: 'title',
      value: 'Queued',
    });
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledTimes(1));
    dispose();
    first.resolve({ insertedRowIds: [], version: 2 });
    await Promise.all([a, b]);
    await controller.save({ kind: 'delete', rowId: 'record' });
    expect(source.write).toHaveBeenCalledTimes(2);
    expect(vi.mocked(source.write).mock.calls[1][1]).toBe(2);
  });
});
