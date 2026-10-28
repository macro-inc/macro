import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { For } from 'solid-js';

/** One conversation-shaped placeholder for target resolution and message loading. */
export function ChannelLoading() {
  return (
    <div
      role="status"
      aria-label="Loading conversation"
      class="flex min-h-0 flex-1 flex-col justify-center overflow-hidden px-5 py-6 touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)"
    >
      <span class="sr-only">Loading conversation</span>
      <div
        aria-hidden="true"
        class="mx-auto flex w-full max-w-160 flex-col gap-7"
      >
        <For each={[64, 86, 73]}>
          {(width) => (
            <div class="flex gap-3">
              <ListSkeleton.Bar class="size-7 shrink-0 rounded-full" />
              <div class="flex min-w-0 flex-1 flex-col gap-3">
                <ListSkeleton.Bar class="w-24" />
                <div style={{ width: `${width}%` }}>
                  <ListSkeleton.Bar class="w-full" />
                </div>
                <ListSkeleton.Bar class="w-2/5" />
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
