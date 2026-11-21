import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { cn } from '@ui';
import { For } from 'solid-js';

/** Placeholders the size of mention rows, for rows still loading. */
export function MentionLoadingRows(props: {
  count: number;
  label: string;
  rowClass?: string;
  /** Keeps the rows' space without drawing them yet. */
  blank?: boolean;
}) {
  return (
    <ListSkeleton.Root
      label={props.label}
      class={props.blank ? 'invisible' : undefined}
    >
      <For each={Array.from({ length: props.count })}>
        {() => (
          <div
            class={cn(
              'mx-1.5 flex h-7 items-center p-1.5 sm:h-8',
              props.rowClass
            )}
          >
            <ListSkeleton.Bar class="mr-2 size-4" />
            <ListSkeleton.Bar class="w-32" />
          </div>
        )}
      </For>
    </ListSkeleton.Root>
  );
}
