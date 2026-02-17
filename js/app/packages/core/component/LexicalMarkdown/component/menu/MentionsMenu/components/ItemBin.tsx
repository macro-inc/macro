import type { Accessor, ParentProps } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '@ui/utils/classname';

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
        <span class="flex items-center gap-1.5">
          {props.label}
          <Show when={props.isSelected && showViewAllButton()}> →</Show>
        </span>
        <Show when={showViewAllButton()}>
          <button
            type="button"
            class="text-xs font-medium hover:text-ink hover:underline"
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
            {viewAllText()}
          </button>
        </Show>
      </div>
      {props.children}
    </>
  );
}
