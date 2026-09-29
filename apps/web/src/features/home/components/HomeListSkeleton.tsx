import '@entity/composed/ListEntity.css';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { For, Show } from 'solid-js';

const TITLE_WIDTHS = [
  'w-3/5',
  'w-4/5',
  'w-1/2',
  'w-2/3',
  'w-3/4',
  'w-1/2',
  'w-4/5',
  'w-3/5',
];

export function HomeListSkeleton(props: {
  grouped?: boolean;
  loadingMore?: boolean;
}) {
  return (
    <ListSkeleton.Root
      label={props.loadingMore ? 'Loading more Home items' : 'Loading Home'}
      class="soup-list min-w-0 shrink-0"
    >
      <Show when={props.grouped && !props.loadingMore}>
        <div class="soup-row-card flex h-7 items-center px-4 touch:pl-(--soup-row-content-inset)">
          <ListSkeleton.Bar class="h-2 w-16" />
        </div>
      </Show>
      <For each={props.loadingMore ? TITLE_WIDTHS.slice(0, 3) : TITLE_WIDTHS}>
        {(width) => (
          <ListSkeleton.Row class="soup-row-card mx-(--sidebar-gutter) my-(--sidebar-row-gap) touch:mx-(--soup-row-gutter) touch:h-16 touch:gap-3 touch:pl-(--soup-row-padding-l) touch:pr-3">
            <div class="flex size-(--sidebar-icon-slot) shrink-0 items-center justify-center touch:size-8 mobile:size-(--soup-inbox-icon-diameter)">
              <ListSkeleton.Bar class="size-4 rounded touch:size-full touch:rounded-full" />
            </div>
            <div class="flex min-w-0 flex-1 flex-col gap-2">
              <ListSkeleton.Bar class={width} />
              <ListSkeleton.Bar class="hidden h-2 w-4/5 opacity-60 touch:block" />
            </div>
          </ListSkeleton.Row>
        )}
      </For>
    </ListSkeleton.Root>
  );
}
