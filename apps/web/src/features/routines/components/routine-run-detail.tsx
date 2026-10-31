import { formatDateAndTime } from '@entity';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import type { HistoryRecord, HistoryStep } from '../core/history';
import { failedStep, type RunOutcome, runOutcome } from '../core/step-history';

const OUTCOME_LABEL: Record<RunOutcome, string> = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
  nothing: 'Changed nothing',
};

/** What a run ended as, in words. */
export function outcomeLabel(outcome: RunOutcome): string {
  return OUTCOME_LABEL[outcome];
}

function seconds(ms: number): string {
  if (ms < 60_000) {
    const value = ms / 1000;
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} s`;
  }
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/** When the run started, how it ended, how long it took, and its AI calls. */
function runMeta(record: HistoryRecord): string {
  const parts: string[] = [];
  if (record.startedAt) parts.push(formatDateAndTime(record.startedAt));
  parts.push(outcomeLabel(runOutcome(record)));
  const took =
    record.startedAt && record.endedAt
      ? Date.parse(record.endedAt) - Date.parse(record.startedAt)
      : Number.NaN;
  if (Number.isFinite(took) && took >= 0) parts.push(`took ${seconds(took)}`);
  const steps = record.steps ?? [];
  // One classifier call answers every decision; each agent is its own call.
  const calls =
    (steps.some((step) => step.kind === 'if' || step.kind === 'choose')
      ? 1
      : 0) + steps.filter((step) => step.kind === 'agent').length;
  if (calls) parts.push(calls === 1 ? '1 AI call' : `${calls} AI calls`);
  return parts.join(' · ');
}

/** The step as it would read had it succeeded; its error shows apart. */
function withoutError(step: HistoryStep): HistoryStep {
  return step.kind === 'tool' || step.kind === 'agent'
    ? { ...step, error: undefined }
    : step;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** How sure AI was of what it decided, as labelled bars. */
function decisionBars(
  step: HistoryStep
): { label: string; value: number; chosen: boolean }[] {
  if (step.kind === 'if') {
    return [
      {
        label: step.answer ? 'Yes' : 'No',
        value: step.answer ? step.probability : 1 - step.probability,
        chosen: true,
      },
    ];
  }
  if (step.kind !== 'choose' || step.probability === undefined) return [];
  return step.choices?.length
    ? [
        {
          label: step.choices.join(', '),
          value: step.probability,
          chosen: true,
        },
      ]
    : [{ label: 'Best option', value: step.probability, chosen: false }];
}

function DecisionBar(props: { label: string; value: number; chosen: boolean }) {
  return (
    <span
      class={cn(
        'grid grid-cols-[7rem_minmax(0,1fr)_2.5rem] items-center gap-2.5 text-xs',
        props.chosen ? 'text-ink-muted' : 'text-ink-extra-muted'
      )}
    >
      <span class="truncate">{props.label}</span>
      <span class="h-1.5 min-w-10 overflow-hidden rounded-full bg-hover">
        <span
          class={cn(
            'block h-full rounded-full',
            props.chosen ? 'bg-accent' : 'bg-edge'
          )}
          style={{ width: percent(props.value) }}
        />
      </span>
      <span class="text-right tabular-nums">{percent(props.value)}</span>
    </span>
  );
}

/** One step of a run on the timeline: what AI decided, or what ran. */
function RunStep(props: {
  step: HistoryStep;
  describe: (step: HistoryStep) => string;
  last: boolean;
  onOpenConversation?: () => void;
}) {
  const error = () =>
    props.step.kind === 'tool' || props.step.kind === 'agent'
      ? props.step.error
      : undefined;
  const ai = () => props.step.kind !== 'tool';
  return (
    <li class="relative grid grid-cols-[1.375rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 pb-4">
      <Show when={!props.last}>
        <span
          aria-hidden="true"
          class="absolute bottom-0.5 left-[0.625rem] top-6 w-px bg-edge"
        />
      </Show>
      <span
        aria-hidden="true"
        class={cn(
          'flex size-[1.375rem] items-center justify-center rounded-full',
          error()
            ? 'bg-failure-bg text-failure'
            : ai()
              ? 'bg-accent-bg text-accent-ink'
              : 'bg-success-bg text-success'
        )}
      >
        <Switch fallback={<CheckIcon class="size-3" />}>
          <Match when={error()}>
            <XIcon class="size-3" />
          </Match>
          <Match when={ai()}>
            <SparkleIcon class="size-3" />
          </Match>
        </Switch>
      </span>
      <span class="min-w-0 pt-px text-sm font-medium text-ink">
        {props.describe(withoutError(props.step))}
      </span>
      <Show when={error()}>
        {(message) => (
          <span class="col-start-2 text-xs text-failure">{message()}</span>
        )}
      </Show>
      <Show when={decisionBars(props.step).length}>
        <span class="col-start-2 grid gap-1.5">
          <For each={decisionBars(props.step)}>
            {(bar) => <DecisionBar {...bar} />}
          </For>
        </span>
      </Show>
      <Show when={props.step.kind === 'agent' && props.onOpenConversation}>
        {(open) => (
          <Button
            variant="secondary"
            size="sm"
            class="col-start-2 w-fit"
            onClick={() => open()()}
          >
            Open conversation
            <ArrowUpRightIcon class="size-3.5" />
          </Button>
        )}
      </Show>
    </li>
  );
}

/** What one run of a routine with steps did, step by step. */
export function RunDetail(props: {
  record: HistoryRecord;
  title: string;
  describe: (step: HistoryStep) => string;
  /** Opens the run's agent session, when it has one. */
  onOpenConversation?: () => void;
}) {
  const steps = () => props.record.steps ?? [];
  // A run can fail outside its steps, e.g. while preparing its agent.
  const unexplained = () =>
    props.record.success === false && !failedStep(props.record)
      ? props.record.error
      : undefined;
  return (
    <section
      aria-label="Run details"
      class="flex min-w-0 flex-col gap-5 px-7 py-5 touch:px-4"
    >
      <header class="flex min-w-0 flex-wrap items-start gap-3">
        <div class="grid min-w-0 flex-1 basis-60 gap-1">
          <h2 class="text-lg font-semibold leading-6 text-ink">
            {props.title}
          </h2>
          <span class="text-xs text-ink-muted">{runMeta(props.record)}</span>
        </div>
        <Show
          when={
            !steps().some((step) => step.kind === 'agent') &&
            props.onOpenConversation
          }
        >
          {(open) => (
            <Button variant="secondary" size="sm" onClick={() => open()()}>
              Open conversation
              <ArrowUpRightIcon class="size-3.5" />
            </Button>
          )}
        </Show>
      </header>
      <ol aria-label="Steps" class="flex flex-col">
        <For each={steps()}>
          {(step, index) => (
            <RunStep
              step={step}
              describe={props.describe}
              last={index() === steps().length - 1}
              onOpenConversation={props.onOpenConversation}
            />
          )}
        </For>
      </ol>
      <Show when={unexplained()}>
        {(message) => (
          <p
            role="alert"
            class="flex gap-2.5 rounded-[10px] border border-failure/30 bg-failure-bg px-3 py-2.5 text-sm text-failure"
          >
            <XIcon class="mt-0.5 size-3.5 shrink-0" />
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}
