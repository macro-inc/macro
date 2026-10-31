import ArrowDownIcon from '@icon/system/regular/arrow-down.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import ProjectIcon from '@icon/system/regular/cube.svg';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { cn, Tooltip } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { useTasksView } from '../../tasks-view-context';
import type { TaskSortId } from '../../types';
import { type TaskGridColumnId, taskGridTemplate } from './task-grid-template';

function SortableHeader(props: {
  label: string;
  area: string;
  sortId?: TaskSortId;
  align?: 'start' | 'end';
  class?: string;
  narrowIcon?: JSX.Element;
  onWidthChange?: (width: number) => void;
}) {
  const { state, setPrimarySort } = useTasksView();
  const active = () => state.sort[0]?.id === props.sortId;
  const reversed = () => active() && state.sort[0]?.reversed === true;
  const alignment = () => {
    if (props.align === 'end') return 'justify-end';
    return 'justify-start';
  };
  const label = () => (
    <>
      <span class={props.narrowIcon ? '@max-[840px]/u-list:hidden' : undefined}>
        {props.label}
      </span>
      <Show when={props.narrowIcon}>
        <span class="hidden @max-[840px]/u-list:inline-flex">
          <Tooltip
            label={props.label}
            as="span"
            tabIndex={props.sortId ? undefined : 0}
          >
            {props.narrowIcon}
          </Tooltip>
        </span>
      </Show>
    </>
  );

  return (
    <div
      role="columnheader"
      aria-label={props.label}
      class={cn(
        'ms-2 flex min-w-0 items-center',
        alignment(),
        props.narrowIcon &&
          props.align !== 'end' &&
          '@max-[840px]/u-list:justify-center',
        props.class
      )}
      style={{ 'grid-area': props.area }}
    >
      <Switch>
        <Match when={props.sortId}>
          {(sortId) => (
            <button
              ref={(element) => {
                if (props.onWidthChange) {
                  createResizeObserver(element, ({ width }) =>
                    props.onWidthChange?.(width)
                  );
                }
              }}
              type="button"
              aria-label={props.label}
              data-blocks-navigation
              class={cn(
                'flex h-full w-max shrink-0 items-center gap-1 whitespace-nowrap text-ink-extra-muted hover:text-ink',
                active() && 'text-ink'
              )}
              onClick={() => setPrimarySort(sortId())}
            >
              {label()}
              <ArrowDownIcon
                class={cn(
                  'size-3 shrink-0 transition-transform',
                  reversed() && 'rotate-180'
                )}
              />
            </button>
          )}
        </Match>
        <Match when={true}>
          <span class="truncate">{label()}</span>
        </Match>
      </Switch>
    </div>
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
