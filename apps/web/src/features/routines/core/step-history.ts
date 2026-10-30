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

function humanize(tool: string): string {
  return tool.replace(/([a-z])([A-Z])/g, '$1 $2');
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
          : humanize(record.tool);
      return record.error ? `${label} failed: ${record.error}` : label;
    })
    .with({ kind: 'agent' }, (record) =>
      record.error ? `AI failed: ${record.error}` : 'Asked AI'
    )
    .exhaustive();
}

/** The most recent run that reached its steps, to show on the editor. */
export function latestStepRun(
  records: readonly HistoryRecord[]
): (HistoryRecord & { steps: HistoryStep[] }) | undefined {
  return records
    .filter(
      (record): record is HistoryRecord & { steps: HistoryStep[] } =>
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
