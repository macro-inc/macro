import XIcon from '@phosphor/x.svg';
import { Show } from 'solid-js';
import { cn } from '../utils/classname';

export interface FilteredHiddenBannerProps {
  /**
   * Whether to surface the "Some items are hidden by filters" message.
   * When false the banner collapses to fit just the Clear Filters button.
   * When undefined, defaults to showing the message.
   */
  hasHiddenItems?: boolean;
  onClearFilters: () => void;
}

export function FilteredHiddenBanner(props: FilteredHiddenBannerProps) {
  const showMessage = () => props.hasHiddenItems !== false;
  return (
    <div
      class={cn(
        'flex flex-wrap items-center gap-3 rounded-md border border-edge-muted bg-input/50 px-4 py-3',
        showMessage() ? 'w-full max-w-md justify-between' : 'w-fit'
      )}
    >
      <Show when={showMessage()}>
        <span class="text-sm text-ink-muted">
          Some items are hidden by filters
        </span>
      </Show>
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
