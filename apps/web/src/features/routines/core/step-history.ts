import { isSameDay, isSameYear, subDays } from 'date-fns';
import { match } from 'ts-pattern';
import type { HistoryRecord, HistorySkip, HistoryStep } from './history';
import type { StepDraft } from './routine-steps';

/** The step a run recorded at `path` (its index), if the routine still has one there. */
export function stepAtPath(
  steps: StepDraft[] | undefined,
  path: string
): StepDraft | undefined {
  const position = Number(path);
  return Number.isInteger(position) ? steps?.[position] : undefined;
}

/**
 * The routine's steps to read a run's step paths against: only those of the
 * configuration the run used, since an edit can put another step at a path.
 */
export function stepsForRun(
  record: HistoryRecord,
  routine: { revision: number; draft?: { steps?: StepDraft[] } }
): StepDraft[] | undefined {
  return record.revision === routine.revision
    ? routine.draft?.steps
    : undefined;
}

/**
 * A short description of what a run did at one step, by the step in the
 * configuration the run used when it's known.
 */
export function describeHistoryStep(
  record: HistoryStep,
  steps: StepDraft[] | undefined
): string {
  const step = stepAtPath(steps, record.path);
  return match(record)
    .with({ kind: 'agent' }, (record) =>
      record.error ? `AI failed: ${record.error}` : 'Asked AI'
    )
    .with({ kind: 'code' }, (record) => {
      const title = (step?.kind === 'code' && step.title.trim()) || 'Ran code';
      return record.error ? `${title} failed: ${record.error}` : title;
    })
    .exhaustive();
}

/**
 * How a run ended. A run its trigger's condition skipped is neither a
 * success nor a failure, and one whose decisions led to no action changed
 * nothing.
 */
export type RunOutcome =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'nothing';

export function runOutcome(record: HistoryRecord): RunOutcome {
  if (!record.id) return 'running';
  if (record.skipped) return 'skipped';
  if (!record.success) return 'failed';
  // Code acted when one of its writes went through.
  const acted = record.steps?.some(
    (step) =>
      step.kind === 'agent' ||
      step.calls.some((call) => call.write && call.status === 'completed')
  );
  return record.steps?.length && !acted ? 'nothing' : 'succeeded';
}

/** Why a trigger's condition kept a run from starting. */
export function describeSkip(skip: HistorySkip): string {
  return skip.reason === 'not_met'
    ? 'Condition not met'
    : 'Condition couldn’t be checked';
}

/** The step that failed a run, if one did. */
export function failedStep(record: HistoryRecord): HistoryStep | undefined {
  return record.steps?.find((step) => Boolean(step.error));
}

/** A run in a line: why it was skipped or failed, or what it did first. */
export function summarizeRun(
  record: HistoryRecord,
  steps: StepDraft[] | undefined
): string {
  if (record.skipped) {
    return record.skipped.reason === 'not_met'
      ? 'Skipped: condition not met'
      : 'Skipped: condition couldn’t be checked';
  }
  if (record.success === false) {
    const reason = failedStep(record)?.error ?? record.error;
    return reason ? `Failed: ${reason}` : 'Failed';
  }
  const [first] = record.steps ?? [];
  return first ? describeHistoryStep(first, steps) : 'Ran';
}

/** Runs of one day, newest first, under the day's label. */
export type RunDay = { key: string; label: string; records: HistoryRecord[] };

function dayLabel(date: Date, now: Date): string {
  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, subDays(now, 1))) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(isSameYear(date, now) ? {} : { year: 'numeric' }),
  }).format(date);
}

/**
 * Groups runs by the day they started, in the order the days first appear;
 * a run still starting is today's. Each day appears once, keyed by its date.
 */
export function runDays(
  records: readonly HistoryRecord[],
  now = new Date()
): RunDay[] {
  const days = new Map<string, RunDay>();
  for (const record of records) {
    const started = record.startedAt ? new Date(record.startedAt) : now;
    const date = Number.isNaN(started.getTime()) ? now : started;
    const key = date.toDateString();
    const day = days.get(key);
    if (day) day.records.push(record);
    else days.set(key, { key, label: dayLabel(date, now), records: [record] });
  }
  return [...days.values()];
}
