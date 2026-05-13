import type { SystemSortOption } from '@app/component/next-soup/soup-view/sort-options';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useListLayout } from '@entity/composed/list-entity/shared';
import ArrowDownIcon from '@icon/regular/arrow-down.svg';
import UsersIcon from '@icon/regular/users.svg';
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
  const activeSortId = createMemo(() => soup.sort.active()[0]?.id);
  const setSort = (id: SystemSortOption) => soup.sort.setAll([id]);
  const reverseSort = (id: SystemSortOption) => soup.sort.toggleDirection(id);

  return (
    <div
      class={cn(
        'task-grid-row w-full grid items-center gap-2 px-2 h-10',
        'text-xs font-medium text-ink-extra-muted',
        'bg-panel border-b border-edge-muted',
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
          const isActive = () =>
            sortKey !== undefined && activeSortId() === sortKey;
          return (
            <HeaderCell
              gridArea={col.id}
              label={col.label}
              sortKey={sortKey}
              active={isActive()}
              reversed={
                sortKey !== undefined &&
                isActive() &&
                soup.sort.isReversed(sortKey)
              }
              onSort={setSort}
              onReverse={reverseSort}
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
        active={activeSortId() === 'updated_at'}
        reversed={
          activeSortId() === 'updated_at' && soup.sort.isReversed('updated_at')
        }
        onSort={setSort}
        onReverse={reverseSort}
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
  onReverse?: (id: SystemSortOption) => void;
  narrowIcon?: () => JSX.Element;
  align?: 'start' | 'end';
  class?: string;
}) {
  const justify = () =>
    props.align === 'end' ? 'justify-end' : 'justify-start';

  return (
    <div
      style={{ 'grid-area': props.gridArea }}
      class={cn('flex items-center min-w-0 pl-2', props.class)}
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
          <Tooltip
            label={`Sort by ${props.label.toLowerCase()}, shift-click to reverse`}
          >
            <button
              type="button"
              onClick={(e) => {
                if (e.shiftKey) props.onReverse?.(sortKey());
                else props.onSort?.(sortKey());
              }}
              class={cn(
                'flex items-center gap-1 min-w-0 w-full h-full select-none',
                'hover:text-ink transition-colors',
                props.active && 'text-ink',
                justify()
              )}
            >
              <Show when={props.narrowIcon}>{props.narrowIcon?.()}</Show>
              <span class="truncate @max-[840px]/u-list:hidden">
                {props.label}
              </span>
              <ArrowDownIcon
                class={cn(
                  'size-3 shrink-0 @max-[840px]/u-list:hidden transition-transform',
                  props.active ? 'text-ink' : 'text-ink-extra-muted',
                  props.reversed && 'rotate-180'
                )}
              />
            </button>
          </Tooltip>
        )}
      </Show>
    </div>
  );
}
