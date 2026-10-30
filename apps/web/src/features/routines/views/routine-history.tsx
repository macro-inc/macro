import { EntityIcon } from '@core/component/EntityIcon';
import { formatDateAndTime, ListEntity, ListLayoutProvider } from '@entity';
import { Button, cn } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';

import { RunDetail } from '../components/routine-run-detail';
import type {
  HistoryRecord,
  HistoryResource,
  HistorySkip,
  HistoryStep,
} from '../core/history';

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
  describeStep?: (step: HistoryStep) => string;
};

type HistoryRowProps = {
  record: HistoryRecord;
  resource?: HistoryResource;
  metadata: HistoryMetadata;
  onOpen?: (resource: HistoryResource, newSplit: boolean) => void;
  /** Shows what a run without a session did, step by step. */
  onSelect?: () => void;
};

function RunOutcome(props: { record: HistoryRecord }) {
  const outcome = () =>
    !props.record.id
      ? 'Running'
      : props.record.skipped
        ? 'Skipped'
        : props.record.success
          ? 'Succeeded'
          : 'Failed';
  const duration = () => {
    if (!props.record.startedAt || !props.record.endedAt) return undefined;
    const seconds = Math.max(
      0,
      Math.round(
        (Date.parse(props.record.endedAt) -
          Date.parse(props.record.startedAt)) /
          1000
      )
    );
    if (!Number.isFinite(seconds)) return undefined;
    return seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };
  return (
    <span class="inline-flex items-center gap-3 whitespace-nowrap text-xs text-ink-muted">
      <span
        class={cn(
          (outcome() === 'Failed' ||
            props.record.skipped?.reason === 'unavailable') &&
            'text-failure'
        )}
      >
        {outcome()}
      </span>
      <Show when={duration()}>
        {(value) => (
          <span class="tabular-nums text-ink-extra-muted">{value()}</span>
        )}
      </Show>
    </span>
  );
}

function HistoryRow(props: HistoryRowProps): JSX.Element {
  const entity = () => {
    const metadata = props.metadata;
    return metadata.status === 'ready'
      ? {
          ...metadata.entity,
          name: metadata.entity.name.trim() || 'Untitled run',
          sortTs: props.record.startedAt ?? metadata.entity.sortTs,
        }
      : undefined;
  };
  const open = (newSplit: boolean) => {
    if (props.resource && entity()) props.onOpen?.(props.resource, newSplit);
  };
  return (
    <Show
      when={entity()}
      fallback={
        <div
          role="listitem"
          tabIndex={props.onSelect ? 0 : undefined}
          class={cn(
            'soup-list-entity mx-1 flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-ink-muted outline-none',
            props.onSelect &&
              'hover:bg-list-hover focus-visible:bg-list-highlighted'
          )}
          onClick={() => props.onSelect?.()}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !props.onSelect) return;
            event.preventDefault();
            props.onSelect();
          }}
        >
          <span class="size-4 shrink-0">
            <EntityIcon
              targetType={props.resource?.type ?? 'routine'}
              size="xs"
            />
          </span>
          <span class="min-w-0 flex-1 truncate">
            {props.metadata.status === 'pending'
              ? 'Loading…'
              : props.record.steps
                ? 'Ran steps'
                : 'Run unavailable'}
          </span>
          <RunOutcome record={props.record} />
          <span class="ml-2 text-xs text-ink-extra-muted">
            {props.record.startedAt
              ? formatDateAndTime(props.record.startedAt)
              : '—'}
          </span>
        </div>
      }
    >
      {(entity) => (
        <div
          role="listitem"
          tabIndex={0}
          aria-label={entity().name}
          class="outline-none focus-visible:bg-list-highlighted"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            open(event.shiftKey);
          }}
        >
          <ListEntity
            entity={entity()}
            hideCheckbox
            deferInteractions
            leadingAction={<RunOutcome record={props.record} />}
            onClick={(event) => open(event.shiftKey)}
          />
        </div>
      )}
    </Show>
  );
}

function ResourceHistoryRow(props: {
  record: HistoryRecord;
  resource: HistoryResource;
  createMetadata: (id: string) => Accessor<HistoryMetadata>;
  onOpen: RoutineHistoryProps['onOpen'];
}): JSX.Element {
  const metadata = props.createMetadata(props.resource.id);
  return (
    <HistoryRow
      record={props.record}
      resource={props.resource}
      metadata={metadata()}
      onOpen={props.onOpen}
    />
  );
}

function skipLabel(skip: HistorySkip) {
  return skip.reason === 'not_met'
    ? 'Condition not met'
    : 'Condition couldn’t be checked';
}

function SkippedRow(props: { record: HistoryRecord; skip: HistorySkip }) {
  const confidence = () =>
    props.skip.reason === 'not_met'
      ? `${Math.round(props.skip.probability * 100)}% likely yes`
      : undefined;
  return (
    <div
      role="listitem"
      title={confidence()}
      class="soup-list-entity mx-1 flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-ink-muted"
    >
      <span class="size-4 shrink-0">
        <EntityIcon targetType="routine" size="xs" />
      </span>
      <span class="min-w-0 flex-1 truncate">{skipLabel(props.skip)}</span>
      <RunOutcome record={props.record} />
      <span class="ml-2 text-xs text-ink-extra-muted">
        {props.record.startedAt
          ? formatDateAndTime(props.record.startedAt)
          : '—'}
      </span>
    </div>
  );
}

/** Consecutive skips collapse so a busy trigger doesn't bury real runs. */
function SkippedGroupToggle(props: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div role="listitem" class="mx-1">
      <button
        type="button"
        aria-expanded={props.open}
        class="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm text-ink-muted hover:bg-hover focus-visible:bg-hover outline-none"
        onClick={() => props.onToggle()}
      >
        <span class="size-4 shrink-0">
          <EntityIcon targetType="routine" size="xs" />
        </span>
        <span class="min-w-0 flex-1 truncate">
          {props.count} events skipped by the condition
        </span>
        <span class="text-xs text-ink-extra-muted">
          {props.open ? 'Hide' : 'Show'}
        </span>
      </button>
    </div>
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

/** What each step of a run did, under its row. */
function StepsSummary(props: {
  record: HistoryRecord;
  describe: (step: HistoryStep) => string;
  onSelect: () => void;
}) {
  const failed = (step: HistoryStep) =>
    (step.kind === 'tool' || step.kind === 'agent') && Boolean(step.error);
  // A run that only ran its agent says nothing its session doesn't.
  const informative = () =>
    props.record.steps?.some((step) => step.kind !== 'agent' || step.error) ||
    // Without a transcript to open, the error is the only explanation.
    Boolean(
      !props.record.success && props.record.error && !props.record.resource
    );
  return (
    <Show when={informative()}>
      <button
        type="button"
        aria-label="Show run details"
        class="mx-1 -mt-1 mb-1 flex min-w-0 flex-wrap gap-x-1.5 rounded-lg pl-9 pr-2 text-left text-xs text-ink-muted outline-none hover:text-ink focus-visible:underline"
        onClick={() => props.onSelect()}
      >
        <For each={props.record.steps ?? []}>
          {(step, index) => (
            <span class={cn('min-w-0', failed(step) && 'text-failure')}>
              {index() > 0 ? '→ ' : ''}
              {props.describe(step)}
            </span>
          )}
        </For>
        <Show
          when={
            !props.record.success &&
            props.record.error &&
            !props.record.steps?.some(failed)
          }
        >
          <span class="min-w-0 text-failure">{props.record.error}</span>
        </Show>
      </button>
    </Show>
  );
}

function ResolvedHistoryRow(props: {
  record: HistoryRecord;
  history: RoutineHistoryProps;
  onSelect: () => void;
}): JSX.Element {
  return (
    <>
      <ResourceOrRunRow
        record={props.record}
        history={props.history}
        onSelect={props.onSelect}
      />
      <Show when={props.history.describeStep}>
        {(describe) => (
          <StepsSummary
            record={props.record}
            describe={describe()}
            onSelect={props.onSelect}
          />
        )}
      </Show>
    </>
  );
}

function ResourceOrRunRow(props: {
  record: HistoryRecord;
  history: RoutineHistoryProps;
  onSelect: () => void;
}): JSX.Element {
  const resource = createMemo(() => props.record.resource);
  return (
    <Show
      when={resource()}
      keyed
      fallback={
        <HistoryRow
          record={props.record}
          metadata={{ status: 'unavailable' }}
          onSelect={props.record.steps?.length ? props.onSelect : undefined}
        />
      }
    >
      {(target) => (
        <Suspense
          fallback={
            <HistoryRow
              record={props.record}
              resource={target}
              metadata={{ status: 'pending' }}
            />
          }
        >
          <ResourceHistoryRow
            record={props.record}
            resource={target}
            createMetadata={
              target.type === 'chat'
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

export function RoutineHistory(props: RoutineHistoryProps): JSX.Element {
  const [selectedId, setSelectedId] = createSignal<string>();
  const selected = () =>
    props.records.find((record) => record.id && record.id === selectedId());
  const [visibleCount, setVisibleCount] = createSignal(50);
  const [listElement, setListElement] = createSignal<HTMLDivElement>();
  const visibleRecords = createMemo(() =>
    props.records.slice(0, visibleCount())
  );
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
  return (
    <div class="@container/runs flex min-h-0 flex-1">
      <div
        ref={setListElement}
        class={cn(
          'min-h-0 flex-1 overflow-y-auto py-3',
          selected() && '@max-[720px]/runs:hidden'
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
          <ListLayoutProvider ref={listElement}>
            <div role="list" aria-label="Routine runs">
              <For each={visibleRecords()}>
                {(record) => (
                  <Show
                    when={record.skipped}
                    fallback={
                      <ResolvedHistoryRow
                        record={record}
                        history={props}
                        onSelect={() => setSelectedId(record.id ?? undefined)}
                      />
                    }
                  >
                    {(skip) => {
                      const run = () => runs().get(record);
                      const grouped = () => (run()?.length ?? 1) > 1;
                      const first = () => run()?.first === record;
                      const open = () => {
                        const id = run()?.first.id;
                        return !!id && expanded().has(id);
                      };
                      return (
                        <>
                          <Show when={grouped() && first()}>
                            <SkippedGroupToggle
                              count={run()?.length ?? 0}
                              open={open()}
                              onToggle={() => toggle(run()?.first)}
                            />
                          </Show>
                          <Show when={!grouped() || open()}>
                            <SkippedRow record={record} skip={skip()} />
                          </Show>
                        </>
                      );
                    }}
                  </Show>
                )}
              </For>
            </div>
          </ListLayoutProvider>
          <Show when={props.records.length > visibleCount()}>
            <div class="flex justify-center p-3">
              <Button
                variant="secondary"
                onClick={() => setVisibleCount((count) => count + 50)}
              >
                Load more runs
              </Button>
            </div>
          </Show>
        </Show>
      </div>
      <Show when={selected()}>
        {(record) => {
          const resource = () => record().resource;
          return (
            <aside class="min-h-0 w-96 shrink-0 overflow-y-auto border-l border-edge-muted @max-[720px]/runs:w-full @max-[720px]/runs:border-l-0">
              <RunDetail
                record={record()}
                describe={(step) => props.describeStep?.(step) ?? step.kind}
                onOpenConversation={
                  resource()
                    ? () => {
                        const target = resource();
                        if (target) props.onOpen(target, false);
                      }
                    : undefined
                }
                onClose={() => setSelectedId(undefined)}
              />
            </aside>
          );
        }}
      </Show>
    </div>
  );
}
