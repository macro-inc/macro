import { Show } from 'solid-js';
import type { StepDraft } from '../core/routine-steps';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import { aiCallsPerRun, runSubject } from '../core/step-headline';
import {
  type RoutineStepsProps,
  StepList,
  StepsProvider,
} from './routine-steps';

/**
 * What a run costs, for the Steps heading: the routine page puts it on its
 * line, as other pages put a section's controls.
 */
export function RoutineStepsSummary(props: {
  steps: StepDraft[];
  triggers: RoutineTriggerDraft[];
}) {
  const subject = () => runSubject(props.triggers);
  // A trigger's AI check is a call of its own, before the steps run.
  const calls = () =>
    aiCallsPerRun(props.steps) +
    (props.triggers.some(
      (trigger) => trigger.kind === 'event' && trigger.condition?.trim()
    )
      ? 1
      : 0);
  const cost = () =>
    calls()
      ? `${calls()} AI ${calls() === 1 ? 'call' : 'calls'} per ${subject() ?? 'run'}`
      : undefined;
  return (
    <Show when={cost()}>
      {(text) => <span class="text-xs text-ink-muted">{text()}</span>}
    </Show>
  );
}

/**
 * A routine's steps as numbered cards. The page puts `RoutineStepsSummary`
 * on the Steps heading.
 */
export function RoutineSteps(props: RoutineStepsProps) {
  return (
    <StepsProvider {...props}>
      <StepList steps={props.steps} onChange={props.onChange} />
    </StepsProvider>
  );
}
