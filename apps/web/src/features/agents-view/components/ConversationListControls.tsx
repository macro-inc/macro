import {
  type ListControlOption,
  ListFilterDropdown,
  type ListFilterGroup,
  ListGroupDropdown,
} from '@app/components/view-shell';
import ChatIcon from '@phosphor/chat-circle.svg';
import CodeIcon from '@phosphor/code.svg';
import GitMergeIcon from '@phosphor/git-merge.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';
import {
  activeFilterCount,
  type ConversationFilterCategory,
  type ConversationFilters,
  type ConversationGrouping,
  type PullRequestFilter,
  type StatusFilter,
} from '../core/conversation-filters';
import type { AgentsMode } from '../core/mode';

type FilterValue = AgentsMode | StatusFilter | PullRequestFilter;

const statusDot = (class_: string) => () => (
  <span class={cn('size-1.5 rounded-full', class_)} />
);

const pullRequestIcon =
  (class_: string, merged = false) =>
  () =>
    merged ? (
      <GitMergeIcon class={cn('size-3.5', class_)} />
    ) : (
      <GitPullRequestIcon class={cn('size-3.5', class_)} />
    );

const TYPE_OPTIONS: ListControlOption<AgentsMode>[] = [
  {
    id: 'chat',
    label: 'Chat',
    icon: () => <ChatIcon class="size-3.5 text-ink-muted" />,
  },
  {
    id: 'code',
    label: 'Code',
    icon: () => <CodeIcon class="size-3.5 text-ink-muted" />,
  },
];

const STATUS_OPTIONS: ListControlOption<StatusFilter>[] = [
  { id: 'waiting', label: 'Waiting for you', icon: statusDot('bg-warning') },
  { id: 'working', label: 'Working', icon: statusDot('bg-accent') },
  { id: 'unread', label: 'Unread', icon: statusDot('bg-accent') },
  {
    id: 'idle',
    label: 'Idle',
    icon: () => (
      <span class="size-1.5 rounded-full border border-ink-extra-muted" />
    ),
  },
];

const PULL_REQUEST_OPTIONS: ListControlOption<PullRequestFilter>[] = [
  { id: 'open', label: 'Open', icon: pullRequestIcon('text-success') },
  {
    id: 'draft',
    label: 'Draft',
    icon: pullRequestIcon('text-ink-extra-muted'),
  },
  { id: 'merged', label: 'Merged', icon: pullRequestIcon('text-note', true) },
  { id: 'closed', label: 'Closed', icon: pullRequestIcon('text-failure') },
  {
    id: 'none',
    label: 'No pull request',
    icon: pullRequestIcon('text-ink-extra-muted'),
  },
];

const FILTER_GROUPS: ListFilterGroup<
  ConversationFilterCategory,
  FilterValue
>[] = [
  { id: 'type', label: 'Type', options: TYPE_OPTIONS },
  { id: 'status', label: 'Status', options: STATUS_OPTIONS },
  { id: 'pullRequest', label: 'Pull request', options: PULL_REQUEST_OPTIONS },
];

const GROUPING_OPTIONS: ListControlOption<ConversationGrouping>[] = [
  { id: 'none', label: 'None' },
  { id: 'status', label: 'Status' },
  { id: 'type', label: 'Type' },
];

export type ConversationListControlsProps = {
  filters: ConversationFilters;
  grouping: ConversationGrouping;
  onFilterChange: (
    category: ConversationFilterCategory,
    value: FilterValue,
    selected: boolean
  ) => void;
  onClearFilters: () => void;
  onGroupingChange: (grouping: ConversationGrouping) => void;
};

/** The Tasks-style Group and Filter menus for the conversation list. */
export function ConversationListControls(props: ConversationListControlsProps) {
  const isSelected = (
    category: ConversationFilterCategory,
    value: FilterValue
  ) => (props.filters[category] as readonly FilterValue[]).includes(value);
  const activeCount = () => activeFilterCount(props.filters);

  return (
    <div class="flex shrink-0 items-center">
      <ListGroupDropdown
        label="Group conversations"
        class="size-(--sidebar-control-size)"
        value={props.grouping}
        options={GROUPING_OPTIONS}
        onChange={props.onGroupingChange}
      />
      <div class="relative shrink-0">
        <ListFilterDropdown
          label="Filter conversations"
          class="size-(--sidebar-control-size)"
          groups={FILTER_GROUPS}
          isSelected={isSelected}
          onSelectionChange={props.onFilterChange}
          onClear={props.onClearFilters}
        />
        <Show when={activeCount() > 0}>
          <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
            {activeCount()}
          </span>
        </Show>
      </div>
    </div>
  );
}
