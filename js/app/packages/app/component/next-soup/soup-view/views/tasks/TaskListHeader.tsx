import { Tooltip } from '@core/component/Tooltip';
import { useListLayout } from '@entity/composed/list-entity/shared';
import UsersIcon from '@icon/regular/users.svg';
import StatusInProgress from '@macro-icons/square/task-in-progress-circle.svg';
import PriorityHigh from '@macro-icons/wide/priority-high.svg';
import { cn } from '@ui/utils/classname';
import { For, type JSX, Show } from 'solid-js';
import {
  TASK_GRID_COLUMNS,
  TASK_GRID_TEMPLATE_AREAS_WIDE,
  TASK_GRID_TEMPLATE_COLUMNS_WIDE,
} from './task-grid-template';
import './list-property-value.css';

const HEADER_ICON_CLASS = 'size-3 text-ink-muted';

/** Map column IDs to their icons for narrow mode */
const COLUMN_ICONS: Record<string, () => JSX.Element> = {
  status: () => <StatusInProgress class={HEADER_ICON_CLASS} />,
  priority: () => <PriorityHigh class={HEADER_ICON_CLASS} />,
  assignees: () => <UsersIcon class={HEADER_ICON_CLASS} />,
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
 */
export function TaskListHeader(props: { class?: string }) {
  return (
    <div
      class={cn(
        'task-grid-row z-10 w-full grid items-center gap-2 px-2 h-10',
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
        {(col) => (
          <div
            style={{ 'grid-area': col.id }}
            class="truncate flex items-center min-w-0"
          >
            {/* Wide: show label, Narrow: hide */}
            <span class="truncate @max-[840px]/uList:hidden">{col.label}</span>
            {/* Narrow: show icon with tooltip */}
            <Tooltip
              tooltip={col.label}
              class="hidden @max-[840px]/uList:flex @max-[840px]/uList:px-1.5"
            >
              {COLUMN_ICONS[col.id]?.()}
            </Tooltip>
          </div>
        )}
      </For>
      {/* Created By column - only shown on wide containers (>1220px) */}
      <div
        style={{ 'grid-area': 'createdBy' }}
        class="truncate hidden @min-[1221px]/uList:block"
      >
        Created By
      </div>
      <div style={{ 'grid-area': 'timestamp' }} class="text-right">
        Updated
      </div>
    </div>
  );
}
