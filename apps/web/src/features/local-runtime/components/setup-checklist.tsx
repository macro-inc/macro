import CheckIcon from '@icon/system/regular/check.svg';
import CircleIcon from '@icon/system/regular/circle.svg';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import WarningIcon from '@icon/system/regular/warning-circle.svg';
import { cn } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import type { StepStatus } from '../core/setup';

export type ChecklistStep = {
  id: string;
  label: string;
  /** What the step is doing now, or what it found. */
  detail?: string;
  status: StepStatus;
};

/** Setup progress as an ordered list of steps. */
export function SetupChecklist(props: { steps: ChecklistStep[] }) {
  return (
    <ol class="flex flex-col gap-3" aria-live="polite">
      <For each={props.steps}>
        {(step) => (
          <li
            class="flex items-start gap-3"
            aria-current={step.status === 'active' ? 'step' : undefined}
          >
            <span
              aria-hidden="true"
              class={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5',
                step.status === 'done' && 'bg-success-bg text-success',
                step.status === 'failed' && 'text-failure [&_svg]:size-5',
                step.status === 'active' && 'text-ink [&_svg]:size-4',
                step.status === 'pending' && 'text-ink-extra-muted'
              )}
            >
              <Switch>
                <Match when={step.status === 'done'}>
                  <CheckIcon />
                </Match>
                <Match when={step.status === 'failed'}>
                  <WarningIcon />
                </Match>
                <Match when={step.status === 'active'}>
                  <SpinnerIcon class="animate-spin" />
                </Match>
                <Match when={step.status === 'pending'}>
                  <CircleIcon />
                </Match>
              </Switch>
            </span>
            <div class="min-w-0">
              <p
                class={cn(
                  'text-sm/5',
                  step.status === 'pending' ? 'text-ink-muted' : 'text-ink'
                )}
              >
                {step.label}
              </p>
              <Show when={step.detail}>
                {(detail) => (
                  <p
                    class={cn(
                      'text-xs',
                      step.status === 'failed'
                        ? 'text-failure'
                        : 'text-ink-muted'
                    )}
                  >
                    {detail()}
                  </p>
                )}
              </Show>
            </div>
          </li>
        )}
      </For>
    </ol>
  );
}
