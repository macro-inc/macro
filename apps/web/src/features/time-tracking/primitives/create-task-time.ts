import { beginInteraction } from '@app/observability/flow';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { err } from 'neverthrow';
import { type Accessor, createSignal, mapArray } from 'solid-js';
import {
  type TimeTrackingCapabilities,
  useTimeTracking,
} from '../context/time-tracking-context';
import type { TimeEntryValues } from '../core/entry-values';
import {
  createTaskTimeEntriesAfterQuery,
  createTaskTimeEntriesQuery,
  deleteTimeEntry,
  logTime,
  updateTimeEntry,
} from '../queries/time-entries';
import { refreshOnTimeTrackingChanges } from '../queries/time-tracking-changes';
import type { TimeWriteResult } from '../queries/write-result';

const NO_VIEWER: TimeWriteResult = err({
  kind: 'failed',
  error: new Error('time is logged by a signed-in person on a task'),
});

async function traced(
  name: string,
  taskId: string,
  write: () => Promise<TimeWriteResult>
): Promise<TimeWriteResult> {
  const interaction = beginInteraction(name, {
    attributes: { 'task.id': taskId },
  });
  try {
    return await write();
  } finally {
    interaction.end();
  }
}

/**
 * Changes to one's own entries, wherever they show: they show at once and
 * wait offline in the durable queue.
 */
export function createTimeEntryWrites(
  capabilities: Pick<TimeTrackingCapabilities, 'client' | 'cacheHost'>
) {
  const { client, cacheHost } = capabilities;
  const dependencies = () => ({ client: client(), host: cacheHost() });
  return {
    update(
      entry: TimeEntryFieldsFragment,
      values: TimeEntryValues
    ): Promise<TimeWriteResult> {
      return traced('time.update', entry.taskId, () =>
        updateTimeEntry({ entry, values }, dependencies())
      );
    },
    remove(entry: TimeEntryFieldsFragment): Promise<TimeWriteResult> {
      return traced('time.delete', entry.taskId, () =>
        deleteTimeEntry({ entry }, dependencies())
      );
    },
  };
}

/**
 * A task's time: its entries, newest day first, and the writes that change
 * them. Writes show at once and wait offline in the durable queue.
 */
export function createTaskTime(taskId: Accessor<string | undefined>) {
  const capabilities = useTimeTracking();
  const { client, cacheHost, viewerId } = capabilities;
  const writes = createTimeEntryWrites(capabilities);
  const entries = createTaskTimeEntriesQuery(taskId, client);
  // Older pages the person asked for, kept only for the task they were read on.
  const [older, setOlder] = createSignal<{
    taskId: string;
    cursors: string[];
  }>();
  const cursors = () => {
    const read = older();
    return read && read.taskId === taskId() ? read.cursors : [];
  };
  const olderPages = mapArray(cursors, (cursor) =>
    createTaskTimeEntriesAfterQuery(taskId, () => cursor, client)
  );
  const nextCursor = () => {
    const pages = olderPages();
    const last = pages.at(-1);
    return last ? last.nextCursor() : entries.nextCursor();
  };
  // A new entry can push one from the first page onto the next one read.
  const allEntries = () => {
    const seen = new Set<string>();
    const unique: TimeEntryFieldsFragment[] = [];
    const read = [
      ...entries.entries(),
      ...olderPages().flatMap((page) => page.entries()),
    ];
    for (const entry of read) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      unique.push(entry);
    }
    return unique;
  };
  const dependencies = () => ({ client: client(), host: cacheHost() });
  refreshOnTimeTrackingChanges(
    async (change) => {
      const id = taskId();
      if (id && change.taskId === id) await entries.refetch();
    },
    async () => {
      if (taskId()) await entries.refetch();
    }
  );

  return {
    entries: allEntries,
    pending: entries.pending,
    /** More entries exist past the ones shown. */
    // A page still loading may have more after it, and the control that
    // asked for it stays in place meanwhile.
    hasOlder: () =>
      nextCursor() !== undefined || olderPages().some((page) => page.pending()),
    olderPending: () => olderPages().some((page) => page.pending()),
    showOlder() {
      const id = taskId();
      const next = nextCursor();
      if (!id || !next) return;
      setOlder({ taskId: id, cursors: [...cursors(), next] });
    },
    failed: entries.failed,
    refetch: entries.refetch,
    viewerId,
    log(values: TimeEntryValues): Promise<TimeWriteResult> {
      const id = taskId();
      const userId = viewerId();
      if (!id || !userId) return Promise.resolve(NO_VIEWER);
      return traced('time.log', id, () =>
        logTime({ taskId: id, userId, values }, dependencies())
      );
    },
    update: writes.update,
    remove: writes.remove,
  };
}

export type TaskTime = ReturnType<typeof createTaskTime>;
