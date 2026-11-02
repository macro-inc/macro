import { Badge, Button, cn } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { CallStatus, HistoryCall } from '../core/history';
import {
  type Knob,
  knobsOutsideSentence,
  sentenceParts,
  withKnobValue,
} from '../core/knobs';
import { type CodeStepDraft, WRITE_SCOPE_LABELS } from '../core/routine-steps';
import { callCount } from '../core/step-history';
import { KnobSettings, StepSentence } from './routine-step-knobs';
import { Field, useSteps } from './routine-steps';

/** A short muted note under a step's settings. */
export function StepNote(props: { children: JSX.Element }) {
  return <p class="text-xs text-ink-muted">{props.children}</p>;
}

/**
 * A code step: what it does in its owner's words, with its knobs to change
 * in place, where it may make changes, and its code, folded away. AI writes
 * and changes the code; the owner changes the knobs.
 */
export function CodeStepBody(props: {
  step: CodeStepDraft;
  path: string;
  onChange(step: CodeStepDraft): void;
}) {
  const steps = useSteps();
  const [showCode, setShowCode] = createSignal(false);
  const calls = () => {
    const record = steps.run()?.get(props.path);
    return record?.kind === 'code' ? record : undefined;
  };
  const sentence = () => {
    const sentence = props.step.sentence;
    return sentence && sentenceParts(sentence, props.step.knobs)
      ? sentence
      : undefined;
  };
  const settings = () => knobsOutsideSentence(sentence(), props.step.knobs);
  const setKnob = (name: string, value: Knob['value']) =>
    props.onChange({
      ...props.step,
      knobs: withKnobValue(props.step.knobs, name, value),
    });
  return (
    <div class="grid min-w-0 gap-3">
      <Show
        when={sentence()}
        fallback={
          <Show when={props.step.summary.trim()}>
            {(summary) => <p class="text-sm text-ink-muted">{summary()}</p>}
          </Show>
        }
      >
        {(sentence) => (
          <StepSentence
            sentence={sentence()}
            knobs={props.step.knobs}
            onKnob={setKnob}
          />
        )}
      </Show>
      <Show when={settings().length ? settings() : undefined}>
        {(knobs) => (
          <Field label="Settings">
            <KnobSettings knobs={knobs()} onKnob={setKnob} />
          </Field>
        )}
      </Show>
      <Show
        when={props.step.problems?.length ? props.step.problems : undefined}
      >
        {(problems) => (
          <div
            role="alert"
            class="grid min-w-0 gap-1.5 rounded-xl border border-failure/30 bg-failure-bg px-3 py-2.5"
          >
            <span class="text-sm text-failure">
              This code doesn’t type-check against Macro’s SDK yet, so the
              routine can’t be saved with it. Draft it again or remove this
              step.
            </span>
            <For each={problems()}>
              {(problem) => (
                <pre class="min-w-0 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink-muted">
                  {problem}
                </pre>
              )}
            </For>
          </div>
        )}
      </Show>
      <Field label="Can change">
        <div class="flex min-w-0 flex-wrap gap-1">
          <For
            each={props.step.writes}
            fallback={
              <span class="text-xs text-ink-muted">Nothing; it only reads</span>
            }
          >
            {(scope) => (
              <Badge variant="secondary" size="xs">
                {WRITE_SCOPE_LABELS[scope]}
              </Badge>
            )}
          </For>
        </div>
      </Field>
      <div class="grid min-w-0 gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="w-fit"
          aria-expanded={showCode()}
          onClick={() => setShowCode(!showCode())}
        >
          {showCode() ? 'Hide code' : 'Show code'}
        </Button>
        <Show when={showCode()}>
          <pre class="max-h-80 min-w-0 overflow-auto rounded-xl border border-edge-frame bg-control px-3 py-2 font-mono text-xs leading-relaxed text-ink">
            <code>{props.step.source}</code>
          </pre>
          <StepNote>
            Written by AI and checked against Macro’s SDK when saved. Ask AI to
            change it; change the underlined values above yourself.
          </StepNote>
        </Show>
      </div>
      <Show when={calls()}>
        {(record) => (
          <Field
            label={`Last run: ${callCount(record().calls.length, record().callsTruncated)}`}
          >
            <CallList calls={record().calls} />
          </Field>
        )}
      </Show>
    </div>
  );
}

const STATUS_LABEL: Record<CallStatus, string> = {
  completed: 'Done',
  failed: 'Failed',
  skipped: 'Would do',
  refused: 'Not allowed',
  unknown: 'Unknown',
};

function duration(ms: number | undefined): string {
  if (ms === undefined) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** A code step's SDK calls in one run, in the order they started. */
export function CallList(props: { calls: HistoryCall[] }) {
  return (
    <ol class="grid min-w-0 gap-1 text-xs">
      <For each={props.calls}>
        {(call) => (
          <li class="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              class={cn(
                'size-1.5 shrink-0 rounded-full',
                match(call.status)
                  .with('completed', () =>
                    call.write ? 'bg-success' : 'bg-edge'
                  )
                  .with('failed', 'refused', () => 'bg-failure')
                  .with('skipped', 'unknown', () => 'bg-ink-extra-muted')
                  .exhaustive()
              )}
            />
            <span
              class={cn(
                'min-w-0 flex-1 truncate',
                call.write ? 'text-ink' : 'text-ink-muted'
              )}
              title={call.operation}
            >
              {call.label}
            </span>
            <Show when={call.status !== 'completed'}>
              <span
                class={cn(
                  'shrink-0',
                  call.status === 'failed' || call.status === 'refused'
                    ? 'text-failure'
                    : 'text-ink-muted'
                )}
              >
                {STATUS_LABEL[call.status]}
              </span>
            </Show>
            <span class="w-14 shrink-0 text-right tabular-nums text-ink-extra-muted">
              {duration(call.durationMs)}
            </span>
          </li>
        )}
      </For>
    </ol>
  );
}
