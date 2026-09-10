import ArrowDownIcon from '@phosphor/arrow-down.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { useTasksView } from '../../tasks-view-context';
import type { TaskSortId } from '../../types';
import {
  TASK_GRID_TEMPLATE_AREAS_WIDE,
  TASK_GRID_TEMPLATE_COLUMNS_WIDE,
} from './task-grid-template';

function SortableHeader(props: {
  label: string;
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
  return (
    <div
      role="row"
      class="task-grid-row grid h-10 w-full shrink-0 items-center gap-2 bg-surface px-3 text-xs font-medium text-ink-extra-muted"
      style={{
        'grid-template-columns': TASK_GRID_TEMPLATE_COLUMNS_WIDE,
        'grid-template-areas': TASK_GRID_TEMPLATE_AREAS_WIDE,
      }}
    >
      <span role="columnheader" style={{ 'grid-area': 'indicator' }} />
      <span
        role="columnheader"
        class="truncate"
        style={{ 'grid-area': 'content' }}
      >
        Task
      </span>
      <SortableHeader label="Status" area="status" />
      <SortableHeader label="Priority" area="priority" />
      <SortableHeader label="Assignees" area="assignees" />
      <SortableHeader
        label="Created By"
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
