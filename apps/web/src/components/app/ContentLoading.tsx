import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { For } from 'solid-js';

const ROW_WIDTHS = ['w-1/2', 'w-2/3', 'w-2/5', 'w-3/5', 'w-3/4', 'w-1/2'];

/**
 * A view's frame while its code or data loads: a header and a few rows, in the
 * same shimmer as list skeletons. Visible immediately, even when the
 * surrounding mobile chrome is hidden.
 */
export function ContentLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      class="flex size-full min-h-24 flex-col overflow-hidden"
    >
      <span class="sr-only">Loading</span>
      <div aria-hidden="true" class="flex h-12 shrink-0 items-center px-4">
        <ListSkeleton.Bar class="h-3 w-24" />
      </div>
      <div aria-hidden="true" class="flex flex-col gap-(--sidebar-row-gap)">
        <For each={ROW_WIDTHS}>
          {(width) => (
            <ListSkeleton.Row class="mx-(--sidebar-gutter)">
              <ListSkeleton.Bar class="size-4 shrink-0 rounded" />
              <ListSkeleton.Bar class={width} />
            </ListSkeleton.Row>
          )}
        </For>
      </div>
    </div>
  );
}
