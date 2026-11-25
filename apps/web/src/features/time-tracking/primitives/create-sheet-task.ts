import type { Accessor } from 'solid-js';
import { useTimeTracking } from '../context/time-tracking-context';
import {
  createReportTaskQuery,
  type SummaryTask,
} from '../queries/report-task';

/**
 * The task a timesheet row shows: the week's summary has it once it has
 * time; a task put on the sheet before that is read on its own, and only
 * while the summary lacks it. Both are the cache's one record of the task,
 * so the row looks the same when its first time is logged.
 */
export function createSheetTask(
  taskId: Accessor<string>,
  inSummary: Accessor<SummaryTask | undefined>
): Accessor<SummaryTask | undefined> {
  const { client } = useTimeTracking();
  const read = createReportTaskQuery(
    () => (inSummary() ? undefined : taskId()),
    client
  );
  return () => inSummary() ?? read();
}
