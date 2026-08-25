import type { ActivityViewSurfaceProps } from '@app/features/app-layout/layout-surfaces';
import { displayEntityType } from '@app/features/activity/my-activity-view';
import {
  actionAsPropertyChange,
  describeAction,
} from '@app/features/activity/describe-action';
import { PropertyChangeText } from '@app/features/activity/property-change';
import {
  ActionGlyph,
  ActionTypeGlyph,
} from '@app/features/activity/action-glyph';
import { ActorName } from '@app/features/activity/actor-name';
import { ComposedSplitControls } from '@components/app/split-layout/composed/ComposedSplitControls';
import { ComposedSplitHeader } from '@components/app/split-layout/composed/ComposedSplitHeader';
import { messagesSidebarWidth } from '@components/app/split-layout/messagesSidebarWidth';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import ChartBarIcon from '@phosphor/chart-bar.svg';
import CopyIcon from '@phosphor/copy.svg';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import SortIcon from '@phosphor/sort-ascending.svg';
import SortDescendingIcon from '@phosphor/sort-descending.svg';
import CaretUpDownIcon from '@phosphor/caret-up-down.svg';
import XIcon from '@phosphor/x.svg';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  Button,
  cn,
  Dropdown,
  Layer,
  SingleSelectCheck,
  Tooltip,
} from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ExperimentalInboxWorkspace } from './experimental-inbox-workspace';

type ActivityTab = 'activity' | 'inbox';
type ActivitySort = 'newest' | 'oldest' | 'most-active';
type ActivityActionFilter =
  | 'all'
  | 'GraphqlActivityCreated'
  | 'GraphqlActivityEdited'
  | 'GraphqlActivityOpened'
  | 'GraphqlActivityDeleted'
  | 'GraphqlActivityPropertyChanged'
  | 'GraphqlActivityParticipantAdded'
  | 'GraphqlActivityParticipantRemoved'
  | 'GraphqlActivityMessaged'
  | 'GraphqlActivitySent'
  | 'GraphqlActivityCallStarted';

const ACTIVITY_SORT_OPTIONS: readonly {
  id: ActivitySort;
  label: string;
}[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'most-active', label: 'Most activity' },
];

const ACTIVITY_SORT_ICONS = {
  newest: SortDescendingIcon,
  oldest: SortIcon,
  'most-active': ChartBarIcon,
} as const;

const ACTIVITY_FILTER_OPTIONS: readonly {
  id: ActivityActionFilter;
  label: string;
}[] = [
  { id: 'all', label: 'All activity' },
  { id: 'GraphqlActivityCreated', label: 'Created' },
  { id: 'GraphqlActivityEdited', label: 'Edited' },
  { id: 'GraphqlActivityOpened', label: 'Opened' },
  { id: 'GraphqlActivityDeleted', label: 'Deleted' },
  { id: 'GraphqlActivityPropertyChanged', label: 'Property changes' },
  { id: 'GraphqlActivityParticipantAdded', label: 'Participants added' },
  { id: 'GraphqlActivityParticipantRemoved', label: 'Participants removed' },
  { id: 'GraphqlActivityMessaged', label: 'Messages' },
  { id: 'GraphqlActivitySent', label: 'Email sent' },
  { id: 'GraphqlActivityCallStarted', label: 'Calls started' },
];

function ActivityFilterOptionIcon(props: { filter: ActivityActionFilter }) {
  return (
    <Show
      when={props.filter !== 'all' ? props.filter : undefined}
      fallback={<FilterIcon class="size-3.5" />}
    >
      {(actionType) => (
        <ActionTypeGlyph actionType={actionType()} class="size-3.5" />
      )}
    </Show>
  );
}

type ActivityEntityGroup = {
  key: string;
  entityId: string;
  entityType: ActivityEvent['entityType'];
  latest: ActivityEvent;
  events: ActivityEvent[];
};

function collapseActivityEvents(events: ActivityEvent[]) {
  const groups = new Map<string, ActivityEntityGroup>();
  const sorted = [...events].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  for (const event of sorted) {
    const key = `${event.entityType}:${event.entityId}`;
    const existing = groups.get(key);
    if (existing) existing.events.push(event);
    else {
      groups.set(key, {
        key,
        entityId: event.entityId,
        entityType: event.entityType,
        latest: event,
        events: [event],
      });
    }
  }

  return [...groups.values()];
}

function ActivityIdentity(props: {
  entityId: string;
  entityType: EntityType;
  children: (display: ReturnType<typeof usePropertyEntityDisplay>) => JSX.Element;
}) {
  const display = usePropertyEntityDisplay(
    () => props.entityId,
    () => props.entityType
  );
  return props.children(display);
}

function conciseActionLabel(action: ActivityEvent['action']) {
  switch (action.__typename) {
    case 'GraphqlActivityCreated':
      return 'Created';
    case 'GraphqlActivityEdited':
      return 'Edited';
    case 'GraphqlActivityOpened':
      return 'Opened';
    case 'GraphqlActivityDeleted':
      return 'Deleted';
    case 'GraphqlActivityMessaged':
      return 'Messaged';
    case 'GraphqlActivitySent':
      return 'Sent';
    case 'GraphqlActivityPropertyChanged':
      return 'Changed';
    case 'GraphqlActivityParticipantAdded':
      return 'Added';
    case 'GraphqlActivityParticipantRemoved':
      return 'Removed';
    case 'GraphqlActivityCallStarted':
      return 'Started';
    case 'GraphqlActivityUnknownAction':
      return action.tag.replaceAll('_', ' ');
  }
}

function ActivityTimelineRow(props: { event: ActivityEvent }) {
  return (
    <div class="flex w-full items-stretch gap-1 text-sm">
      <div class="relative flex w-6 shrink-0 items-center justify-center">
        <div class="absolute inset-y-0 w-px bg-edge-muted" />
        <span class="relative flex size-5 items-center justify-center rounded-full bg-surface ring ring-edge-muted">
          <ActionGlyph
            action={props.event.action}
            class="size-3 text-ink-muted"
          />
        </span>
      </div>
      <div class="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-0.5 hover:bg-hover/30">
        <span class="min-w-0 truncate font-medium">
          <ActorName actorId={props.event.actorId} />
        </span>
        <span class="min-w-0 truncate text-ink-muted">
          <Show
            when={actionAsPropertyChange(props.event.action)}
            fallback={conciseActionLabel(props.event.action).toLowerCase()}
          >
            {(change) => <PropertyChangeText action={change()} />}
          </Show>
        </span>
        <span class="ml-auto shrink-0 text-right text-xs font-medium text-ink-extra-muted">
          {formatRelativeTimestamp(new Date(props.event.occurredAt), {
            condensed: true,
          })}
        </span>
      </div>
    </div>
  );
}

function ActivityTableRow(props: {
  group: ActivityEntityGroup;
  selected: boolean;
  onSelect: () => void;
}) {
  const mappedType = () => displayEntityType(props.group.entityType);
  const body = (
    name: () => JSX.Element,
    icon: () => JSX.Element
  ) => (
    <button
      type="button"
      class={cn(
        'grid w-full grid-cols-[minmax(12rem,1.35fr)_minmax(9rem,1fr)_6rem_7rem] items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
        props.selected ? 'bg-active text-ink' : 'hover:bg-ink/5'
      )}
      aria-pressed={props.selected}
      onClick={props.onSelect}
    >
      <span class="flex min-w-0 items-center gap-2.5">
        <span class="flex size-6 shrink-0 items-center justify-center">
          {icon()}
        </span>
        <span class="min-w-0 truncate font-medium">{name()}</span>
      </span>
      <span class="flex min-w-0 items-center gap-2 truncate text-ink-muted">
        <ActionGlyph
          action={props.group.latest.action}
          class="size-3.5 shrink-0"
        />
        <span class="truncate">
          {conciseActionLabel(props.group.latest.action)}
        </span>
      </span>
      <span class="text-right text-xs tabular-nums text-ink-muted">
        {props.group.events.length}
      </span>
      <span class="text-right text-xs text-ink-extra-muted">
        {formatRelativeTimestamp(new Date(props.group.latest.occurredAt), {
          condensed: true,
        })}
      </span>
    </button>
  );

  return (
    <Show
      when={mappedType()}
      fallback={
        body(
          () => props.group.entityId,
          () => (
            <ActionGlyph
              action={props.group.latest.action}
              class="size-4 text-ink-muted"
            />
          )
        )
      }
    >
      {(entityType) => (
        <ActivityIdentity
          entityId={props.group.entityId}
          entityType={entityType()}
        >
          {(display) =>
            body(
              () =>
                display.isLoading()
                  ? activityEntityTypeLabel(props.group.entityType)
                  : display.name(),
              display.icon
            )
          }
        </ActivityIdentity>
      )}
    </Show>
  );
}

function detailsActionLabel(group: ActivityEntityGroup) {
  switch (group.latest.action.__typename) {
    case 'GraphqlActivityMessaged':
      return 'Open conversation';
    case 'GraphqlActivitySent':
      return 'Open thread';
    case 'GraphqlActivityCallStarted':
      return 'Open call';
    default:
      return 'Open item';
  }
}

function ActivityDetailsContent(props: {
  group: ActivityEntityGroup;
  entityType: EntityType;
  onClose: () => void;
}) {
  const display = usePropertyEntityDisplay(
    () => props.group.entityId,
    () => props.entityType
  );
  const openItem = () => {
    const block = display.blockOrFileType();
    if (!block) return;
    openDocument(
      block,
      props.group.entityId,
      display.linkParams(),
      false
    );
  };

  return (
    <ActivityDetailsShell
      group={props.group}
      name={
        display.isLoading()
          ? activityEntityTypeLabel(props.group.entityType)
          : display.name()
      }
      icon={display.icon()}
      onClose={props.onClose}
      actions={
        <>
          <Button
            variant="cta"
            size="lg"
            class="h-11 min-w-0 flex-1 justify-center rounded-xl"
            disabled={!display.blockOrFileType()}
            onClick={openItem}
          >
            {detailsActionLabel(props.group)}
          </Button>
          <Dropdown placement="top-end">
            <Dropdown.Trigger
              variant="ghost"
              size="icon-lg"
              class="shrink-0 rounded-xl"
              label="More actions"
            >
              <DotsThreeIcon />
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.Group>
                <Dropdown.Item
                  onSelect={() =>
                    void navigator.clipboard.writeText(props.group.entityId)
                  }
                >
                  <CopyIcon class="size-4" />
                  Copy ID
                </Dropdown.Item>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
        </>
      }
    />
  );
}

function formatActivityDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function activityEntityTypeLabel(entityType: ActivityEvent['entityType']) {
  return entityType
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

function ActivityDetailField(props: {
  label: string;
  children: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-1 py-2 text-sm">
      <dt class="text-xs font-medium text-ink-extra-muted">{props.label}</dt>
      <dd class="m-0 min-w-0 text-ink">{props.children}</dd>
    </div>
  );
}

function ActivityDetailsShell(props: {
  group: ActivityEntityGroup;
  name: JSX.Element;
  icon: JSX.Element;
  onClose: () => void;
  actions?: JSX.Element;
}) {
  const creationEvent = () =>
    props.group.events.find(
      (event) => event.action.__typename === 'GraphqlActivityCreated'
    );
  let timelineScrollRef: HTMLDivElement | undefined;

  return (
    <aside class="absolute inset-y-2 right-2 z-10 flex w-[min(42%,30rem)] min-w-80 flex-col overflow-hidden rounded-2xl bg-lift shadow-xl @min-[920px]/experimental-activity:relative @min-[920px]/experimental-activity:inset-auto @min-[920px]/experimental-activity:ml-6 @min-[920px]/experimental-activity:shadow-none">
      <header class="flex min-h-14 shrink-0 items-center gap-1.5 px-4 py-2">
        <span class="flex size-7 shrink-0 items-center justify-center">
          {props.icon}
        </span>
        <h2 class="m-0 min-w-0 flex-1 truncate text-base font-semibold text-ink">
          {props.name}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          class="rounded-xl"
          label="Close details"
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <section class="px-4 pb-3 pt-2">
          <div class="pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-extra-muted">
            Timeline
          </div>
          <div class="relative">
            <div
              ref={timelineScrollRef}
              class="scrollbar-hidden max-h-[min(42vh,22rem)] overflow-y-auto"
            >
              <div>
                <For each={props.group.events}>
                  {(event) => <ActivityTimelineRow event={event} />}
                </For>
              </div>
            </div>
            <ScrollIndicators
              scrollRef={() => timelineScrollRef}
              appearance="gradient"
              class="from-lift!"
            />
          </div>
        </section>

        <section class="border-t border-edge-muted px-4 py-3">
          <dl class="m-0">
            <ActivityDetailField label="Type">
              {activityEntityTypeLabel(props.group.entityType)}
            </ActivityDetailField>
            <ActivityDetailField label="ID">
              <span class="block truncate font-mono text-xs" title={props.group.entityId}>
                {props.group.entityId}
              </span>
            </ActivityDetailField>
            <ActivityDetailField label="Activity count">
              {props.group.events.length}
            </ActivityDetailField>
            <ActivityDetailField label="Latest activity">
              <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span>{conciseActionLabel(props.group.latest.action)}</span>
                <span class="text-ink-extra-muted">by</span>
                <span class="min-w-0 font-medium">
                  <ActorName actorId={props.group.latest.actorId} />
                </span>
              </span>
            </ActivityDetailField>
            <ActivityDetailField label="Last updated">
              {formatActivityDate(props.group.latest.occurredAt)}
            </ActivityDetailField>
            <Show when={creationEvent()}>
              {(event) => (
                <>
                  <ActivityDetailField label="Created by">
                    <ActorName actorId={event().actorId} />
                  </ActivityDetailField>
                  <ActivityDetailField label="Created at">
                    {formatActivityDate(event().occurredAt)}
                  </ActivityDetailField>
                </>
              )}
            </Show>
          </dl>
        </section>
      </div>

      <footer class="shrink-0 border-t border-edge-muted">
        <div class="flex w-full items-center gap-2 px-4 py-3">{props.actions}</div>
      </footer>
    </aside>
  );
}

function ActivityDetails(props: {
  group: ActivityEntityGroup;
  onClose: () => void;
}) {
  const entityType = () => displayEntityType(props.group.entityType);
  return (
    <Show
      when={entityType()}
      fallback={
        <ActivityDetailsShell
          group={props.group}
          name={props.group.entityId}
          icon={
            <ActionGlyph
              action={props.group.latest.action}
              class="size-4 text-ink-muted"
            />
          }
          onClose={props.onClose}
        />
      }
    >
      {(type) => (
        <ActivityDetailsContent
          group={props.group}
          entityType={type()}
          onClose={props.onClose}
        />
      )}
    </Show>
  );
}

function ActivityWorkspaceHeader(props: {
  title: 'Activity' | 'Inbox';
  onSwitch: () => void;
  animate?: boolean;
}) {
  const destination = () => (props.title === 'Activity' ? 'Inbox' : 'Activity');
  return (
    <ComposedSplitHeader
      class="absolute! left-0 top-0 z-1 flex flex-col items-stretch px-4 pb-3 pt-2 @max-[760px]/experimental-activity:px-3 @max-[480px]/experimental-activity:px-2"
      style={{
        width:
          props.title === 'Inbox'
            ? `${messagesSidebarWidth()}px`
            : '100%',
      }}
    >
      <div class="flex min-h-7 items-center">
        <ComposedSplitControls />
      </div>
      <div class="mt-1 flex min-w-0 items-center">
        <button
          type="button"
          class="experimental-v2-view-switch flex w-40 max-w-full items-center justify-between gap-2.5 rounded-xl px-1 py-1 text-ink outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label={`Switch to ${destination()}`}
          onClick={props.onSwitch}
        >
          <span class="experimental-v2-view-switch-label">
            <Show keyed when={props.title}>
              {(title) => (
                <span
                  class={cn(
                    'experimental-v2-view-switch-current-frame',
                    props.animate && 'experimental-v2-view-switch-current-in'
                  )}
                >
                  <span class="experimental-v2-view-switch-current">
                    {title}
                  </span>
                </span>
              )}
            </Show>
            <span
              aria-hidden="true"
              class="experimental-v2-view-switch-next"
            >
              {destination()}
            </span>
          </span>
          <CaretUpDownIcon class="size-4 shrink-0" />
        </button>
      </div>
    </ComposedSplitHeader>
  );
}

/** Combined Activity and Inbox workspace for Experimental v2. */
export function ExperimentalActivityView(props: ActivityViewSurfaceProps) {
  const [tab, setTab] = createSignal<ActivityTab>('inbox');
  const [hasSwitched, setHasSwitched] = createSignal(false);
  const [selectedKey, setSelectedKey] = createSignal<string>();
  const [searchQuery, setSearchQuery] = createSignal('');
  const [sort, setSort] = createSignal<ActivitySort>('newest');
  const [actionFilter, setActionFilter] =
    createSignal<ActivityActionFilter>('all');
  let tableScrollRef: HTMLDivElement | undefined;
  const groups = createMemo(() => collapseActivityEvents(props.events ?? []));
  const displayedGroups = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    const filter = actionFilter();
    const filtered = groups().filter((group) => {
      if (
        filter !== 'all' &&
        group.latest.action.__typename !== filter
      ) {
        return false;
      }
      if (!query) return true;
      return [
        group.entityId,
        group.entityType,
        conciseActionLabel(group.latest.action),
      ].some((value) => value.toLowerCase().includes(query));
    });

    return filtered.toSorted((a, b) => {
      if (sort() === 'most-active') {
        return b.events.length - a.events.length;
      }
      const difference =
        new Date(b.latest.occurredAt).getTime() -
        new Date(a.latest.occurredAt).getTime();
      return sort() === 'oldest' ? -difference : difference;
    });
  });
  const selectedFilterLabel = createMemo(
    () =>
      ACTIVITY_FILTER_OPTIONS.find((option) => option.id === actionFilter())!
        .label
  );
  const selectedGroup = createMemo(() =>
    groups().find((group) => group.key === selectedKey())
  );
  const selectGroup = (key: string) => {
    const scrollTop = tableScrollRef?.scrollTop ?? 0;
    setSelectedKey(key);
    requestAnimationFrame(() => {
      if (tableScrollRef) tableScrollRef.scrollTop = scrollTop;
      requestAnimationFrame(() => {
        if (tableScrollRef) tableScrollRef.scrollTop = scrollTop;
      });
    });
  };

  const switchView = () => {
    setHasSwitched(true);
    setTab((current) => (current === 'activity' ? 'inbox' : 'activity'));
    setSelectedKey(undefined);
  };

  return (
    <div class="@container/experimental-activity relative flex size-full min-h-0 flex-col bg-panel">
      <ActivityWorkspaceHeader
        title={tab() === 'activity' ? 'Activity' : 'Inbox'}
        onSwitch={switchView}
        animate={hasSwitched()}
      />
      <Suspense fallback={<div class="size-full bg-panel" />}>
        <Show
          when={tab() === 'activity'}
          fallback={<ExperimentalInboxWorkspace />}
        >
        <div class="flex size-full min-h-0 flex-col pt-[5.75rem]">
          <div class="flex shrink-0 items-center gap-4 px-4 pb-3 @max-[720px]/experimental-activity:gap-2 @max-[760px]/experimental-activity:px-3 @max-[480px]/experimental-activity:px-2">
          <div class="w-full min-w-20 max-w-md">
            <label class="group flex h-10 w-full items-center gap-1 rounded-2xl border border-edge-muted bg-ink/5 px-3 text-sm text-ink-muted hover:bg-ink/7 hover:text-ink focus-within:border-accent focus-within:bg-ink/7 focus-within:text-ink">
              <SearchIcon class="size-4 shrink-0" />
              <input
                type="search"
                value={searchQuery()}
                placeholder="Search activity"
                aria-label="Search activity"
                class="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-extra-muted"
                onInput={(event) => setSearchQuery(event.currentTarget.value)}
              />
            </label>
          </div>

          <div class="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-2 [&_[data-button]]:h-8 [&_[data-button]]:min-w-8 [&_[data-button]]:rounded-lg @max-[720px]/experimental-activity:gap-1">
            <Dropdown placement="bottom-start">
              <Tooltip label="Sort">
                <Dropdown.Trigger
                  depth={2}
                  class="bg-surface"
                  aria-label="Sort"
                >
                  <SortIcon />
                </Dropdown.Trigger>
              </Tooltip>
              <Dropdown.Content class="shadow-menu">
                <Dropdown.Group>
                  <For each={ACTIVITY_SORT_OPTIONS}>
                    {(option) => (
                      <Dropdown.Item onSelect={() => setSort(option.id)}>
                        <span class="flex size-3.5 shrink-0 items-center justify-center text-ink-muted">
                          <Dynamic
                            component={ACTIVITY_SORT_ICONS[option.id]}
                            class="size-3.5"
                          />
                        </span>
                        <span class="flex-1 truncate">{option.label}</span>
                        <SingleSelectCheck active={sort() === option.id} />
                      </Dropdown.Item>
                    )}
                  </For>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>

            <Dropdown placement="bottom-start">
              <Tooltip label={selectedFilterLabel()}>
                <Dropdown.Trigger
                  depth={2}
                  class={cn(
                    'relative bg-surface',
                    actionFilter() !== 'all' && 'bg-active text-ink'
                  )}
                  aria-label={selectedFilterLabel()}
                >
                  <FilterIcon />
                  <Show when={actionFilter() !== 'all'}>
                    <span class="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-4 text-panel">
                      1
                    </span>
                  </Show>
                </Dropdown.Trigger>
              </Tooltip>
              <Dropdown.Content>
                <Dropdown.Group>
                  <For each={ACTIVITY_FILTER_OPTIONS}>
                    {(option) => (
                      <Dropdown.Item
                        onSelect={() => setActionFilter(option.id)}
                      >
                        <span class="flex size-3.5 shrink-0 items-center justify-center text-ink-muted">
                          <ActivityFilterOptionIcon filter={option.id} />
                        </span>
                        <span class="flex-1 truncate">{option.label}</span>
                        <SingleSelectCheck
                          active={actionFilter() === option.id}
                        />
                      </Dropdown.Item>
                    )}
                  </For>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </div>
        </div>

        <section class="relative min-h-0 flex-1 px-4 pb-4 @max-[760px]/experimental-activity:px-3 @max-[480px]/experimental-activity:px-2">
          <div class="relative flex size-full min-h-0 overflow-hidden">
            <Layer depth={2}>
              <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-surface p-2">
              <div class="grid shrink-0 grid-cols-[minmax(12rem,1.35fr)_minmax(9rem,1fr)_6rem_7rem] gap-3 border-b border-edge-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-extra-muted">
                <span>Name</span>
                <span>Action</span>
                <span class="text-right">Events count</span>
                <span class="text-right">Updated</span>
              </div>
              <div class="relative min-h-0 flex-1">
                <div
                  ref={tableScrollRef}
                  class="size-full overflow-y-auto"
                >
                  <div>
                    <Show
                      when={displayedGroups().length > 0}
                      fallback={
                        <p class="m-0 px-3 py-8 text-center text-sm text-ink-extra-muted">
                          {props.isLoading
                            ? 'Loading activity…'
                            : props.isError
                              ? 'Activity is unavailable right now.'
                              : groups().length > 0
                                ? 'No matching activity.'
                                : 'No activity yet.'}
                        </p>
                      }
                    >
                      <div class="flex flex-col gap-0.5 py-1">
                        <For each={displayedGroups()}>
                          {(group) => (
                            <ActivityTableRow
                              group={group}
                              selected={selectedKey() === group.key}
                              onSelect={() => selectGroup(group.key)}
                            />
                          )}
                        </For>
                      </div>
                      <Show when={props.hasNextPage}>
                        <div class="flex justify-center py-3">
                          <Button
                            variant="ghost"
                            class="rounded-xl"
                            disabled={props.isFetchingNextPage}
                            onClick={props.onFetchNextPage}
                          >
                            {props.isFetchingNextPage
                              ? 'Loading…'
                              : 'Show more'}
                          </Button>
                        </div>
                      </Show>
                    </Show>
                  </div>
                </div>
                <ScrollIndicators
                  scrollRef={() => tableScrollRef}
                  appearance="gradient"
                  class="from-surface!"
                />
              </div>
              </section>
            </Layer>

            <Show when={selectedGroup()}>
              {(group) => (
                <ActivityDetails
                  group={group()}
                  onClose={() => setSelectedKey(undefined)}
                />
              )}
            </Show>
          </div>
          </section>
        </div>
        </Show>
      </Suspense>
    </div>
  );
}
