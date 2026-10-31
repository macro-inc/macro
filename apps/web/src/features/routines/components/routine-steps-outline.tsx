import { For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { StepDraft } from '../core/routine-steps';
import { stepTitle, summarizeStep } from '../core/step-catalog';

function Branch(props: { label: string; steps: StepDraft[] }) {
  return (
    <li class="grid gap-1">
      <span class="text-xs text-ink-muted">{props.label}</span>
      <StepsOutline steps={props.steps} />
    </li>
  );
}

function branches(step: StepDraft): JSX.Element {
  return match(step)
    .with({ kind: 'agent' }, { kind: 'tool' }, () => null)
    .with({ kind: 'if' }, (step) => (
      <>
        <Branch label="Yes" steps={step.yes} />
        <Show when={step.no.length}>
          <Branch label="No" steps={step.no} />
        </Show>
      </>
    ))
    .with({ kind: 'choose' }, (step) => (
      <>
        <For each={step.options}>
          {(option) => <Branch label={option.label} steps={option.steps} />}
        </For>
        <Show when={step.otherwise.length}>
          <Branch label="Nothing fits" steps={step.otherwise} />
        </Show>
      </>
    ))
    .exhaustive();
}

/** A routine's steps, read-only: each step in a line, branches indented. */
export function StepsOutline(props: { steps: StepDraft[] }) {
  return (
    <ol class="grid gap-2">
      <For each={props.steps}>
        {(step) => (
          <li class="grid min-w-0 gap-1">
            <span class="min-w-0 text-sm">
              <span class="font-medium text-ink">{stepTitle(step)}</span>
              <Show when={summarizeStep(step)}>
                {(summary) => (
                  <span class="text-ink-muted"> · {summary()}</span>
                )}
              </Show>
            </span>
            <Show when={step.kind === 'if' || step.kind === 'choose'}>
              <ul class="grid gap-1.5 border-l border-edge-muted pl-3">
                {branches(step)}
              </ul>
            </Show>
          </li>
        )}
      </For>
    </ol>
  );
}
