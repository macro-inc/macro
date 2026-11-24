import type {
  TimeGrouping,
  TimeReportScope,
} from '@service-storage/graphql/generated/graphql';
import { createSignal } from 'solid-js';
import { useTimeTracking } from '../context/time-tracking-context';
import { weekAt } from '../core/week';
import { createTimeSummaryQuery } from '../queries/time-summary';
import type { ProjectTimeClock } from './create-project-time';
import { refreshOnChanges, summaryFor } from './summary-read';

/**
 * One week of the viewer's or their team's time, stepping a week at a time
 * from the current one. Summaries read the primary and re-read after the
 * viewer's writes, so a length just typed into the grid shows at once.
 */
export function createWeekTime(options: {
  scope: Extract<TimeReportScope, 'MINE' | 'TEAM'>;
  groupBy: TimeGrouping;
  thenBy: TimeGrouping;
  clock: ProjectTimeClock;
}) {
  const { client } = useTimeTracking();
  const [offset, setOffset] = createSignal(0);
  const days = () =>
    weekAt(options.clock.today(), options.clock.weekStartsOn(), offset());
  const read = createTimeSummaryQuery(
    () => ({
      scope: options.scope,
      from: days().from,
      to: days().to,
      groupBy: options.groupBy,
      thenBy: options.thenBy,
    }),
    client
  );
  refreshOnChanges(read.refetch);
  return {
    days,
    /** Weeks from the current one: 0 is this week. */
    offset,
    previousWeek: () => setOffset((weeks) => weeks - 1),
    nextWeek: () => setOffset((weeks) => weeks + 1),
    thisWeek: () => setOffset(0),
    ...summaryFor(read, days),
  };
}

export type WeekTime = ReturnType<typeof createWeekTime>;
