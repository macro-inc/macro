import { createSoupState } from '@app/features/next-soup/create-soup-state';
import type { FilterID } from '@app/features/next-soup/filters';
import { SoupContextProvider } from '@app/features/next-soup/soup-context';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextGroup } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-group';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { UnifiedFilterDropdown } from '@app/features/next-soup/soup-view/filters-bar/unified-filter-dropdown';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { SoupViewList } from '@app/features/next-soup/soup-view/soup-view';
import {
  SoupViewContextProvider,
  useSoupView,
} from '@app/features/next-soup/soup-view/soup-view-context';
import TasksIcon from '@phosphor/check-square.svg';
import FilesIcon from '@phosphor/files.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import CallsIcon from '@phosphor/phone.svg';
import AgentsIcon from '@phosphor/sparkle.svg';
import { Button } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import type { ChannelContentKind } from '../core/content-kind';
import { channelContentScope } from '../queries/content-scope';
import { useChannelSharedContent } from '../queries/shared-content';

export function ChannelContentTab(props: {
  channelId: string;
  kind: ChannelContentKind;
}) {
  const references = useChannelSharedContent(() => props.channelId);
  const soup = createSoupState();
  const shared = () => (references.isSuccess ? references.data : []);
  const view = () => (props.kind === 'files' ? 'documents' : props.kind);
  const predicates = (): FilterID[] =>
    match(props.kind)
      .returnType<FilterID[]>()
      .with('files', () => ['document-or-file', 'not-task'])
      .with('tasks', () => ['task'])
      .with('calls', () => ['calls'])
      .with('agents', () => ['agent'])
      .exhaustive();
  return (
    <Suspense
      fallback={
        <div class="p-6 text-sm text-ink-muted">Loading shared content…</div>
      }
    >
      <Show
        when={props.kind === 'calls' || references.isSuccess}
        fallback={
          <div class="p-6 text-sm text-ink-muted" role="status">
            {references.isError
              ? 'Could not load shared content.'
              : 'Loading shared content…'}
            <Show when={references.isError}>
              <Button variant="ghost" onClick={() => void references.refetch()}>
                Try again
              </Button>
            </Show>
          </div>
        }
      >
        <SoupContextProvider soup={soup}>
          <SoupViewContextProvider
            soup={soup}
            viewId={view()}
            embeddedPreset={{
              filters: channelContentScope(
                props.kind,
                props.channelId,
                shared()
              ),
              clientFilters: { and: predicates() },
            }}
            itemMembershipFilter={(item) => {
              if (item.tag === 'call')
                return (
                  props.kind === 'calls' &&
                  item.data.channelId === props.channelId
                );
              const data = item.data;
              return (
                'id' in data &&
                shared().some((reference) => reference.entity_id === data.id)
              );
            }}
            initialEnabled
            preferInitialFilters
            initialQuery={channelContentScope(
              props.kind,
              props.channelId,
              shared()
            )}
            initialClientFilters={{ and: predicates() }}
            scopeFilters={(state) =>
              channelContentScope(props.kind, props.channelId, shared(), state)
            }
          >
            <ChannelContentList kind={props.kind} />
          </SoupViewContextProvider>
        </SoupContextProvider>
      </Show>
    </Suspense>
  );
}

function ChannelContentList(props: { kind: ChannelContentKind }) {
  const view = useSoupView();
  const filters = useFilterRefinements();
  const [filterOpen, setFilterOpen] = createSignal(false);
  const Icon = match(props.kind)
    .with('files', () => FilesIcon)
    .with('tasks', () => TasksIcon)
    .with('calls', () => CallsIcon)
    .with('agents', () => AgentsIcon)
    .exhaustive();
  return (
    <div class="flex h-full min-h-0 flex-col px-4 pt-4 touch:px-2 touch:pb-(--mobile-content-inset-bottom)">
      <div class="mb-5 flex flex-wrap items-end justify-between gap-3 px-2">
        <div>
          <h1 class="text-xl font-semibold capitalize tracking-tight">
            {props.kind}
          </h1>
          <p class="mt-1 text-sm text-ink-muted">
            {match(props.kind)
              .with('files', () => 'Documents and files shared in this channel')
              .with('tasks', () => 'Keep track of work shared in this channel')
              .with(
                'calls',
                () => 'Conversations and recordings from this channel'
              )
              .with(
                'agents',
                () => 'Agent conversations shared in this channel'
              )
              .exhaustive()}
          </p>
        </div>
      </div>
      <div class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-edge-muted p-2">
        <label class="flex min-w-40 flex-1 items-center gap-2 px-2">
          <MagnifyingGlass class="size-4 shrink-0 text-ink-muted" />
          <input
            aria-label={`Search channel ${props.kind}`}
            placeholder={`Search ${props.kind}…`}
            class="h-8 min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
            value={view.searchText()}
            onInput={(event) => view.setSearchText(event.currentTarget.value)}
          />
        </label>
        <SoupViewContextSort />
        <SoupViewContextGroup />
        <Show when={props.kind === 'files' || props.kind === 'tasks'}>
          <UnifiedFilterDropdown
            open={filterOpen}
            onOpenChange={setFilterOpen}
          />
        </Show>
        <Show when={props.kind === 'calls'}>
          <select
            aria-label="Call attendance"
            class="h-9 rounded-lg border border-edge-muted bg-surface px-3 text-sm text-ink-muted"
            value={view.queryFilters.state.include.callStatus ?? 'all'}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (
                value === 'all' ||
                value === 'ATTENDED' ||
                value === 'MISSED' ||
                value === 'UNATTENDED'
              )
                view.queryFilters.set({
                  include: { callStatus: value === 'all' ? undefined : value },
                });
            }}
          >
            <option value="all">All calls</option>
            <option value="ATTENDED">Attended</option>
            <option value="MISSED">Missed</option>
            <option value="UNATTENDED">Unattended</option>
          </select>
        </Show>
      </div>
      <SoupActiveFiltersBar
        filters={filters.consolidatedFiltersList()}
        onClearAll={filters.resetToTabDefaults}
      />
      <div class="relative min-h-0 flex-1">
        <SoupViewList
          emptyState={
            <div
              class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
              role="status"
            >
              <div class="rounded-2xl bg-accent/10 p-4 text-accent">
                <Icon class="size-6" />
              </div>
              <h2 class="text-base font-medium">No {props.kind} shared yet</h2>
              <p class="max-w-sm text-sm text-ink-muted">
                {props.kind === 'calls'
                  ? 'Calls from this channel will appear here.'
                  : `Share ${props.kind === 'agents' ? 'an agent conversation' : props.kind === 'tasks' ? 'a task' : 'a document or file'} in Chat to find it here.`}
              </p>
            </div>
          }
        />
      </div>
    </div>
  );
}
