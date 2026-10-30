import ArrowDownIcon from '@icon/system/regular/arrow-down.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import { cn, Tooltip } from '@ui';
import { type JSX, Show } from 'solid-js';
import { useTasksView } from '../../tasks-view-context';
import type { TaskSortId } from '../../types';
import { taskGridTemplate } from './task-grid-template';

function SortableHeader(props: {
  label: JSX.Element;
  area: string;
  sortId?: TaskSortId;
  align?: 'start' | 'end';
  class?: string;
}) {
  const { state, setPrimarySort } = useTasksView();
  const active = () => state.sort[0]?.id === props.sortId;
  const reversed = () => active() && state.sort[0]?.reversed === true;
  const alignment = () => {
    if (props.align === 'end') return 'justify-end';
    return 'justify-start';
  };

  return (
    <div
      role="columnheader"
      class={cn('flex min-w-0 items-center', alignment(), props.class)}
      style={{ 'grid-area': props.area }}
    >
      <Show
        when={props.sortId}
        fallback={<span class="truncate">{props.label}</span>}
      >
        {(sortId) => (
          <button
            type="button"
            data-blocks-navigation
            class={cn(
              'flex h-full min-w-0 items-center gap-1 text-ink-extra-muted hover:text-ink',
              active() && 'text-ink'
            )}
            onClick={() => setPrimarySort(sortId())}
          >
            <span class="truncate">{props.label}</span>
            <ArrowDownIcon
              class={cn(
                'size-3 shrink-0 transition-transform',
                reversed() && 'rotate-180'
              )}
            />
          </button>
        )}
      </Show>
    </div>
  );
}

export function TaskListHeader() {
  const { showTaskProject } = useTasksView();
  return (
    <div
      role="row"
      class="task-grid-row task-grid-icon-creator grid h-10 w-full shrink-0 items-center gap-2 px-3 text-xs font-medium text-ink-extra-muted"
      style={taskGridTemplate({
        indicator: true,
        project: showTaskProject(),
        status: false,
        priority: false,
        projectBeforeAssignees: true,
      })}
    >
      <span role="columnheader" style={{ 'grid-area': 'indicator' }} />
      <span
        role="columnheader"
        class="truncate"
        style={{ 'grid-area': 'content' }}
      >
        Task
      </span>
      <Show when={showTaskProject()}>
        <SortableHeader label="Project" area="initiative" />
      </Show>
      <SortableHeader label="Assignees" area="assignees" />
      <SortableHeader
        label={
          <Tooltip label="Created by">
            <span class="inline-flex">
              <UserPlusIcon class="size-4" />
              <span class="sr-only">Created by</span>
            </span>
          </Tooltip>
        }
        area="createdBy"
        class="@max-[1220px]/u-list:hidden"
      />
      <SortableHeader
        label="Updated"
        area="timestamp"
        sortId="updated_at"
        align="end"
      />
    </div>
  );
}
