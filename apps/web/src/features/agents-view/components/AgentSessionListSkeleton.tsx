import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { cn } from '@ui';
import { For, Show } from 'solid-js';

const TITLE_WIDTHS = ['w-3/5', 'w-4/5', 'w-1/2', 'w-2/3', 'w-3/4', 'w-1/2'];

export function AgentSessionListSkeleton(props: { loadingMore?: boolean }) {
  return (
    <ListSkeleton.Root
      label={
        props.loadingMore
          ? 'Loading more conversations'
          : 'Loading conversations'
      }
      class="shrink-0"
    >
      <div class="flex flex-col gap-(--sidebar-row-gap)">
        <For each={props.loadingMore ? TITLE_WIDTHS.slice(0, 3) : TITLE_WIDTHS}>
          {(width, index) => (
            <ListSkeleton.Row
              class={cn(index() % 3 === 1 && 'h-12 touch:h-12')}
            >
              <div class="flex size-(--sidebar-icon-slot) shrink-0 items-center justify-center">
                <ListSkeleton.Bar class="size-1.5" />
              </div>
              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <div class="flex items-center gap-3">
                  <div class="min-w-0 flex-1">
                    <ListSkeleton.Bar class={width} />
                  </div>
                  <ListSkeleton.Bar class="h-2 w-5 shrink-0" />
                </div>
                <Show when={index() % 3 === 1}>
                  <ListSkeleton.Bar class="h-2 w-2/3 opacity-60" />
                </Show>
              </div>
            </ListSkeleton.Row>
          )}
        </For>
      </div>
    </ListSkeleton.Root>
  );
}
