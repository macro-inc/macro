import { match } from 'ts-pattern';
import type { StepDraft } from './routine-steps';
import { eventScopeKind, type RoutineTriggerDraft } from './routine-triggers';

const firstLine = (value: string) => value.trim().split('\n')[0]?.trim() ?? '';

/** A closed step's line: its name, then what it does. */
export function stepHeadline(step: StepDraft): {
  title: string;
  summary: string;
  mode?: string;
} {
  return match(step)
    .returnType<{ title: string; summary: string; mode?: string }>()
    .with({ kind: 'agent' }, (step) => ({
      title: 'Ask AI',
      summary: firstLine(step.instructions),
    }))
    .with({ kind: 'code' }, (step) => ({
      title: step.title.trim() || 'Run code',
      summary: step.summary.trim(),
      mode: 'Code',
    }))
    .exhaustive();
}

/** AI calls one run makes: its Ask AI step. Code's own calls aren't counted. */
export function aiCallsPerRun(steps: StepDraft[]): number {
  return steps.some((step) => step.kind === 'agent') ? 1 : 0;
}

/** What one run is about: the kind of item its event triggers are about. */
export type RunSubject = 'email' | 'task' | 'document' | 'message';

export function runSubject(
  triggers: readonly RoutineTriggerDraft[]
): RunSubject | undefined {
  if (!triggers.length || triggers.some((trigger) => trigger.kind !== 'event'))
    return undefined;
  const kinds = new Set(
    triggers.map((trigger) =>
      trigger.kind === 'event' ? eventScopeKind(trigger) : undefined
    )
  );
  if (kinds.size !== 1) return undefined;
  return match([...kinds][0])
    .returnType<RunSubject | undefined>()
    .with('THREAD', () => 'email')
    .with('TASK', () => 'task')
    .with('DOCUMENT', () => 'document')
    .with('CHANNEL', () => 'message')
    .otherwise(() => undefined);
}
