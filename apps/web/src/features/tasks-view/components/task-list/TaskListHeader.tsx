import {
  ListColumnHeader,
  type ListColumnHeaderProps,
} from '@app/components/list/ListColumnHeader';
import type { SortSelection } from '@app/features/soup';
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

const SEARCH_SORT: SortSelection<TaskSortId> = { id: 'updated_at' };
function SortableHeader(props: SortableHeaderProps) {
  const { state, source, setPrimarySort } = useTasksView();
  const keepsSearchOrder = () =>
    Boolean(state.search.trim()) && !source.sortsSearchResults;
  const shownSort = () => (keepsSearchOrder() ? SEARCH_SORT : state.sort[0]);
  const sortable = () => !keepsSearchOrder() && props.sortId !== undefined;
  const active = () => {
    const id = shownSort()?.id;
    return (
      id !== undefined && (id === props.sortId || id === props.reverseSortId)
    );
  };
  const reversed = () =>
    active() &&
    (shownSort()?.id === props.reverseSortId || shownSort()?.reversed === true);
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
      onClick={sortable() ? sort : undefined}
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
      <SortableHeader label="Task" area="content" sortId="title" />
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
