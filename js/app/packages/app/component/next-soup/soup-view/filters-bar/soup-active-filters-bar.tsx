import Plus from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn, Dropdown, Layer } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  type ConsolidatedFilter,
  ConsolidatedFilterChip,
} from './consolidated-filter-chip';
import { UnifiedFilterDropdown } from './unified-filter-dropdown';

interface SoupActiveFiltersBarProps {
  filters: ConsolidatedFilter[];
  onClearAll: () => void;
  class?: string;
}

/**
 * A dedicated filter bar that appears at the top of the soup view when there are active filters.
 * Contains filter chips on the left, and add/clear buttons on the right.
 */
const AddFilterButton = () => (
  <Dropdown.Trigger
    variant="ghost"
    size="icon-sm"
    tooltip="Add filters"
    class="p-1 rounded-full"
  >
    <Plus class="size-3" />
  </Dropdown.Trigger>
);

export function SoupActiveFiltersBar(props: SoupActiveFiltersBarProps) {
  const [addFilterOpen, setAddFilterOpen] = createSignal(false);

  return (
    <Show when={props.filters.length > 0}>
      <Layer depth={0}>
        <div class={cn('w-full p-2', props.class)}>
          <div class="flex items-start p-2 border border-edge-muted bg-surface rounded-lg font-medium">
            {/* Filter chips and add button - flex left */}
            <div class="flex items-center gap-2 flex-wrap flex-1 min-w-0">
              <For each={props.filters}>
                {(filter) => <ConsolidatedFilterChip filter={filter} />}
              </For>
              <UnifiedFilterDropdown
                open={() => addFilterOpen()}
                onOpenChange={setAddFilterOpen}
                customTrigger={<AddFilterButton />}
              />
            </div>

            <div class="flex items-center shrink-0">
              <Button
                onClick={() => props.onClearAll()}
                variant="base"
                size="sm"
                class="h-7 rounded-md"
                tooltip="Clear active filters"
              >
                <XIcon />
                <span class="hidden @min-[300px]/split:inline">Clear all</span>
              </Button>
            </div>
          </div>
        </div>
      </Layer>
    </Show>
  );
}
