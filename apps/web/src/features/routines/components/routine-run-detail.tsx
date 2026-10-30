import { formatDateAndTime } from '@entity';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import type { HistoryRecord, HistoryStep } from '../core/history';

function percent(probability: number | undefined) {
  return probability === undefined
    ? undefined
    : `${Math.round(probability * 100)}%`;
}

function stepProbability(step: HistoryStep) {
  return step.kind === 'if' || step.kind === 'choose'
    ? step.probability
    : undefined;
}

function stepError(step: HistoryStep) {
  return step.kind === 'tool' || step.kind === 'agent' ? step.error : undefined;
}

/** One step of a run: what AI decided, with how sure it was, or what ran. */
function RunStep(props: { step: HistoryStep; label: string }) {
  const decided = () =>
    props.step.kind === 'if' || props.step.kind === 'choose';
  return (
    <li class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-1">
      <span
        aria-hidden="true"
        class={cn(
          'mt-0.5 flex size-5 items-center justify-center rounded-full',
          stepError(props.step)
            ? 'bg-failure-bg text-failure'
            : decided()
              ? 'bg-accent-bg text-accent-ink'
              : 'bg-success-bg text-success'
        )}
      >
        <Switch fallback={<CheckIcon class="size-3" />}>
          <Match when={stepError(props.step)}>
            <XIcon class="size-3" />
          </Match>
          <Match when={decided()}>
            <SparkleIcon class="size-3" />
          </Match>
        </Switch>
      </span>
      <span class="min-w-0 text-sm text-ink">{props.label}</span>
      <Show when={stepProbability(props.step)}>
        {(probability) => (
          <span class="col-start-2 flex items-center gap-2 text-xs text-ink-muted">
            <span class="h-1.5 w-32 overflow-hidden rounded-full bg-hover">
              <span
                class="block h-full rounded-full bg-accent"
                style={{ width: percent(probability()) }}
              />
            </span>
            <span class="tabular-nums">{percent(probability())}</span>
          </span>
        )}
      </Show>
    </li>
  );
}

/** What one run of a routine with steps did, step by step. */
export function RunDetail(props: {
  record: HistoryRecord;
  describe: (step: HistoryStep) => string;
  /** Opens the run's agent session, when it has one. */
  onOpenConversation?: () => void;
  onClose(): void;
}) {
  const failedStep = () => props.record.steps?.some(stepError);
  return (
    <section aria-label="Run details" class="grid min-w-0 gap-4 p-4">
      <div class="flex min-w-0 items-start gap-2">
        <div class="grid min-w-0 flex-1 gap-0.5">
          <h2 class="text-sm font-semibold text-ink">
            {props.record.success === false ? 'Failed run' : 'Run'}
          </h2>
          <Show when={props.record.startedAt}>
            {(at) => (
              <span class="text-xs text-ink-muted">
                {formatDateAndTime(at())}
              </span>
            )}
          </Show>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => props.onClose()}
          aria-label="Close run details"
        >
          <XIcon class="size-4" />
        </Button>
      </div>
      <ol class="grid gap-3">
        <For each={props.record.steps ?? []}>
          {(step) => <RunStep step={step} label={props.describe(step)} />}
        </For>
      </ol>
      <Show
        when={
          props.record.success === false && props.record.error && !failedStep()
        }
      >
        <p role="alert" class="text-sm text-failure">
          {props.record.error}
        </p>
      </Show>
      <Show when={props.onOpenConversation}>
        {(open) => (
          <Button
            variant="secondary"
            size="sm"
            class="w-fit"
            onClick={() => open()()}
          >
            Open conversation
            <ArrowUpRightIcon class="size-3.5" />
          </Button>
        )}
      </Show>
    </section>
  );
}
