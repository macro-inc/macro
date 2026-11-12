import {
  ListColumnHeader,
  type ListColumnHeaderProps,
} from '@app/components/list/ListColumnHeader';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import ProjectIcon from '@icon/system/regular/cube.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { Tooltip } from '@ui';
import { Show } from 'solid-js';
import { useTasksView } from '../../tasks-view-context';
import type { TaskSortId } from '../../types';
import { type TaskGridColumnId, taskGridTemplate } from './task-grid-template';

type SortableHeaderProps = Omit<
  ListColumnHeaderProps,
  'onClick' | 'active' | 'reversed'
> & {
  sortId?: TaskSortId;
  reverseSortId?: TaskSortId;
};

function SortableHeader(props: SortableHeaderProps) {
  const { state, setPrimarySort } = useTasksView();
  const active = () =>
    state.sort[0]?.id === props.sortId ||
    (props.reverseSortId !== undefined &&
      state.sort[0]?.id === props.reverseSortId);
  const reversed = () =>
    active() &&
    (state.sort[0]?.id === props.reverseSortId ||
      state.sort[0]?.reversed === true);
  const sort = () => {
    if (!props.sortId) return;
    if (props.reverseSortId && state.sort[0]?.id === props.sortId) {
      setPrimarySort(props.reverseSortId);
      return;
    }
    setPrimarySort(props.sortId);
  };
  return (
    <ListColumnHeader
      {...props}
      active={active()}
      reversed={reversed()}
      onClick={props.sortId ? sort : undefined}
    />
  );
}

export function TaskListHeader(props: {
  columns: readonly TaskGridColumnId[];
  onTimestampWidthChange?: (width: number) => void;
}) {
  const showTaskProject = () => props.columns.includes('initiative');
  return (
    <div
      role="row"
      class="task-grid-row task-grid-icon-creator grid h-10 w-full shrink-0 items-center gap-2 px-3 text-xs font-medium text-ink-extra-muted"
      style={taskGridTemplate(props.columns)}
    >
      <span role="columnheader" style={{ 'grid-area': 'indicator' }} />
      <span
        role="columnheader"
        class="ms-2 truncate"
        style={{ 'grid-area': 'content' }}
      >
        Task
      </span>
      <SortableHeader
        label="Due date"
        area="dueDate"
        sortId="due_date_earliest"
        reverseSortId="due_date_latest"
        narrowIcon={<CalendarIcon class="size-4" />}
      />
      <Show when={showTaskProject()}>
        <SortableHeader
          label="Project"
          area="initiative"
          narrowIcon={<ProjectIcon class="size-4" />}
        />
      </Show>
      <SortableHeader
        label="Assignees"
        area="assignees"
        class="@max-[840px]/u-list:justify-start @max-[840px]/u-list:pl-1"
        narrowIcon={<UsersIcon class="size-4" />}
      />
      <SortableHeader
        label="Updated"
        area="timestamp"
        sortId="updated_at"
        class="task-updated-cell"
        align="end"
        narrowIcon={<ClockIcon class="size-4" />}
        onWidthChange={props.onTimestampWidthChange}
      />
      <span
        role="columnheader"
        aria-label="Created by"
        class="task-creator-cell ms-2 flex items-center justify-end"
        style={{ 'grid-area': 'createdBy' }}
      >
        <Tooltip label="Created by" as="span" tabIndex={0}>
          <UserPlusIcon class="size-4" role="img" aria-label="Created by" />
        </Tooltip>
      </span>
    </div>
  );
}
