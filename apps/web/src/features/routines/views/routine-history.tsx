import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CircleDashedIcon from '@icon/system/regular/circle-dashed.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import MinusIcon from '@icon/system/regular/minus.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { outcomeLabel, RunDetail } from '../components/routine-run-detail';
import type {
  HistoryRecord,
  HistoryResource,
  HistorySkip,
  HistoryStep,
} from '../core/history';
import {
  describeSkip,
  failedStep,
  type RunOutcome,
  runDays,
  runOutcome,
} from '../core/step-history';

export type { HistoryRecord } from '../core/history';

import type { HistoryMetadata } from '../context/history';

export type { HistoryMetadata } from '../context/history';

type RoutineHistoryProps = {
  records: readonly HistoryRecord[];
  isPending: boolean;
  createChatMetadata: (id: string) => Accessor<HistoryMetadata>;
  createAgentMetadata: (id: string) => Accessor<HistoryMetadata>;
  onOpen: (resource: HistoryResource, newSplit: boolean) => void;
  /** Describes what a run did at a step, for routines with steps. */
  describeStep?: (step: HistoryStep, record: HistoryRecord) => string;
};

function OutcomeIcon(props: { outcome: RunOutcome }) {
  return (
    <span class="mt-0.5 flex size-4 items-center justify-center">
      <Switch>
        <Match when={props.outcome === 'succeeded'}>
          <CheckIcon class="size-4 text-success" />
        </Match>
        <Match when={props.outcome === 'failed'}>
          <XIcon class="size-4 text-failure" />
        </Match>
        <Match when={props.outcome === 'skipped'}>
          <CircleDashedIcon class="size-3.5 text-ink-muted" />
        </Match>
        <Match when={props.outcome === 'nothing'}>
          <MinusIcon class="size-3.5 text-ink-muted" />
        </Match>
        <Match when={props.outcome === 'running'}>
          <ClockIcon class="size-3.5 text-ink-muted" />
        </Match>
      </Switch>
      <span class="sr-only">{outcomeLabel(props.outcome)}</span>
    </span>
  );
}

function runTime(record: HistoryRecord): string | undefined {
  if (!record.startedAt) return undefined;
  const date = new Date(record.startedAt);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      });
}

type RunRowProps = {
  record: HistoryRecord;
  title: string;
  /** Rows that report a non-event (a skip) read lighter. */
  quiet?: boolean;
  summary?: string;
  failure?: boolean;
  selected?: boolean;
  /** Selected only until someone chooses, so narrow screens don't mark it. */
  selectedByDefault?: boolean;
  /** What the row does when chosen; absent rows are plain text. */
  onActivate?: (newSplit: boolean) => void;
  trailing?: JSX.Element;
  expanded?: boolean;
};

/** One run in the list: how it ended, what it was, when, and what it did. */
function RunRow(props: RunRowProps) {
  const content = () => (
    <>
      <OutcomeIcon outcome={runOutcome(props.record)} />
      <span
        class={cn(
          'min-w-0 truncate text-sm',
          props.quiet ? 'text-ink-muted' : 'font-medium text-ink'
        )}
      >
        {props.title}
      </span>
      <Show
        when={props.trailing}
        fallback={
          <time class="whitespace-nowrap text-xs tabular-nums text-ink-muted">
            {runTime(props.record) ?? ''}
          </time>
        }
      >
        {props.trailing}
      </Show>
      <Show when={props.summary}>
        <span
          class={cn(
            'col-span-2 col-start-2 min-w-0 truncate text-xs',
            props.failure ? 'text-failure' : 'text-ink-muted'
          )}
        >
          {props.summary}
        </span>
      </Show>
    </>
  );
  const layout =
    'grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 rounded-[10px] px-2.5 py-2 text-left';
  return (
    <div role="listitem" aria-label={props.title}>
      <Show
        when={props.onActivate}
        fallback={<div class={layout}>{content()}</div>}
      >
        {(activate) => (
          <button
            type="button"
            aria-current={props.selected ? 'true' : undefined}
            aria-expanded={props.expanded}
            class={cn(
              layout,
              'outline-none focus-visible:bg-list-highlighted not-touch:hover:bg-list-hover',
              props.selected && 'bg-list-highlighted',
              props.selectedByDefault && '@max-[720px]/runs:bg-transparent'
            )}
            onClick={(event) => activate()(event.shiftKey)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              activate()(event.shiftKey);
            }}
          >
            {content()}
          </button>
        )}
      </Show>
    </div>
  );
}

/** The step as it would read had it succeeded; its error shows apart. */
function withoutError(step: HistoryStep): HistoryStep {
  return step.kind === 'tool' || step.kind === 'agent'
    ? { ...step, error: undefined }
    : step;
}

/** Whether a run has steps worth showing beyond its agent's transcript. */
function hasStepDetail(record: HistoryRecord): boolean {
  return Boolean(
    record.id &&
      !record.skipped &&
      (record.steps?.some((step) => step.kind !== 'agent' || step.error) ||
        // A run that failed before any step or session opens its reason.
        (record.success === false && record.error && !record.resource))
  );
}

/**
 * A run with steps in two lines: what it did first, then the rest, or the
 * step that failed. Runs record no name for the item that triggered them.
 */
function stepLines(
  record: HistoryRecord,
  describe: (step: HistoryStep) => string
): { title: string; summary?: string; failure: boolean } {
  const steps = record.steps ?? [];
  const [first, ...rest] = steps.map((step) => describe(withoutError(step)));
  const failed = failedStep(record);
  const failure = failed
    ? describe(failed)
    : record.success === false
      ? record.error
      : undefined;
  return {
    title: first ?? (record.success === false ? 'Run failed' : 'Ran steps'),
    summary: failure ?? (rest.join(' · ') || undefined),
    failure: Boolean(failure),
  };
}

function SkippedRow(props: { record: HistoryRecord; skip: HistorySkip }) {
  return (
    <RunRow
      record={props.record}
      title={describeSkip(props.skip)}
      quiet
      summary={
        props.skip.reason === 'not_met'
          ? `${Math.round(props.skip.probability * 100)}% likely yes`
          : (props.record.error ?? undefined)
      }
      failure={props.skip.reason === 'unavailable'}
    />
  );
}

/** A run that only ran its agent: its row opens the conversation. */
function SessionRow(props: {
  record: HistoryRecord;
  resource: HistoryResource;
  createMetadata: (id: string) => Accessor<HistoryMetadata>;
  onOpen: RoutineHistoryProps['onOpen'];
}) {
  const metadata = props.createMetadata(props.resource.id);
  const title = () => {
    const current = metadata();
    return current.status === 'ready'
      ? current.entity.name.trim() || 'Untitled run'
      : current.status === 'pending'
        ? 'Loading…'
        : 'Run unavailable';
  };
  const ready = () => metadata().status === 'ready';
  return (
    <RunRow
      record={props.record}
      title={title()}
      summary={
        props.record.success === false
          ? (props.record.error ?? undefined)
          : 'Asked AI'
      }
      failure={props.record.success === false}
      onActivate={
        ready()
          ? (newSplit) => props.onOpen(props.resource, newSplit)
          : undefined
      }
    />
  );
}

function RunEntry(props: {
  record: HistoryRecord;
  history: RoutineHistoryProps;
  selected: boolean;
  selectedByDefault: boolean;
  onSelect: () => void;
}) {
  const describe = (step: HistoryStep) =>
    props.history.describeStep?.(step, props.record) ?? step.kind;
  const lines = () => stepLines(props.record, describe);
  return (
    <Show
      when={!hasStepDetail(props.record) && props.record.resource}
      keyed
      fallback={
        <Show
          when={props.record.steps?.length || hasStepDetail(props.record)}
          fallback={
            <RunRow
              record={props.record}
              title={
                props.record.success === false && props.record.error
                  ? 'Run failed'
                  : 'Run unavailable'
              }
              summary={
                props.record.success === false
                  ? (props.record.error ?? undefined)
                  : undefined
              }
              failure
            />
          }
        >
          <RunRow
            record={props.record}
            title={lines().title}
            summary={lines().summary}
            failure={lines().failure}
            selected={props.selected}
            selectedByDefault={props.selected && props.selectedByDefault}
            onActivate={
              hasStepDetail(props.record) ? () => props.onSelect() : undefined
            }
          />
        </Show>
      }
    >
      {(resource) => (
        <Suspense fallback={<RunRow record={props.record} title="Loading…" />}>
          <SessionRow
            record={props.record}
            resource={resource}
            createMetadata={
              resource.type === 'chat'
                ? props.history.createChatMetadata
                : props.history.createAgentMetadata
            }
            onOpen={props.history.onOpen}
          />
        </Suspense>
      )}
    </Show>
  );
}

/** Where a skipped record sits in its run of consecutive skips. */
type SkipRun = { first: HistoryRecord; length: number };

function skipRuns(records: readonly HistoryRecord[]) {
  const runs = new Map<HistoryRecord, SkipRun>();
  let run: SkipRun | undefined;
  for (const record of records) {
    if (!record.skipped) {
      run = undefined;
      continue;
    }
    if (!run) run = { first: record, length: 0 };
    run.length += 1;
    runs.set(record, run);
  }
  return runs;
}

/** A skipped run, or the row its run of consecutive skips collapses into. */
function SkippedEntry(props: {
  record: HistoryRecord;
  skip: HistorySkip;
  run: SkipRun | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const grouped = () => (props.run?.length ?? 1) > 1;
  return (
    <>
      <Show when={grouped() && props.run?.first === props.record}>
        <RunRow
          record={props.record}
          title={`${props.run?.length ?? 0} skipped by the condition`}
          quiet
          expanded={props.open}
          trailing={
            <span class="text-xs text-accent-ink">
              {props.open ? 'Hide' : 'Show'}
            </span>
          }
          onActivate={() => props.onToggle()}
        />
      </Show>
      <Show when={!grouped() || props.open}>
        <SkippedRow record={props.record} skip={props.skip} />
      </Show>
    </>
  );
}

/**
 * Every run of a routine, by day, beside what the selected one did. Runs that
 * only ran an agent open its conversation instead.
 */
export function RoutineHistory(props: RoutineHistoryProps): JSX.Element {
  const [visibleCount, setVisibleCount] = createSignal(50);
  const visibleRecords = createMemo(() =>
    props.records.slice(0, visibleCount())
  );
  // The run someone chose. Until then the newest run with steps shows beside
  // the list, except on narrow screens, which show the list alone.
  const [chosenId, setChosenId] = createSignal<string>();
  const chosen = () =>
    props.records.find(
      (record) => record.id && record.id === chosenId() && hasStepDetail(record)
    );
  const selected = () => chosen() ?? visibleRecords().find(hasStepDetail);
  const days = createMemo(() => runDays(visibleRecords()));
  const runs = createMemo(() => skipRuns(visibleRecords()));
  // Keyed by the run's newest record id, which survives history refetches.
  const [expanded, setExpanded] = createSignal(new Set<string>());
  const toggle = (first: HistoryRecord | undefined) => {
    const id = first?.id;
    if (!id) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const isOpen = (run: SkipRun | undefined) => {
    const id = run?.first.id;
    return !!id && expanded().has(id);
  };
  return (
    <div class="@container/runs flex min-h-0 flex-1">
      <div
        class={cn(
          'min-h-0 min-w-0 overflow-y-auto px-2 py-2.5',
          selected()
            ? 'w-[26rem] shrink-0 border-r border-edge-muted @max-[720px]/runs:w-full @max-[720px]/runs:border-r-0'
            : 'flex-1',
          chosen() && '@max-[720px]/runs:hidden'
        )}
      >
        <Show
          when={props.records.length > 0}
          fallback={
            <div
              role="status"
              class="px-4 py-16 text-center text-sm text-ink-muted"
            >
              {props.isPending ? 'Loading…' : 'No runs yet.'}
            </div>
          }
        >
          <div
            role="list"
            aria-label="Routine runs"
            class={cn(!selected() && 'mx-auto w-full max-w-3xl')}
          >
            {/* Keyed by date, so a new page or run keeps the rows it has. */}
            <For each={days().map((day) => day.key)}>
              {(key) => {
                const day = () => days().find((each) => each.key === key);
                return (
                  <>
                    <div
                      role="presentation"
                      class="px-2.5 pb-1 pt-3 text-xs font-medium text-ink-muted first:pt-1"
                    >
                      {day()?.label}
                    </div>
                    <For each={day()?.records ?? []}>
                      {(record) => (
                        <Show
                          when={record.skipped}
                          fallback={
                            <RunEntry
                              record={record}
                              history={props}
                              selected={
                                Boolean(record.id) &&
                                selected()?.id === record.id
                              }
                              selectedByDefault={!chosen()}
                              onSelect={() =>
                                setChosenId(record.id ?? undefined)
                              }
                            />
                          }
                        >
                          {(skip) => (
                            <SkippedEntry
                              record={record}
                              skip={skip()}
                              run={runs().get(record)}
                              open={isOpen(runs().get(record))}
                              onToggle={() => toggle(runs().get(record)?.first)}
                            />
                          )}
                        </Show>
                      )}
                    </For>
                  </>
                );
              }}
            </For>
          </div>
          <Show when={props.records.length > visibleCount()}>
            <Button
              variant="ghost"
              size="sm"
              class={cn('m-1.5', !selected() && 'mx-auto flex')}
              onClick={() => setVisibleCount((count) => count + 50)}
            >
              Load more runs
            </Button>
          </Show>
        </Show>
      </div>
      <Show when={selected()}>
        {(record) => {
          const describe = (step: HistoryStep) =>
            props.describeStep?.(step, record()) ?? step.kind;
          const resource = () => record().resource;
          return (
            <div
              class={cn(
                'min-h-0 min-w-0 flex-1 overflow-y-auto',
                !chosen() && '@max-[720px]/runs:hidden'
              )}
            >
              <Button
                variant="ghost"
                size="sm"
                class="mx-3 mt-3 hidden @max-[720px]/runs:inline-flex"
                onClick={() => setChosenId(undefined)}
              >
                <CaretLeftIcon class="size-4" />
                Runs
              </Button>
              <RunDetail
                record={record()}
                title={stepLines(record(), describe).title}
                describe={describe}
                onOpenConversation={
                  resource()
                    ? () => {
                        const target = resource();
                        if (target) props.onOpen(target, false);
                      }
                    : undefined
                }
              />
            </div>
          );
        }}
      </Show>
    </div>
  );
}
