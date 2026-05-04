import { For } from 'solid-js';
import { cn } from '@ui/utils/classname';
import {
  TASK_GRID_COLUMNS,
  TASK_GRID_TEMPLATE_AREAS,
  TASK_GRID_TEMPLATE_COLUMNS,
} from './list-entity/task-grid-template';

/**
 * Sticky table header that mirrors the column template of TaskGridLayout
 * so the column labels line up with the property values in each row.
 */
export function TaskListHeader(props: { class?: string }) {
  return (
    <div
      class={cn(
        'z-10 w-full grid items-center gap-2 px-2 h-10',
        'text-xs font-medium text-ink-extra-muted',
        'bg-panel border-b border-edge-muted',
        props.class
      )}
      style={{
        'grid-template-columns': TASK_GRID_TEMPLATE_COLUMNS,
        'grid-template-areas': TASK_GRID_TEMPLATE_AREAS,
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
            class="truncate flex items-center"
          >
            {col.label}
          </div>
        )}
      </For>
      <div style={{ 'grid-area': 'timestamp' }} class="text-right">
        Updated
      </div>
    </div>
  );
}
