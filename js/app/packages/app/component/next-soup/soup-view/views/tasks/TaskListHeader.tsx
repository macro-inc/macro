import type { SystemSortOption } from '@app/component/next-soup/soup-view/sort-options';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useListLayout } from '@entity/composed/list-entity/shared';
import ArrowDownIcon from '@icon/arrow-down.svg';
import UsersIcon from '@icon/users.svg';
import StatusInProgress from '@macro-icons/square/task-in-progress-circle.svg';
import PriorityHigh from '@macro-icons/wide/priority-high.svg';
import { cn } from '@ui/utils/classname';
import { createMemo, For, type JSX, Show } from 'solid-js';
import {
  TASK_GRID_COLUMNS,
  TASK_GRID_TEMPLATE_AREAS_WIDE,
  TASK_GRID_TEMPLATE_COLUMNS_WIDE,
} from './task-grid-template';
import './list-property-value.css';
import { Tooltip } from '@ui';

const HEADER_ICON_CLASS = 'size-3 text-ink-muted';

/** Map column IDs to their icons for narrow mode */
const COLUMN_ICONS: Record<string, () => JSX.Element> = {
  status: () => <StatusInProgress class={HEADER_ICON_CLASS} />,
  priority: () => <PriorityHigh class={HEADER_ICON_CLASS} />,
  assignees: () => <UsersIcon class={HEADER_ICON_CLASS} />,
};

/** Which `TASK_GRID_COLUMNS.id` values map to a sort key (others are read-only). */
const COLUMN_SORT_KEYS: Partial<Record<string, SystemSortOption>> = {
  status: 'status',
  priority: 'priority',
};

/**
 * Responsive wrapper that only shows the header when layout is wide.
 * Must be used inside a ListLayoutProvider.
 */
export function ResponsiveTaskListHeader(props: { class?: string }) {
  const layout = useListLayout();
  const isWide = () => layout?.isWide() ?? true;

  return (
    <Show when={isWide()}>
      <TaskListHeader class={props.class} />
    </Show>
  );
}

/**
 * Sticky table header that mirrors the column template of TaskGridLayout
 * so the column labels line up with the property values in each row.
 *
 * Status, Priority, and Updated columns are clickable to set the active sort.
 */
export function TaskListHeader(props: { class?: string }) {
  const { soup } = useSoupView();
  const activeSort = createMemo(() => soup.sort.active()[0]);
  const setSort = (id: SystemSortOption) => {
    if (activeSort()?.id === id) {
      soup.sort.flip(id);
    } else {
      soup.sort.setAll([id]);
    }
  };

  return (
    <div
      class={cn(
        'task-grid-row w-full grid items-center gap-2 px-2 h-10',
        'text-xs font-medium text-ink-extra-muted',
        'bg-surface',
        props.class
      )}
      style={{
        'grid-template-columns': TASK_GRID_TEMPLATE_COLUMNS_WIDE,
        'grid-template-areas': TASK_GRID_TEMPLATE_AREAS_WIDE,
      }}
    >
      <div style={{ 'grid-area': 'indicator' }} />
      <div style={{ 'grid-area': 'content' }} class="truncate">
        Task
      </div>
      <For each={TASK_GRID_COLUMNS}>
        {(col) => {
          const sortKey = COLUMN_SORT_KEYS[col.id];
          return (
            <HeaderCell
              gridArea={col.id}
              label={col.label}
              sortKey={sortKey}
              active={sortKey !== undefined && activeSort()?.id === sortKey}
              reversed={activeSort()?.reversed ?? false}
              onSort={setSort}
              narrowIcon={COLUMN_ICONS[col.id]}
            />
          );
        }}
      </For>
      {/* Created By column - only shown on wide containers (>1220px) */}
      <HeaderCell
        gridArea="createdBy"
        label="Created By"
        class="hidden @min-[1221px]/u-list:flex truncate"
      />
      <HeaderCell
        gridArea="timestamp"
        label="Updated"
        sortKey="updated_at"
        active={activeSort()?.id === 'updated_at'}
        reversed={activeSort()?.reversed ?? false}
        onSort={setSort}
        align="end"
      />
    </div>
  );
}

function HeaderCell(props: {
  gridArea: string;
  label: string;
  sortKey?: SystemSortOption;
  active?: boolean;
  reversed?: boolean;
  onSort?: (id: SystemSortOption) => void;
  narrowIcon?: () => JSX.Element;
  align?: 'start' | 'end';
  class?: string;
}) {
  const justify = () =>
    props.align === 'end' ? 'justify-end' : 'justify-start';

  return (
    <div
      style={{ 'grid-area': props.gridArea }}
      class={cn('flex items-center min-w-0', props.class)}
    >
      <Show
        when={props.sortKey}
        fallback={
          <div class={cn('flex items-center min-w-0 w-full', justify())}>
            <Show when={props.narrowIcon}>
              <span class="truncate @max-[840px]/u-list:hidden">
                {props.label}
              </span>
              <span class="hidden @max-[840px]/u-list:flex @max-[840px]/u-list:px-1.5">
                {props.narrowIcon?.()}
              </span>
            </Show>
            <Show when={!props.narrowIcon}>
              <span class="truncate">{props.label}</span>
            </Show>
          </div>
        }
      >
        {(sortKey) => (
          <button
            type="button"
            onClick={() => props.onSort?.(sortKey())}
            class={cn(
              'flex items-center gap-1 min-w-0 w-full h-full',
              'hover:text-ink transition-colors cursor-pointer',
              props.active && 'text-ink',
              justify()
            )}
          >
            <Show when={props.narrowIcon}>
              <Tooltip label={props.label}>{props.narrowIcon?.()}</Tooltip>
            </Show>
            <span class="truncate @max-[840px]/u-list:hidden">
              {props.label}
            </span>
            <ArrowDownIcon
              class={cn(
                'size-3 shrink-0 @max-[840px]/u-list:hidden transition-transform',
                props.active ? 'text-ink' : 'text-ink-extra-muted',
                props.active && props.reversed && 'rotate-180'
              )}
            />
          </button>
        )}
      </Show>
    </div>
  );
}
