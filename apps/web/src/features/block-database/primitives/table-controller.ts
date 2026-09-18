import { Mutex } from 'async-mutex';
import { createMemo, createSignal, onCleanup } from 'solid-js';
import { DatabaseWriteConflict, type DatabaseRowsSource, type DatabaseWriteResult } from '../context/table-source';
import { optimisticRows, type DatabaseRowMutation } from '../core/table';

type PendingWrite = { id: number; mutation: DatabaseRowMutation };
type FailedWrite = { mutation: DatabaseRowMutation; label: string; option?: string; message: string; conflict: boolean };

/** One writer per mounted table. A queued edit always uses the latest completed read/write. */
export function createTableController(source: DatabaseRowsSource) {
  const mutex = new Mutex();
  const [pending, setPending] = createSignal<PendingWrite[]>([]);
  const [failure, setFailure] = createSignal<FailedWrite>();
  const [refreshWarning, setRefreshWarning] = createSignal(false);
  let sequence = 0;
  let lastWrittenVersion: number | undefined;
  let disposed = false;
  onCleanup(() => { disposed = true; });

  async function save(mutation: DatabaseRowMutation, label = 'change', option?: string): Promise<DatabaseWriteResult | undefined> {
    if (disposed) return;
    const id = ++sequence;
    setPending((writes) => [...writes, { id, mutation }]);
    try {
      return await mutex.runExclusive(async () => {
        // Switching tables must not dispatch an edit that has not started yet.
        if (disposed) return;
        try {
          if (option !== undefined && mutation.kind === 'cell') {
            await source.addOption(mutation.columnId, option);
            await source.refresh();
          }
          const readVersion = source.snapshot()?.version;
          const version = readVersion === undefined ? lastWrittenVersion
            : lastWrittenVersion === undefined ? readVersion : Math.max(readVersion, lastWrittenVersion);
          const written = await source.write(mutation, version);
          lastWrittenVersion = written.version ?? lastWrittenVersion;
          setFailure(undefined);
          // A failed refresh cannot turn a committed write into a failed edit.
          try {
            await source.refresh();
            setRefreshWarning(false);
          } catch {
            setRefreshWarning(true);
          }
          return written;
        } catch (error) {
          const conflict = error instanceof DatabaseWriteConflict;
          if (conflict) {
            try { await source.refresh(); } catch { setRefreshWarning(true); }
          }
          setFailure({ mutation, label, option, conflict, message: error instanceof Error ? error.message : String(error) });
          return undefined;
        }
      });
    } finally {
      setPending((writes) => writes.filter((write) => write.id !== id));
    }
  }

  async function retry() {
    const failed = failure();
    if (!failed) return;
    await save(failed.mutation, failed.label, failed.option);
  }

  async function refresh() {
    try {
      await source.refresh();
      setRefreshWarning(false);
    } catch { setRefreshWarning(true); }
  }

  return {
    rows: createMemo(() => optimisticRows(source.snapshot()?.rows ?? [], pending().map((write) => write.mutation))),
    pending: () => pending().length > 0,
    rowPending: (rowId: string) => pending().some((write) => write.mutation.kind !== 'create' && write.mutation.rowId === rowId),
    failure,
    refreshWarning,
    save,
    retry,
    refresh,
    dismissFailure: () => setFailure(undefined),
  };
}
