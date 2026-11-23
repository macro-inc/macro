import { For, Show } from 'solid-js';
import type { StepDraft } from '../core/routine-steps';
import { stepHeadline } from '../core/step-headline';

/** A routine's steps, read-only: each step in a line. */
export function StepsOutline(props: { steps: StepDraft[] }) {
  return (
    <ol class="grid gap-2">
      <For each={props.steps}>
        {(step) => (
          <li class="grid min-w-0 gap-1">
            <span class="min-w-0 text-sm">
              <span class="font-medium text-ink">
                {stepHeadline(step).title}
              </span>
              <Show when={stepHeadline(step).summary}>
                {(summary) => (
                  <span class="text-ink-muted"> · {summary()}</span>
                )}
              </Show>
            </span>
          </li>
        )}
      </For>
    </ol>
  );
}
