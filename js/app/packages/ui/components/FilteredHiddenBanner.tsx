import XIcon from '@phosphor/x.svg';
import { Show } from 'solid-js';

export interface FilteredHiddenBannerProps {
  hiddenCount?: number;
  itemLabel?: string;
  onClearFilters: () => void;
}

export function FilteredHiddenBanner(props: FilteredHiddenBannerProps) {
  return (
    <div class="flex w-full max-w-md flex-wrap items-center justify-between gap-3 rounded-md border border-edge-muted bg-input/50 px-4 py-3">
      <div class="flex items-baseline gap-2 text-sm">
        <Show
          when={props.hiddenCount !== undefined}
          fallback={
            <span class="text-ink-muted">Some items are hidden by filters</span>
          }
        >
          <span class="font-semibold text-ink">
            {props.hiddenCount}{' '}
            {props.itemLabel ?? (props.hiddenCount === 1 ? 'item' : 'items')}
          </span>
          <span class="text-ink-muted">hidden by filters</span>
        </Show>
      </div>
      <button
        type="button"
        onClick={props.onClearFilters}
        class="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:text-accent transition-colors"
      >
        Clear Filters
        <XIcon class="size-3.5" />
      </button>
    </div>
  );
}
