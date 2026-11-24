import type { DayRange } from '../core/time-period';
import type { TimeSummary, TimeSummaryRead } from '../queries/time-summary';
import { refreshOnTimeTrackingChanges } from '../queries/time-tracking-changes';

/**
 * The read's summary only once it covers `days`: while another period loads,
 * or after it failed, the last summary is not this period's.
 */
export function summaryFor(read: TimeSummaryRead, days: () => DayRange) {
  const summary = (): TimeSummary | undefined => {
    const shown = read.summary();
    const range = days();
    return shown && shown.from === range.from && shown.to === range.to
      ? shown
      : undefined;
  };
  return {
    summary,
    /** Nothing to show for this period yet. */
    pending: () => !read.error() && summary() === undefined,
    /** This period's read failed with nothing to show; a failed refetch keeps it. */
    failed: () => read.error() && summary() === undefined,
    refetch: read.refetch,
  };
}

/** Re-read summaries when the viewer's own time changes elsewhere. */
export function refreshOnChanges(refetch: () => Promise<unknown>) {
  refreshOnTimeTrackingChanges(async (change) => {
    if (change.taskId) await refetch();
  }, refetch);
}
