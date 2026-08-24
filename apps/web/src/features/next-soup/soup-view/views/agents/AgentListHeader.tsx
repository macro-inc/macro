import { useListLayout } from '@entity/composed/list-entity/shared';
import { cn } from '@ui/utils/classname';
import { For, Show } from 'solid-js';
import {
  AGENT_GRID_COLUMNS,
  AGENT_GRID_TEMPLATE_AREAS_WIDE,
  AGENT_GRID_TEMPLATE_COLUMNS_WIDE,
} from './agent-grid-template';

/**
 * Responsive wrapper that only shows the header when layout is wide.
 * Must be used inside a ListLayoutProvider.
 */
export function ResponsiveAgentListHeader(props: { class?: string }) {
  const layout = useListLayout();
  const isWide = () => layout?.isWide() ?? true;

  return (
    <Show when={isWide()}>
      <AgentListHeader class={props.class} />
    </Show>
  );
}

/**
 * Sticky table header mirroring `AgentGridLayout`'s column template so the
 * labels line up with each row's values. The list is bucketed by attention
 * state rather than sortable columns, so the cells are read-only labels.
 */
function AgentListHeader(props: { class?: string }) {
  return (
    <div
      // px-3 matches each row's total horizontal inset (Entity.Root `mx-1`
      // plus Entity.Layout `px-2`), keeping tracks aligned — same as the
      // task header.
      class={cn(
        'w-full grid items-center gap-2 px-3 h-10',
        'text-xs font-medium text-ink-extra-muted',
        'bg-surface',
        props.class
      )}
      style={{
        'grid-template-columns': AGENT_GRID_TEMPLATE_COLUMNS_WIDE,
        'grid-template-areas': AGENT_GRID_TEMPLATE_AREAS_WIDE,
      }}
    >
      <div style={{ 'grid-area': 'indicator' }} />
      <div style={{ 'grid-area': 'content' }} class="truncate">
        Session
      </div>
      <For each={AGENT_GRID_COLUMNS}>
        {(col) => (
          <div
            style={{ 'grid-area': col.id }}
            class="flex items-center min-w-0"
          >
            <span class="truncate">{col.label}</span>
          </div>
        )}
      </For>
      <div
        style={{ 'grid-area': 'timestamp' }}
        class="flex items-center justify-end min-w-0"
      >
        <span class="truncate">Updated</span>
      </div>
    </div>
  );
}
