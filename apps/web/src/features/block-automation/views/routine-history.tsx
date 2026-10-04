import { EntityIcon } from '@core/component/EntityIcon';
import {
  type AgentSessionEntity,
  type ChatEntity,
  formatDateAndTime,
  ListEntity,
  ListLayoutProvider,
} from '@entity';
import { getHistoryResource } from '@queries/agent-schedule/run-resource';
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

export type HistoryRecord = {
  id?: string | null;
  resource_id?: string | null;
  result: unknown;
  start_time?: string | null;
  end_time?: string | null;
  is_success?: boolean | null;
};

type HistoryResource = NonNullable<ReturnType<typeof getHistoryResource>>;

export type HistoryMetadata =
  | { status: 'pending' }
  | { status: 'unavailable' }
  | { status: 'ready'; entity: AgentSessionEntity | ChatEntity };

type RoutineHistoryProps = {
  records: readonly HistoryRecord[];
  isPending: boolean;
  createChatMetadata: (id: string) => Accessor<HistoryMetadata>;
  createAgentMetadata: (id: string) => Accessor<HistoryMetadata>;
  onOpen: (resource: HistoryResource, newSplit: boolean) => void;
};

type HistoryRowProps = {
  record: HistoryRecord;
  resource?: HistoryResource;
  metadata: HistoryMetadata;
  onOpen?: (resource: HistoryResource, newSplit: boolean) => void;
};

function RunOutcome(props: { record: HistoryRecord }) {
  const outcome = () =>
    !props.record.id
      ? 'Running'
      : props.record.is_success
        ? 'Succeeded'
        : 'Failed';
  const duration = () => {
    if (!props.record.start_time || !props.record.end_time) return undefined;
    const seconds = Math.max(
      0,
      Math.round(
        (Date.parse(props.record.end_time) -
          Date.parse(props.record.start_time)) /
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
      <span class={cn(outcome() === 'Failed' && 'text-failure')}>
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
          sortTs: props.record.start_time ?? metadata.entity.sortTs,
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
          class="soup-list-entity mx-1 flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm text-ink-muted"
        >
          <span class="size-4 shrink-0">
            <EntityIcon
              targetType={props.resource?.type ?? 'automation'}
              size="xs"
            />
          </span>
          <span class="min-w-0 flex-1 truncate">
            {props.metadata.status === 'pending'
              ? 'Loading…'
              : 'Run unavailable'}
          </span>
          <RunOutcome record={props.record} />
          <span class="ml-2 text-xs text-ink-extra-muted">
            {props.record.start_time
              ? formatDateAndTime(props.record.start_time)
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

function ResolvedHistoryRow(props: {
  record: HistoryRecord;
  history: RoutineHistoryProps;
}): JSX.Element {
  const resource = createMemo(() => getHistoryResource(props.record));
  return (
    <Show
      when={resource()}
      keyed
      fallback={
        <HistoryRow
          record={props.record}
          metadata={{ status: 'unavailable' }}
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
  const [visibleCount, setVisibleCount] = createSignal(50);
  const [listElement, setListElement] = createSignal<HTMLDivElement>();
  return (
    <div ref={setListElement} class="min-h-0 flex-1 overflow-y-auto py-3">
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
            <For each={props.records.slice(0, visibleCount())}>
              {(record) => (
                <ResolvedHistoryRow record={record} history={props} />
              )}
            </For>
          </div>
        </ListLayoutProvider>
        <Show when={props.records.length > visibleCount()}>
          <div class="flex justify-center p-3">
            <Button onClick={() => setVisibleCount((count) => count + 50)}>
              Load more runs
            </Button>
          </div>
        </Show>
      </Show>
    </div>
  );
}
