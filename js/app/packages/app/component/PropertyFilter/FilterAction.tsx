import type { PropertyDefinitionFlat } from '@core/component/Properties/types';
import { zSidePanelSearchAndFilter } from '@core/constant/stackingContext';
import type { Component } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import type { FilterAction } from '../PropertyFilterTypes';
import {
  ACTION_DISPLAY_NAMES,
  getValidFilterActions,
} from '../PropertyFilterTypes';

export type FilterActionSelectProps = {
  property: PropertyDefinitionFlat;
  selectedAction: FilterAction | null;
  onSelectAction: (action: FilterAction) => void;
};

export const FilterActionSelect: Component<FilterActionSelectProps> = (
  props
) => {
  const [isOpen, setIsOpen] = createSignal(false);

  let containerRef!: HTMLDivElement;
  let dropdownRef!: HTMLDivElement;

  const validActions = createMemo(() => {
    return getValidFilterActions(
      props.property.data_type,
      props.property.is_multi_select ?? false
    );
  });

  const handleSelectAction = (action: FilterAction) => {
    props.onSelectAction(action);
    setIsOpen(false);
  };

  // Close dropdown when clicking outside
  createEffect(() => {
    if (!isOpen()) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const isInsideContainer = containerRef?.contains(target);
      const isInsideDropdown = dropdownRef?.contains(target);

      if (!isInsideContainer && !isInsideDropdown) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClickOutside);
    });
  });

  return (
    <div ref={containerRef} class="flex relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        class="h-6 px-2 min-w-fit text-[10px] border border-edge hover:bg-hover text-left font-mono cursor-pointer flex items-center"
        classList={{
          'text-ink': props.selectedAction !== null,
          'text-ink-muted': props.selectedAction === null,
        }}
      >
        {props.selectedAction
          ? ACTION_DISPLAY_NAMES[props.selectedAction]
          : '...'}
      </button>
      <Show when={isOpen()}>
        <div
          ref={dropdownRef}
          class="absolute left-0 top-full mt-1 border border-edge bg-menu shadow-lg max-h-48 overflow-y-auto font-mono min-w-[120px]"
          style={{ 'z-index': zSidePanelSearchAndFilter }}
        >
          <Show
            when={validActions().length > 0}
            fallback={
              <div class="px-3 py-2 text-[10px] text-ink-muted text-center">
                No actions available
              </div>
            }
          >
            <For each={validActions()}>
              {(action) => (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectAction(action);
                  }}
                  class="w-full px-2 py-1.5 text-[10px] text-ink hover:bg-hover text-left cursor-pointer"
                  classList={{
                    'bg-hover': props.selectedAction === action,
                  }}
                >
                  {ACTION_DISPLAY_NAMES[action]}
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
};
