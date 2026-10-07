import type { DatabaseOpsError } from '@service-storage/databases';
import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from 'neverthrow';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  DatabaseRowsSnapshot,
  DatabaseRowsSource,
  DatabaseWriteResult,
} from '../context/table-source';
import type { DatabaseRowMutation } from '../core/table';
import type { DatabaseWriteFailure } from '../core/write-failure';

import { createTableController } from './table-controller';

/** What the fake table holds; it retains no rows beyond the view's. */
type StoredTable = Omit<DatabaseRowsSnapshot, 'retained'>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type WriteOutcome = Result<DatabaseWriteResult, DatabaseWriteFailure>;

const offline: DatabaseWriteFailure = {
  kind: 'ops',
  error: { code: 'NETWORK_ERROR', message: 'Offline', refusal: null },
};

function setup(onSaved?: Parameters<typeof createTableController>[1]) {
  const [snapshot, setSnapshot] = createSignal<StoredTable>({
    rows: [
      { rowId: 'record', cells: { status: 'To do', title: 'Plan launch' } },
    ],
    version: 1,
  });
  const source: DatabaseRowsSource = {
    columns: () => [],
    snapshot: () => ({ ...snapshot(), retained: [] }),
    read: () => undefined,
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    refresh: vi.fn<DatabaseRowsSource['refresh']>(() => okAsync(undefined)),
    write: vi.fn<DatabaseRowsSource['write']>((_mutation, version) =>
      okAsync({ insertedRowIds: [], version: (version ?? 0) + 1 })
    ),
    addOption: vi.fn<DatabaseRowsSource['addOption']>(() => okAsync(undefined)),
    retain: () => {},
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
    const option = deferred<Result<void, DatabaseOpsError>>();
    vi.mocked(source.addOption).mockImplementation(
      () => new ResultAsync(option.promise)
    );
    vi.mocked(source.refresh).mockImplementation(() => {
      setSnapshot({ ...snapshot(), version: 4 });
      return okAsync(undefined);
    });
    const group = controller.addGroup('status', 'Done');
    const write = controller.save(move);
    await vi.waitFor(() =>
      expect(source.addOption).toHaveBeenCalledWith('status', 'Done')
    );
    expect(source.write).not.toHaveBeenCalled();
    option.resolve(ok(undefined));
    await Promise.all([group, write]);
    expect(source.write).toHaveBeenCalledWith(move, 4, false);
    expect(controller.pending()).toBe(false);
    dispose();
  });
  it('serializes rapid edits and uses each acknowledged version even before the cache catches up', async () => {
    const { controller, source, dispose } = setup();
    const first = deferred<WriteOutcome>();
    vi.mocked(source.write).mockImplementationOnce(
      () => new ResultAsync(first.promise)
    );
    const a = controller.save(move, { label: 'Status' });
    const b = controller.save(
      {
        kind: 'cell',
        rowId: 'record',
        columnId: 'title',
        value: 'Ship launch',
      },
      { label: 'Title' }
    );
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledTimes(1));
    expect(controller.rows()[0].cells).toEqual({
      status: 'Done',
      title: 'Ship launch',
    });
    first.resolve(ok({ insertedRowIds: [], version: 2 }));
    await Promise.all([a, b]);
    expect(vi.mocked(source.write).mock.calls.map((call) => call[1])).toEqual([
      1, 2,
    ]);
    expect(controller.pending()).toBe(false);
    dispose();
  });

  it('retains each failed edit for an explicit retry or dismissal', async () => {
    const { controller, source, dispose } = setup();
    vi.mocked(source.write).mockImplementation(() => errAsync(offline));
    await Promise.all([
      controller.save(move, { label: 'Status' }),
      controller.save({ kind: 'delete', rowId: 'record' }, { label: 'Delete' }),
    ]);
    expect(controller.failure()).toMatchObject({
      label: 'Status',
      failure: offline,
    });
    controller.dismissFailure();
    expect(controller.failure()?.label).toBe('Delete');
    expect(controller.rows()).toHaveLength(1);
    dispose();
  });

  it('does not report a committed insert as failed or offer a duplicate insert retry if refresh fails', async () => {
    const { controller, source, setSnapshot, snapshot, dispose } = setup();
    vi.mocked(source.write).mockImplementation(() =>
      okAsync({ insertedRowIds: ['new-row'], version: 2 })
    );
    vi.mocked(source.refresh).mockImplementation(() =>
      errAsync({ kind: 'fetch', message: 'Offline' })
    );
    const result = await controller.save({
      kind: 'create',
      values: { status: 'Done' },
    });
    expect(result).toEqual(ok({ insertedRowIds: ['new-row'], version: 2 }));
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
    vi.mocked(source.write).mockImplementationOnce(() => errAsync(offline));
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
      .mockImplementationOnce(() => errAsync(offline))
      .mockImplementation(() =>
        okAsync({ insertedRowIds: ['created'], version: 2 })
      );
    await controller.save(
      { kind: 'create', values: { title: 'First draft' } },
      { label: 'new record', createIntentId: 'draft' }
    );
    expect(controller.failure()).toBeDefined();
    await controller.save(
      { kind: 'create', values: { title: 'Final draft' } },
      { label: 'new record', createIntentId: 'draft' }
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
      .mockImplementationOnce(() => errAsync(offline))
      .mockImplementation(() =>
        okAsync({ insertedRowIds: ['created'], version: 2 })
      );
    await controller.save(
      { kind: 'create', values: { title: 'Draft' } },
      { label: 'new record', createIntentId: 'draft' }
    );
    await controller.retry();
    await expect(
      controller.save(
        { kind: 'create', values: { title: 'Draft' } },
        { label: 'new record', createIntentId: 'draft' }
      )
    ).resolves.toEqual(ok({ insertedRowIds: ['created'], version: 2 }));
    expect(source.write).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('serializes simultaneous retries of one draft into one insert and one completion notice', async () => {
    const saved = vi.fn();
    const { controller, source, dispose } = setup(saved);
    const first = deferred<WriteOutcome>();
    vi.mocked(source.write).mockImplementationOnce(
      () => new ResultAsync(first.promise)
    );
    const a = controller.save(
      { kind: 'create', values: { title: 'Draft' } },
      { label: 'new record', createIntentId: 'draft' }
    );
    const b = controller.save(
      { kind: 'create', values: { title: 'Draft' } },
      { label: 'new record', createIntentId: 'draft' }
    );
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledTimes(1));
    first.resolve(ok({ insertedRowIds: ['created'], version: 2 }));
    expect(await Promise.all([a, b])).toEqual([
      ok({ insertedRowIds: ['created'], version: 2 }),
      ok({ insertedRowIds: ['created'], version: 2 }),
    ]);
    expect(source.write).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('retains an acknowledged insert while a successful read is waiting to publish its newer snapshot', async () => {
    const { controller, source, setSnapshot, snapshot, dispose } = setup();
    vi.mocked(source.write).mockImplementation(() =>
      okAsync({ insertedRowIds: ['created'], version: 2 })
    );
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
    vi.mocked(source.refresh).mockImplementation(() =>
      errAsync({ kind: 'fetch', message: 'Offline' })
    );
    await controller.save(move);
    expect(controller.rows()[0].cells.status).toBe('Done');
    setSnapshot({
      version: 3,
      rows: [{ rowId: 'record', cells: { status: 'In review' } }],
    });
    expect(controller.rows()[0].cells.status).toBe('In review');
    dispose();
  });

  it('redraws only the rows a new read or a pending edit changed', async () => {
    const { controller, source, setSnapshot, dispose } = setup();
    setSnapshot({
      version: 2,
      rows: [
        { rowId: 'record', cells: { status: 'To do', title: 'Plan launch' } },
        { rowId: 'other', cells: { status: 'Done', title: 'Hire' } },
      ],
    });
    const [record, other] = controller.rows();

    setSnapshot({
      version: 3,
      rows: [
        { rowId: 'record', cells: { status: 'To do', title: 'Plan launch' } },
        { rowId: 'other', cells: { status: 'Done', title: 'Hire a designer' } },
      ],
    });
    expect(controller.rows()[0]).toBe(record);
    expect(controller.rows()[1]).not.toBe(other);
    expect(controller.rows()[1]).toEqual({
      rowId: 'other',
      cells: { status: 'Done', title: 'Hire a designer' },
    });

    const reread = controller.rows()[1];
    const written = deferred<WriteOutcome>();
    vi.mocked(source.write).mockImplementation(
      () => new ResultAsync(written.promise)
    );
    const saving = controller.save(move);
    await vi.waitFor(() =>
      expect(controller.rows()[0].cells.status).toBe('Done')
    );
    expect(controller.rows()[1]).toBe(reread);
    written.resolve(ok({ insertedRowIds: [], version: 4 }));
    await saving;
    dispose();
  });

  it('reads the source once for each change, however many views of it are shown', () => {
    const { controller, source, setSnapshot, dispose } = setup();
    const read = vi.spyOn(source, 'snapshot');
    controller.rows();
    controller.knownRows();
    read.mockClear();

    setSnapshot({
      version: 2,
      rows: [
        { rowId: 'record', cells: { status: 'Done', title: 'Plan launch' } },
      ],
    });
    expect(controller.rows()).toEqual([
      { rowId: 'record', cells: { status: 'Done', title: 'Plan launch' } },
    ]);
    expect(controller.knownRows()).toEqual(controller.rows());
    expect(controller.snapshot()?.version).toBe(2);
    expect(read).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('creates a new option with the write that first selects it', async () => {
    const { controller, source, dispose } = setup();
    await controller.save(move, { label: 'Status', option: 'Done' });
    expect(source.addOption).not.toHaveBeenCalled();
    expect(source.write).toHaveBeenCalledExactlyOnceWith(move, 1, true);
    dispose();
  });

  it('finishes already queued edits on the owned source after disposal and accepts no new edits', async () => {
    const { controller, source, dispose } = setup();
    const first = deferred<WriteOutcome>();
    vi.mocked(source.write).mockImplementationOnce(
      () => new ResultAsync(first.promise)
    );
    const a = controller.save(move);
    const b = controller.save({
      kind: 'cell',
      rowId: 'record',
      columnId: 'title',
      value: 'Queued',
    });
    await vi.waitFor(() => expect(source.write).toHaveBeenCalledTimes(1));
    dispose();
    first.resolve(ok({ insertedRowIds: [], version: 2 }));
    await Promise.all([a, b]);
    expect(await controller.save({ kind: 'delete', rowId: 'record' })).toEqual(
      err({ kind: 'unmounted' })
    );
    expect(source.write).toHaveBeenCalledTimes(2);
    expect(vi.mocked(source.write).mock.calls[1][1]).toBe(2);
  });

  it('tells a reader when a new row’s outcome becomes unknown', async () => {
    const { controller, source, dispose } = setup();
    vi.mocked(source.write).mockImplementation(() =>
      errAsync({ kind: 'outcome-unknown' })
    );
    const seen: boolean[] = [];
    createRoot(() =>
      createEffect(() => seen.push(controller.createUncertain('draft')))
    );

    await controller.save(
      { kind: 'create', values: { title: 'Draft' } },
      { label: 'new record', createIntentId: 'draft' }
    );

    expect(seen).toEqual([false, true]);
    dispose();
  });

  it('lets a later saved value of a cell retire that cell’s failed one', async () => {
    const { controller, source, dispose } = setup();
    vi.mocked(source.write).mockImplementationOnce(() => errAsync(offline));
    await controller.save(
      { kind: 'cell', rowId: 'record', columnId: 'status', value: 'Doing' },
      { label: 'Status' }
    );
    expect(controller.failure()?.label).toBe('Status');

    await controller.save(
      { kind: 'cell', rowId: 'record', columnId: 'status', value: 'Done' },
      { label: 'Status' }
    );

    expect(controller.failure()).toBeUndefined();
    dispose();
  });
});

it('clears cells optimistically as one write and restores them after a refused batch', async () => {
  const { controller, source, dispose } = setup();
  const waiting = deferred<Result<DatabaseWriteResult, DatabaseWriteFailure>>();
  vi.mocked(source.write).mockReturnValueOnce(new ResultAsync(waiting.promise));
  const saving = controller.save({
    kind: 'clear',
    rowIds: ['record'],
    columnIds: ['title', 'status'],
  });
  expect(controller.rows()[0].cells).toEqual({ title: null, status: null });
  waiting.resolve(
    err({
      kind: 'ops',
      error: { code: 'NETWORK_ERROR', message: 'Offline', refusal: null },
    })
  );
  expect((await saving).isErr()).toBe(true);
  expect(controller.rows()[0].cells).toEqual({
    status: 'To do',
    title: 'Plan launch',
  });
  expect(source.write).toHaveBeenCalledTimes(1);
  dispose();
});
