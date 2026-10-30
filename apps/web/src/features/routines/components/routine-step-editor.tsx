import { createSignal, Show } from 'solid-js';
import { triggerScope, triggerSubject } from '../core/step-catalog';
import {
  type RoutineStepsProps,
  RunBanner,
  StepList,
  StepsProvider,
} from './routine-steps';

/** A routine's steps as a list of collapsible cards; branches indent. */
export function RoutineSteps(props: RoutineStepsProps) {
  const [showRun, setShowRun] = createSignal(true);
  const scope = () => triggerScope(triggerSubject(props.triggers));
  return (
    <StepsProvider {...props} showRun={showRun()}>
      <div class="grid min-w-0 gap-2">
        <Show when={props.lastRun}>
          {(lastRun) => (
            <RunBanner
              run={lastRun()}
              shown={showRun()}
              onToggle={() => setShowRun(!showRun())}
            />
          )}
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
