import { EntityIcon } from '@core/component/EntityIcon';
import { formatDateAndTime } from '@entity';
import { getHistoryResource } from '@queries/agent-schedule/run-resource';
import { cn } from '@ui';
import {
  type Accessor,
  createMemo,
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
  is_success?: boolean | null;
};

type HistoryResource = NonNullable<ReturnType<typeof getHistoryResource>>;

export type HistoryMetadata =
  | { status: 'pending' }
  | { status: 'unavailable' }
  | { status: 'ready'; name: string };

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

function HistoryRow(props: HistoryRowProps): JSX.Element {
  const clickable = () =>
    Boolean(
      props.resource && props.metadata.status === 'ready' && props.onOpen
    );
  const name = () => {
    const metadata = props.metadata;
    if (metadata.status === 'ready')
      return metadata.name.trim() || 'Untitled run';
    if (metadata.status === 'pending') return 'Loading…';
    return 'Run unavailable';
  };

  return (
    <button
      type="button"
      disabled={!clickable()}
      class={cn(
        'flex w-full items-center gap-2 border-b border-edge-muted px-3 py-2 text-left text-sm cursor-default',
        clickable() && 'hover:bg-hover'
      )}
      onClick={(event) => {
        if (clickable() && props.resource) {
          props.onOpen?.(props.resource, event.shiftKey);
        }
      }}
    >
      <div class="size-4 shrink-0">
        <EntityIcon
          targetType={props.resource?.type ?? 'automation'}
          size="xs"
        />
      </div>
      <span class="min-w-0 flex-1 truncate" title={name()}>
        {name()}
      </span>
      <span
        class={cn(
          'ml-auto shrink-0 text-xs font-mono uppercase font-light',
          // Live synthetic rows have no persisted ID and are not failures.
          !props.record.id || props.record.is_success
            ? 'text-ink-extra-muted'
            : 'text-failure'
        )}
      >
        {formatDateAndTime(props.record.start_time ?? new Date())}
      </span>
    </button>
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
  return (
    <Show
      when={props.records.length > 0}
      fallback={
        <div class="px-3 py-8 text-center text-xs text-ink-muted">
          {props.isPending ? 'Loading…' : 'No runs yet.'}
        </div>
      }
    >
      <div class="min-h-0 h-full overflow-y-scroll">
        <For each={props.records.slice(0, 50)}>
          {(record) => <ResolvedHistoryRow record={record} history={props} />}
        </For>
      </div>
    </Show>
  );
}
