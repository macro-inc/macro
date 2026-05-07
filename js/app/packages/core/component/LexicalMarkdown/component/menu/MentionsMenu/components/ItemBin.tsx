import { cn } from '@ui';
import type { Accessor, ParentProps } from 'solid-js';
import { Show } from 'solid-js';

export function ItemBin(
  props: ParentProps<{
    label: string;
    binType: string;
    isNextPage?: Accessor<boolean>;
    totalCount?: number;
    showingCount?: number;
    onViewAll?: (binType: string) => void;
    isSelected?: boolean;
  }>
) {
  const showViewAllButton = () => {
    return (
      (props.totalCount !== undefined &&
        props.showingCount !== undefined &&
        props.totalCount > props.showingCount) ||
      props.isNextPage?.() === true
    );
  };

  const viewAllText = () => {
    if (
      props.totalCount &&
      props.showingCount &&
      props.totalCount > props.showingCount
    ) {
      return `View all (${props.totalCount})`;
    }
    if (props.isNextPage?.()) {
      return 'View all';
    }
    return 'View all';
  };

  return (
    <>
      <div
        class={cn(
          'text-xs font-medium p-2 pt-0 flex justify-between items-center',
          props.isSelected ? 'text-ink-muted' : 'text-ink-extra-muted'
        )}
      >
        <span class="flex items-center gap-1.5">{props.label}</span>
        <Show when={showViewAllButton()}>
          <button
            type="button"
            class="text-xs font-medium hover:text-ink hover:underline flex items-center gap-1"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onViewAll?.(props.binType);
            }}
          >
            <Show when={props.isSelected && showViewAllButton()}>
              <div class="p-0.5 px-1 -my-2 bg-panel text-ink border border-edge-muted rounded-xs text-xs">
                →
              </div>
            </Show>
            {viewAllText()}
          </button>
        </Show>
      </div>
      {props.children}
    </>
  );
}
