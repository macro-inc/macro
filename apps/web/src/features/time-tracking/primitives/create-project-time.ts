import { beginInteraction } from '@app/observability/flow';
import type { TimeGrouping } from '@service-storage/graphql/generated/graphql';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { match } from 'ts-pattern';
import { useTimeTracking } from '../context/time-tracking-context';
import {
  type DayRange,
  periodRange,
  type TimePeriod,
  type WeekStart,
  weekRange,
} from '../core/time-period';
import { readTimeExport } from '../queries/time-export';
import { createTimeSummaryQuery } from '../queries/time-summary';
import { refreshOnChanges, summaryFor } from './summary-read';

/** What opens under each row of a project's breakdown. */
export function projectThenBy(grouping: TimeGrouping): TimeGrouping {
  return match(grouping)
    .with('PERSON', () => 'TASK' as const)
    .with('TASK', () => 'PERSON' as const)
    .with('DAY', () => 'TASK' as const)
    .exhaustive();
}

/** Today on this device and the calendar's first day of the week. */
export type ProjectTimeClock = {
  today: Accessor<string>;
  weekStartsOn: Accessor<WeekStart>;
};

/** Saves a CSV the way the platform saves files. */
export type SaveCsv = (
  content: string,
  filename: string
) => Promise<{ saved: boolean }>;

export type ExportOutcome =
  | { kind: 'saved'; rows: number; complete: boolean }
  | { kind: 'cancelled' }
  | { kind: 'failed' };

function exportFilename(projectName: string, days: DayRange): string {
  const slug =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project';
  return `macro-time-${slug}-${days.from}-to-${days.to}.csv`;
}

/**
 * A project's time over a chosen period, grouped by person, task or day with
 * what each group holds. Everything is summed on the server; this keeps the
 * choices and re-reads after the viewer's own writes.
 */
export function createProjectTime(
  projectId: Accessor<string>,
  clock: ProjectTimeClock,
  initial: { grouping: TimeGrouping } = { grouping: 'PERSON' }
) {
  const { client } = useTimeTracking();
  const [choice, setChoice] = createStore<{
    period: TimePeriod;
    grouping: TimeGrouping;
  }>({ period: 'this-month', grouping: initial.grouping });
  const days = () =>
    periodRange(choice.period, clock.today(), clock.weekStartsOn());
  const read = createTimeSummaryQuery(
    () => ({
      scope: 'PROJECT',
      projectId: projectId(),
      from: days().from,
      to: days().to,
      groupBy: choice.grouping,
      thenBy: projectThenBy(choice.grouping),
    }),
    client
  );
  refreshOnChanges(read.refetch);
  return {
    period: () => choice.period,
    setPeriod: (period: TimePeriod) => setChoice('period', period),
    grouping: () => choice.grouping,
    setGrouping: (grouping: TimeGrouping) => setChoice('grouping', grouping),
    days,
    ...summaryFor(read, days),
  };
}

export type ProjectTime = ReturnType<typeof createProjectTime>;

/** The project's time in the current week, whatever period is chosen. */
export function createProjectWeekTime(
  projectId: Accessor<string>,
  clock: ProjectTimeClock
) {
  const { client } = useTimeTracking();
  const week = () => weekRange(clock.today(), clock.weekStartsOn());
  const read = createTimeSummaryQuery(
    () => ({
      scope: 'PROJECT',
      projectId: projectId(),
      from: week().from,
      to: week().to,
      groupBy: 'DAY',
    }),
    client
  );
  refreshOnChanges(read.refetch);
  const shown = summaryFor(read, week);
  return {
    minutes: (): number | undefined => shown.summary()?.totalMinutes,
    failed: shown.failed,
  };
}

/**
 * Exports a project's entries over a period as CSV, as the server writes it,
 * and hands the file to the platform. One export runs at a time.
 */
export function createProjectTimeExport(
  project: Accessor<{ id: string; name: string }>,
  days: Accessor<DayRange>,
  save: SaveCsv
) {
  const [pending, setPending] = createSignal(false);
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  async function run(): Promise<ExportOutcome> {
    if (pending()) return { kind: 'cancelled' };
    const { id, name } = project();
    const range = days();
    const interaction = beginInteraction('time.export', {
      attributes: { 'project.id': id },
    });
    setPending(true);
    const abort = new AbortController();
    controller = abort;
    try {
      const read = await readTimeExport(
        { scope: 'project', projectId: id, from: range.from, to: range.to },
        abort.signal
      );
      // Leaving the tab mid-export aborts it; that is not a failure to report.
      if (read.isErr())
        return abort.signal.aborted
          ? { kind: 'cancelled' }
          : { kind: 'failed' };
      const { saved } = await save(
        `\uFEFF${read.value.csv}`,
        exportFilename(name, range)
      );
      if (!saved) return { kind: 'cancelled' };
      return {
        kind: 'saved',
        rows: read.value.rows,
        complete: read.value.complete,
      };
    } finally {
      setPending(false);
      interaction.end();
    }
  }
  return { pending, run };
}
