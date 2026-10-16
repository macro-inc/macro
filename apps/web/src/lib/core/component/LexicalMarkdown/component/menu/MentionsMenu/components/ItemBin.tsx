import ArrowRightIcon from '@phosphor/arrow-right.svg';
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
      props.totalCount !== undefined &&
      props.showingCount !== undefined &&
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
            class="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-normal text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/30"
            aria-keyshortcuts={props.isSelected ? 'ArrowRight' : undefined}
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
            <Show when={props.isSelected}>
              <ArrowRightIcon class="size-3 text-ink-extra-muted" />
            </Show>
          </button>
        </Show>
      </div>
      {props.children}
    </>
  );
}
