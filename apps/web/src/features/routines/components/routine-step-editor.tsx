import { makePersisted } from '@solid-primitives/storage';
import { cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { triggerScope, triggerSubject } from '../core/step-catalog';
import { RoutineFlow } from './routine-flow';
import {
  type RoutineStepsProps,
  RunBanner,
  StepList,
  StepsProvider,
} from './routine-steps';

type StepsView = 'list' | 'flow';

const views: { value: StepsView; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'flow', label: 'Flow' },
];

/**
 * A routine's steps, as a list of collapsible cards or as a flow where each
 * decision fans out into its answers. The view is remembered per viewer.
 */
export function RoutineSteps(props: RoutineStepsProps) {
  const [showRun, setShowRun] = createSignal(true);
  const [view, setView] = makePersisted(createSignal<StepsView>('list'), {
    name: 'macro:routine-steps-view',
  });
  const scope = () => triggerScope(triggerSubject(props.triggers));
  return (
    <StepsProvider {...props} showRun={showRun()}>
      <div class="grid min-w-0 gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <div class="min-w-0 flex-1">
            <Show when={props.lastRun}>
              {(lastRun) => (
                <RunBanner
                  run={lastRun()}
                  shown={showRun()}
                  onToggle={() => setShowRun(!showRun())}
                />
              )}
            </Show>
          </div>
          <div
            role="radiogroup"
            aria-label="Show steps as"
            class="flex shrink-0 rounded-lg border border-edge-muted p-0.5"
          >
            <For each={views}>
              {(option) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={view() === option.value}
                  class={cn(
                    'h-6 rounded-md px-2 text-xs',
                    view() === option.value
                      ? 'bg-hover font-medium text-ink'
                      : 'text-ink-muted'
                  )}
                  onClick={() => setView(option.value)}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </div>
        <Show
          when={view() === 'flow'}
          fallback={
            <StepList
              steps={props.steps}
              onChange={props.onChange}
              scope={scope()}
            />
          }
        >
          <RoutineFlow
            steps={props.steps}
            onChange={props.onChange}
            scope={scope()}
          />
        </Show>
      </div>
    </StepsProvider>
  );
}
