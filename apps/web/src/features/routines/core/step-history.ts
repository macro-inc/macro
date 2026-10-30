import { isSameDay, isSameYear, subDays } from 'date-fns';
import { match } from 'ts-pattern';
import type { HistoryRecord, HistorySkip, HistoryStep } from './history';
import type { StepDraft } from './routine-steps';
import { describeToolStep } from './step-catalog';

/**
 * The step a run recorded at `path` (`1.then.0`, `2.options.1.0`), if the
 * routine still has one there.
 */
export function stepAtPath(
  steps: StepDraft[] | undefined,
  path: string
): StepDraft | undefined {
  const parts = path.split('.');
  let list = steps;
  let step: StepDraft | undefined;
  for (let index = 0; index < parts.length; ) {
    const position = Number(parts[index]);
    step = Number.isInteger(position) ? list?.[position] : undefined;
    index += 1;
    if (!step || index >= parts.length) break;
    const branch = parts[index];
    index += 1;
    list = match([step, branch] as const)
      .returnType<StepDraft[] | undefined>()
      .with([{ kind: 'if' }, 'then'], ([step]) => step.yes)
      .with([{ kind: 'if' }, 'else'], ([step]) => step.no)
      .with([{ kind: 'choose' }, 'otherwise'], ([step]) => step.otherwise)
      .with([{ kind: 'choose' }, 'options'], ([step]) => {
        const option = step.options[Number(parts[index])];
        index += 1;
        return option?.steps;
      })
      .otherwise(() => undefined);
    step = undefined;
  }
  return step;
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

/** What a tool did, from its name alone. */
function toolDone(tool: string): string {
  return match(tool)
    .with('UpdateThreadLabels', () => 'Changed labels')
    .with('SetSenderPolicy', () => 'Set the sender’s policy')
    .with('SetEntityProperty', () => 'Set a property')
    .with('CreateDocument', () => 'Created a document')
    .with('Comment', () => 'Commented')
    .with('SendChannelMessage', () => 'Sent a message')
    .with('MoveToProject', () => 'Moved to a folder')
    .otherwise(() => tool.replace(/([a-z])([A-Z])/g, '$1 $2'));
}

/** A short description of what a run did at one step. */
export function describeHistoryStep(
  record: HistoryStep,
  steps: StepDraft[] | undefined
): string {
  const step = stepAtPath(steps, record.path);
  return match(record)
    .with({ kind: 'if' }, (record) => {
      const question = step?.kind === 'if' ? step.condition.trim() : '';
      const answer = record.answer ? 'yes' : 'no';
      return question ? `${question} ${answer}` : `Decided ${answer}`;
    })
    .with({ kind: 'choose' }, (record) =>
      record.choices?.length
        ? `Chose ${record.choices.map((choice) => `“${choice}”`).join(', ')}`
        : 'No option fit'
    )
    .with({ kind: 'tool' }, (record) => {
      const label =
        step?.kind === 'tool' && step.tool === record.tool
          ? describeToolStep(step)
          : toolDone(record.tool);
      return record.error ? `${label} failed: ${record.error}` : label;
    })
    .with({ kind: 'agent' }, (record) =>
      record.error ? `AI failed: ${record.error}` : 'Asked AI'
    )
    .exhaustive();
}

/**
 * The most recent run that reached its steps, to show on the editor: only a
 * run of the configuration being edited, whose steps it can point at.
 */
export function latestStepRun(
  records: readonly HistoryRecord[],
  revision: number
): (HistoryRecord & { steps: HistoryStep[] }) | undefined {
  return records
    .filter(
      (record): record is HistoryRecord & { steps: HistoryStep[] } =>
        record.revision === revision &&
        !record.skipped &&
        Boolean(record.steps?.length) &&
        Boolean(record.endedAt)
    )
    .reduce<(HistoryRecord & { steps: HistoryStep[] }) | undefined>(
      (latest, record) =>
        !latest || (record.startedAt ?? '') > (latest.startedAt ?? '')
          ? record
          : latest,
      undefined
    );
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
  const acted = record.steps?.some(
    (step) => step.kind === 'tool' || step.kind === 'agent'
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
export function failedStep(
  record: HistoryRecord
): Extract<HistoryStep, { kind: 'tool' | 'agent' }> | undefined {
  return record.steps?.find(
    (step): step is Extract<HistoryStep, { kind: 'tool' | 'agent' }> =>
      (step.kind === 'tool' || step.kind === 'agent') && Boolean(step.error)
  );
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
