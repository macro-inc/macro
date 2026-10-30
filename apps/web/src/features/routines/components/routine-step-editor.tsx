import { ToggleSwitch } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { StepDraft } from '../core/routine-steps';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import { triggerScope, triggerSubject } from '../core/step-catalog';
import { aiCallsPerRun, subjectNoun } from '../core/step-headline';
import {
  type RoutineRunView,
  type RoutineStepsProps,
  StepList,
  StepsProvider,
} from './routine-steps';

function formatRunTime(at: string | null | undefined): string {
  if (!at) return '';
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

/**
 * "Show last run" and what a run costs, for the Then heading: the routine
 * page puts them on its line, as other pages put a section's controls.
 */
export function RoutineStepsSummary(props: {
  steps: StepDraft[];
  triggers: RoutineTriggerDraft[];
  lastRun?: RoutineRunView;
  showRun: boolean;
  onShowRun(show: boolean): void;
}) {
  const subject = () => triggerSubject(props.triggers);
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
      ? `${calls()} AI ${calls() === 1 ? 'call' : 'calls'} per ${subjectNoun(subject())}`
      : undefined;
  return (
    <span class="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-ink-muted empty:hidden">
      <Show when={props.lastRun}>
        {(run) => (
          <span
            title={`Last run ${formatRunTime(run().endedAt)}`}
            class="flex items-center"
          >
            <ToggleSwitch
              size="xs"
              checked={props.showRun}
              onChange={props.onShowRun}
              label="Show last run"
              labelClass="text-xs text-ink-muted"
            />
          </span>
        )}
      </Show>
      <Show when={cost()}>
        {(text) => (
          <span>
            <Show when={props.lastRun}>· </Show>
            {text()}
          </span>
        )}
      </Show>
    </span>
  );
}

/**
 * A routine's steps as numbered cards, branches indented under their
 * decision. Without a host that shows `RoutineStepsSummary` (`showRun`
 * given), the summary sits above them.
 */
export function RoutineSteps(props: RoutineStepsProps & { showRun?: boolean }) {
  const [showRun, setShowRun] = createSignal(true);
  const scope = () => triggerScope(triggerSubject(props.triggers));
  return (
    <StepsProvider {...props} showRun={props.showRun ?? showRun()}>
      <div class="grid min-w-0 gap-2">
        <Show when={props.showRun === undefined}>
          <RoutineStepsSummary
            steps={props.steps}
            triggers={props.triggers}
            lastRun={props.lastRun}
            showRun={showRun()}
            onShowRun={setShowRun}
          />
        </Show>
        <StepList
          steps={props.steps}
          onChange={props.onChange}
          scope={scope()}
        />
      </div>
    </StepsProvider>
  );
}
