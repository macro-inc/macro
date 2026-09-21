import { Mutex } from 'async-mutex';
import { batch, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  type DatabaseRowsSource,
  DatabaseWriteConflict,
  DatabaseWriteOutcomeUnknown,
  type DatabaseWriteResult,
} from '../context/table-source';
import {
  type DatabaseRow,
  type DatabaseRowMutation,
  optimisticRows,
} from '../core/table';

type PendingWrite = {
  id: number;
  mutation: DatabaseRowMutation;
  createIntentId?: string;
};
type FailedWrite = {
  mutation: DatabaseRowMutation;
  label: string;
  option?: string;
  createIntentId?: string;
  message: string;
  conflict: boolean;
  outcomeUnknown: boolean;
};

export type AcceptedDraftWrites = {
  save: (
    mutation: DatabaseRowMutation,
    label?: string,
    option?: string,
    createIntentId?: string
  ) => Promise<DatabaseWriteResult | undefined>;
  addGroup: (columnId: string, label: string) => Promise<void>;
};

/** One writer per mounted table. A queued edit always uses the latest completed read/write. */
export function createTableController(
  source: DatabaseRowsSource,
  onSaved?: (mutation: DatabaseRowMutation, result: DatabaseWriteResult) => void
) {
  const mutex = new Mutex();
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
  let lastWrittenVersion: number | undefined;
  let disposed = false;
  const uncertainCreates = new Map<string, FailedWrite>();
  const uncertainMutations = new WeakMap<DatabaseRowMutation, FailedWrite>();
  onCleanup(() => {
    disposed = true;
  });

  async function save(
    mutation: DatabaseRowMutation,
    label = 'change',
    option?: string,
    createIntentId?: string
  ): Promise<DatabaseWriteResult | undefined> {
    const completed = createIntentId && completedCreates().get(createIntentId);
    if (completed) return completed;
    const id = ++sequence;
    setPending((writes) => [...writes, { id, mutation, createIntentId }]);
    let result: DatabaseWriteResult | undefined;
    let didWrite = false;
    try {
      result = await mutex.runExclusive(async () => {
        // A new table version cannot prove whether this INSERT committed.
        // Keep the same draft blocked even after refresh or banner dismissal.
        const uncertain =
          (createIntentId && uncertainCreates.get(createIntentId)) ||
          uncertainMutations.get(mutation);
        if (uncertain) {
          setFailures((failed) =>
            failed.includes(uncertain) ? failed : [...failed, uncertain]
          );
          return undefined;
        }
        // Draft submit and the error-banner Retry can be queued together.
        const completed =
          createIntentId && completedCreates().get(createIntentId);
        if (completed) return completed;
        try {
          if (option !== undefined && mutation.kind === 'cell') {
            await source.addOption(mutation.columnId, option);
            await source.refresh();
          }
          const readVersion = source.snapshot()?.version;
          const version =
            readVersion === undefined
              ? lastWrittenVersion
              : lastWrittenVersion === undefined
                ? readVersion
                : Math.max(readVersion, lastWrittenVersion);
          const written = await source.write(mutation, version);
          didWrite = true;
          batch(() => {
            if (createIntentId)
              setCompletedCreates((creates) =>
                new Map(creates).set(createIntentId, written)
              );
            lastWrittenVersion = written.version ?? lastWrittenVersion;
            // A later successful edit must not hide an earlier rejected edit.
            setFailures((failed) =>
              failed.filter(
                (entry) =>
                  entry.mutation !== mutation &&
                  (createIntentId === undefined ||
                    entry.createIntentId !== createIntentId)
              )
            );
            setCommitted((writes) => [
              ...writes,
              {
                mutation,
                version: written.version,
                insertedRowIds: written.insertedRowIds,
              },
            ]);
          });
          // A failed refresh cannot turn a committed write into a failed edit.
          try {
            await source.refresh();
            setRefreshWarning(false);
            pruneCommitted();
          } catch {
            setRefreshWarning(true);
          }
          return written;
        } catch (error) {
          const conflict = error instanceof DatabaseWriteConflict;
          const outcomeUnknown = error instanceof DatabaseWriteOutcomeUnknown;
          if (conflict || outcomeUnknown) {
            try {
              await source.refresh();
            } catch {
              setRefreshWarning(true);
            }
          }
          const failed = {
            mutation,
            label,
            option,
            createIntentId,
            conflict,
            outcomeUnknown,
            message: error instanceof Error ? error.message : String(error),
          };
          if (outcomeUnknown) {
            uncertainMutations.set(mutation, failed);
            if (createIntentId) uncertainCreates.set(createIntentId, failed);
          }
          setFailures((failures) => [
            ...failures.filter(
              (entry) =>
                entry.mutation !== mutation &&
                (createIntentId === undefined ||
                  entry.createIntentId !== createIntentId)
            ),
            failed,
          ]);
          return undefined;
        }
      });
    } finally {
      setPending((writes) => writes.filter((write) => write.id !== id));
    }
    if (result && didWrite && !disposed) onSaved?.(mutation, result);
    return result;
  }

  async function retry() {
    if (disposed) return;
    const failed = failures()[0];
    if (!failed) return;
    if (failed.outcomeUnknown) {
      await refresh();
      return;
    }
    await save(
      failed.mutation,
      failed.label,
      failed.option,
      failed.createIntentId
    );
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

  async function refresh() {
    try {
      await source.refresh();
      setRefreshWarning(false);
      pruneCommitted();
    } catch {
      setRefreshWarning(true);
    }
  }

  /** Schema changes share the row-write queue because both advance the table version. */
  async function addGroup(columnId: string, label: string) {
    setSchemaPending((count) => count + 1);
    try {
      await mutex.runExclusive(async () => {
        await source.addOption(columnId, label);
        // The option is saved even if its subsequent rows refresh fails.
        await refresh();
      });
    } finally {
      setSchemaPending((count) => count - 1);
    }
  }

  return {
    rows: createMemo(() => {
      const snapshot = source.snapshot();
      const saved = committed().filter(
        (write) =>
          write.version === undefined ||
          snapshot?.version === undefined ||
          write.version > snapshot.version
      );
      const rows = snapshot?.rows ?? [];
      // Acknowledged inserts remain openable when only the follow-up read failed.
      const created: DatabaseRow[] = saved.flatMap((write) => {
        if (write.mutation.kind !== 'create') return [];
        const cells = write.mutation.values;
        return write.insertedRowIds
          .filter((rowId) => !rows.some((row) => row.rowId === rowId))
          .map((rowId) => ({ rowId, cells }));
      });
      return optimisticRows(
        [...rows, ...created],
        [
          ...saved.map((write) => write.mutation),
          ...pending().map((write) => write.mutation),
        ]
      );
    }),
    pending: () => pending().length > 0 || schemaPending() > 0,
    createPending: (intentId: string) =>
      pending().some((write) => write.createIntentId === intentId),
    createComplete: (intentId: string) => completedCreates().has(intentId),
    createResult: (intentId: string) => completedCreates().get(intentId),
    createUncertain: (intentId: string) => uncertainCreates.has(intentId),
    rowPending: (rowId: string) =>
      pending().some(
        (write) =>
          write.mutation.kind !== 'create' && write.mutation.rowId === rowId
      ),
    failure: () => failures()[0],
    refreshWarning,
    save: (...args: Parameters<typeof save>) =>
      disposed ? Promise.resolve(undefined) : save(...args),
    // A draft may need its inserted row ID before it can submit later fields.
    // Admit the whole drain while mounted so those accepted writes survive a tab switch.
    runDraftWrites: (
      drain: (writes: AcceptedDraftWrites) => Promise<boolean>
    ) => (disposed ? Promise.resolve(false) : drain({ save, addGroup })),
    retry,
    refresh,
    addGroup: (...args: Parameters<typeof addGroup>) =>
      disposed ? Promise.resolve() : addGroup(...args),
    dismissFailure: () => setFailures((failed) => failed.slice(1)),
  };
}
