import { Telemetry } from '@macro-inc/observability';
import type { DatabaseOpsError } from '@service-storage/databases';
import { err, ok, type Result } from 'neverthrow';
import { batch, createMemo, createSignal, onCleanup } from 'solid-js';
import type {
  DatabaseRowsSource,
  DatabaseWriteResult,
} from '../context/table-source';
import { keepUnchangedRows } from '../core/grid-cells';
import { createKeyedSerializer } from '../core/keyed-serializer';
import {
  type DatabaseRow,
  type DatabaseRowMutation,
  optimisticRows,
} from '../core/table';
import type { DatabaseWriteFailure } from '../core/write-failure';

type PendingWrite = {
  id: number;
  mutation: DatabaseRowMutation;
  createIntentId?: string;
};
export type FailedWrite = {
  mutation: DatabaseRowMutation;
  label: string;
  option?: string;
  createIntentId?: string;
  failure: DatabaseWriteFailure;
};

/** A save that did not land: the write failed, or the table was closed. */
export type DatabaseSaveFailure = DatabaseWriteFailure | { kind: 'unmounted' };

type DatabaseSave = Result<DatabaseWriteResult, DatabaseSaveFailure>;

/** How a save is told apart and described. */
export type DatabaseSaveRequest = {
  /** What the failure banner calls the edit; "change" by default. */
  label?: string;
  /** A label the write may create as a new option, kept for a retry. */
  option?: string;
  /** Ties repeated attempts at one new row together, so it is created once. */
  createIntentId?: string;
};

export type AcceptedDraftWrites = {
  save: (
    mutation: DatabaseRowMutation,
    request?: DatabaseSaveRequest
  ) => Promise<DatabaseSave>;
};

const UNMOUNTED = { kind: 'unmounted' } as const;

const TABLE_WRITES = 'table';

const GROUP_UNMOUNTED: DatabaseOpsError = {
  code: 'UNKNOWN_ERROR',
  message: 'The table was closed before the group was added.',
  refusal: null,
};

/** The same edit: one object, or a later value for the same cell. */
function sameEdit(left: DatabaseRowMutation, right: DatabaseRowMutation) {
  return (
    left === right ||
    (left.kind === 'cell' &&
      right.kind === 'cell' &&
      left.rowId === right.rowId &&
      left.columnId === right.columnId)
  );
}

/** One writer per mounted table. A queued edit always uses the latest completed read/write. */
export function createTableController(
  source: DatabaseRowsSource,
  onSaved?: (mutation: DatabaseRowMutation, result: DatabaseWriteResult) => void
) {
  // Row writes and schema changes share one queue: both advance the table version.
  const writes = createKeyedSerializer();
  const [completedCreates, setCompletedCreates] = createSignal(
    new Map<string, DatabaseWriteResult>()
  );
  const [pending, setPending] = createSignal<PendingWrite[]>([]);
  const [failures, setFailures] = createSignal<FailedWrite[]>([]);
  const [committed, setCommitted] = createSignal<
    {
      version: number | undefined;
      mutation: DatabaseRowMutation;
      insertedRowIds: string[];
    }[]
  >([]);
  const [refreshWarning, setRefreshWarning] = createSignal(false);
  const [schemaPending, setSchemaPending] = createSignal(0);
  let sequence = 0;
  // A new column's type settles against the newest version this writer has
  // seen, read or written; row ops themselves carry no version.
  let lastWrittenVersion: number | undefined;
  let disposed = false;
  const [uncertainCreates, setUncertainCreates] = createSignal(
    new Map<string, FailedWrite>()
  );
  const uncertainMutations = new WeakMap<DatabaseRowMutation, FailedWrite>();
  onCleanup(() => {
    disposed = true;
  });

  async function save(
    mutation: DatabaseRowMutation,
    { label = 'change', option, createIntentId }: DatabaseSaveRequest = {}
  ): Promise<DatabaseSave> {
    const completed = createIntentId && completedCreates().get(createIntentId);
    if (completed) return ok(completed);
    const id = ++sequence;
    const span = Telemetry.span('database.rows.save');
    const optimisticStarted = performance.now();
    span.setAttr('database.mutation_kind', mutation.kind);
    setPending((writes) => [...writes, { id, mutation, createIntentId }]);
    span.setAttr(
      'database.optimistic_update_ms',
      performance.now() - optimisticStarted
    );
    span.event('optimistic_state_applied');
    const queued = performance.now();
    span.event('queued');
    let result: DatabaseSave;
    let didWrite = false;
    try {
      result = await span.run(() =>
        writes.run(TABLE_WRITES, async (): Promise<DatabaseSave> => {
          span.setAttr('database.queue_ms', performance.now() - queued);
          span.event('dequeued');
          // A new table version cannot prove whether this INSERT committed.
          // Keep the same draft blocked even after refresh or banner dismissal.
          const uncertain =
            (createIntentId && uncertainCreates().get(createIntentId)) ||
            uncertainMutations.get(mutation);
          if (uncertain) {
            setFailures((failed) =>
              failed.includes(uncertain) ? failed : [...failed, uncertain]
            );
            return err(uncertain.failure);
          }
          // Draft submit and the error-banner Retry can be queued together.
          const completed =
            createIntentId && completedCreates().get(createIntentId);
          if (completed) return ok(completed);
          const readVersion = source.snapshot()?.version;
          const inferenceBaseVersion =
            readVersion === undefined
              ? lastWrittenVersion
              : lastWrittenVersion === undefined
                ? readVersion
                : Math.max(readVersion, lastWrittenVersion);
          // A new option is created by the write that first uses it.
          const written = await span.span('database.rows.write', async () =>
            source.write(mutation, inferenceBaseVersion, option !== undefined)
          );
          if (written.isErr()) {
            const failure = written.error;
            const outcomeUnknown = failure.kind === 'outcome-unknown';
            if (outcomeUnknown && (await source.refresh('after-write')).isErr())
              setRefreshWarning(true);
            const failed: FailedWrite = {
              mutation,
              label,
              option,
              createIntentId,
              failure,
            };
            if (outcomeUnknown) {
              uncertainMutations.set(mutation, failed);
              if (createIntentId)
                setUncertainCreates((creates) =>
                  new Map(creates).set(createIntentId, failed)
                );
            }
            setFailures((failures) => [
              ...failures.filter(
                (entry) =>
                  !sameEdit(entry.mutation, mutation) &&
                  (createIntentId === undefined ||
                    entry.createIntentId !== createIntentId)
              ),
              failed,
            ]);
            return err(failure);
          }
          didWrite = true;
          span.event('committed');
          const saved = written.value;
          batch(() => {
            if (createIntentId)
              setCompletedCreates((creates) =>
                new Map(creates).set(createIntentId, saved)
              );
            lastWrittenVersion = saved.version ?? lastWrittenVersion;
            // A later successful edit must not hide an earlier rejected edit
            // of another cell.
            setFailures((failed) =>
              failed.filter(
                (entry) =>
                  !sameEdit(entry.mutation, mutation) &&
                  (createIntentId === undefined ||
                    entry.createIntentId !== createIntentId)
              )
            );
            setCommitted((writes) => [
              ...writes,
              {
                mutation,
                version: saved.version,
                insertedRowIds: saved.insertedRowIds,
              },
            ]);
          });
          // A failed refresh cannot turn a committed write into a failed edit.
          span.event('committed_state_applied');
          await span.span('database.rows.refresh', async () =>
            refresh('after-write')
          );
          span.event('refresh_completed');
          return ok(saved);
        })
      );
      span.setAttr('database.outcome', result.isOk() ? 'success' : 'error');
    } catch (error) {
      span.setAttr('database.outcome', 'error');
      throw error;
    } finally {
      setPending((writes) => writes.filter((write) => write.id !== id));
      span.end();
    }
    if (result.isOk() && didWrite && !disposed)
      onSaved?.(mutation, result.value);
    return result;
  }

  async function retry() {
    if (disposed) return;
    const failed = failures()[0];
    if (!failed) return;
    if (failed.failure.kind === 'outcome-unknown') {
      await refresh();
      return;
    }
    await save(failed.mutation, {
      label: failed.label,
      option: failed.option,
      createIntentId: failed.createIntentId,
    });
  }

  function pruneCommitted() {
    const version = source.snapshot()?.version;
    // A successful read can resolve before its reactive snapshot is published.
    setCommitted((writes) =>
      writes.filter(
        (write) =>
          write.version !== undefined &&
          (version === undefined || write.version > version)
      )
    );
  }

  async function refresh(reason: 'after-write' | 'refresh' = 'refresh') {
    const refreshed = await source.refresh(reason);
    setRefreshWarning(refreshed.isErr());
    if (refreshed.isOk()) pruneCommitted();
  }

  /** Schema changes share the row-write queue because both advance the table version. */
  async function addGroup(
    columnId: string,
    label: string
  ): Promise<Result<void, DatabaseOpsError>> {
    setSchemaPending((count) => count + 1);
    try {
      return await writes.run(TABLE_WRITES, async () => {
        const added = await source.addOption(columnId, label);
        // The option is saved even if its subsequent rows refresh fails.
        if (added.isOk()) await refresh('after-write');
        return added;
      });
    } finally {
      setSchemaPending((count) => count - 1);
    }
  }

  // What the grid shows reads the source once per change; writes read it
  // directly, as they may finish after this owner is gone.
  const snapshot = createMemo(() => source.snapshot());
  const unreadWrites = createMemo(() => {
    const version = snapshot()?.version;
    return committed().filter(
      (write) =>
        write.version === undefined ||
        version === undefined ||
        write.version > version
    );
  });
  const mutations = () => [
    ...unreadWrites().map((write) => write.mutation),
    ...pending().map((write) => write.mutation),
  ];

  // A row that reads as before stays the object the grid shows, so a read or
  // a write redraws only the rows it changed.
  const rows = createMemo<DatabaseRow[]>((shown) => {
    const read = snapshot()?.rows ?? [];
    // Acknowledged inserts remain openable when only the follow-up read failed.
    // Whether they match the view is unknown until then, so they stay on screen.
    const created: DatabaseRow[] = unreadWrites().flatMap((write) => {
      if (write.mutation.kind !== 'create') return [];
      const cells = write.mutation.values;
      return write.insertedRowIds
        .filter((rowId) => !read.some((row) => row.rowId === rowId))
        .map((rowId) => ({ rowId, cells }));
    });
    return keepUnchangedRows(
      shown,
      optimisticRows([...read, ...created], mutations())
    );
  }, []);

  return {
    /** The source's last read, as the grid shows it. */
    snapshot,
    /** The rows the view's statement returned, with local writes applied until they are read back. */
    rows,
    /** The view's rows, then the rows it retains by id that it does not show. */
    knownRows: createMemo<DatabaseRow[]>((known) => {
      const shown = rows();
      const retained = (snapshot()?.retained ?? []).filter(
        (row) => !shown.some((known) => known.rowId === row.rowId)
      );
      return keepUnchangedRows(known, [
        ...shown,
        ...optimisticRows(retained, mutations()),
      ]);
    }, []),
    pending: () => pending().length > 0 || schemaPending() > 0,
    createPending: (intentId: string) =>
      pending().some((write) => write.createIntentId === intentId),
    createComplete: (intentId: string) => completedCreates().has(intentId),
    createResult: (intentId: string) => completedCreates().get(intentId),
    createUncertain: (intentId: string) => uncertainCreates().has(intentId),
    rowPending: (rowId: string) =>
      pending().some((write) =>
        write.mutation.kind === 'clear'
          ? write.mutation.rowIds.includes(rowId)
          : write.mutation.kind !== 'create' && write.mutation.rowId === rowId
      ),
    failure: () => failures()[0],
    refreshWarning,
    save: (...request: Parameters<typeof save>): Promise<DatabaseSave> =>
      disposed ? Promise.resolve(err(UNMOUNTED)) : save(...request),
    // A draft may need its inserted row ID before it can submit later fields.
    // Admit the whole drain while mounted so those accepted writes survive a tab switch.
    runDraftWrites: (
      drain: (writes: AcceptedDraftWrites) => Promise<boolean>
    ) => (disposed ? Promise.resolve(false) : drain({ save })),
    retry,
    refresh: () => refresh(),
    addGroup: (
      ...request: Parameters<typeof addGroup>
    ): ReturnType<typeof addGroup> =>
      disposed ? Promise.resolve(err(GROUP_UNMOUNTED)) : addGroup(...request),
    dismissFailure: () => setFailures((failed) => failed.slice(1)),
  };
}
