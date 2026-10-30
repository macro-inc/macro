import { match } from 'ts-pattern';
import type { HistoryRecord, HistoryStep } from './history';
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

/** A run in a line: why it failed, or what it decided or did first. */
export function summarizeRun(
  record: HistoryRecord,
  steps: StepDraft[] | undefined
): string {
  if (record.success === false) {
    const failed = record.steps?.find(
      (step) => (step.kind === 'tool' || step.kind === 'agent') && step.error
    );
    const reason =
      failed?.kind === 'tool' || failed?.kind === 'agent'
        ? failed.error
        : record.error;
    return reason ? `Failed: ${reason}` : 'Failed';
  }
  const [first] = record.steps ?? [];
  return first ? describeHistoryStep(first, steps) : 'Ran';
}
