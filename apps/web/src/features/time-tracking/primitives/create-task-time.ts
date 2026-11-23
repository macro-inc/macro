import { beginInteraction } from '@app/observability/flow';
import type { TimeEntryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { err } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { useTimeTracking } from '../context/time-tracking-context';
import {
  createTaskTimeEntriesQuery,
  deleteTimeEntry,
  logTime,
  type TimeEntryValues,
  updateTimeEntry,
} from '../queries/time-entries';
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
 * A task's time: its entries, newest day first, and the writes that change
 * them. Writes show at once and wait offline in the durable queue.
 */
export function createTaskTime(taskId: Accessor<string | undefined>) {
  const { client, cacheHost, viewerId } = useTimeTracking();
  const entries = createTaskTimeEntriesQuery(taskId, client);
  const dependencies = () => ({ client: client(), host: cacheHost() });

  return {
    entries: entries.entries,
    pending: entries.pending,
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

export type TaskTime = ReturnType<typeof createTaskTime>;
