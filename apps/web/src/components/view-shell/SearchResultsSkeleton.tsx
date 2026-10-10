import '@entity/composed/ListEntity.css';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { cn } from '@ui';
import { For, Show } from 'solid-js';

interface SkeletonResult {
  title: string;
  /** Widths of the content-hit snippet beneath the title, if any. */
  snippet?: [string, string];
}

const RESULTS: SkeletonResult[] = [
  { title: 'w-64', snippet: ['w-72', 'w-28'] },
  { title: 'w-44' },
  { title: 'w-56' },
  { title: 'w-80', snippet: ['w-52', 'w-36'] },
  { title: 'w-36' },
  { title: 'w-60' },
  { title: 'w-72', snippet: ['w-64', 'w-20'] },
  { title: 'w-48' },
];

/**
 * Placeholder rows matching search results (`ListEntity`): the single-line
 * layout below the wide breakpoint, and the wide layout with metadata,
 * timestamp, and content-hit snippets at `@lg` widths.
 */
export function SearchResultsSkeleton(props: {
  class?: string;
  searchingMore?: boolean;
}) {
  return (
    <ListSkeleton.Root
      label={props.searchingMore ? 'Searching for more results' : 'Searching'}
      class={cn('soup-list min-w-0 shrink-0', props.class)}
    >
      <For each={props.searchingMore ? RESULTS.slice(0, 3) : RESULTS}>
        {(result) => (
          <div class="soup-row-narrow mx-(--soup-row-gutter) flex min-h-11 flex-col justify-center pr-2 pl-(--soup-row-padding-l) @lg/u-list:min-h-10 @lg/u-list:py-0.5 @lg/u-list:pl-2 @lg/u-list:[--soup-row-column-gap:0.5rem]">
            <div class="flex h-11 min-w-0 items-center gap-x-(--soup-row-column-gap) @lg/u-list:h-9">
              <div class="w-(--soup-row-indicator-width) shrink-0" />
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <ListSkeleton.Bar class="size-4 shrink-0 rounded" />
                <ListSkeleton.Bar class={result.title} />
              </div>
              <ListSkeleton.Bar class="hidden h-2 w-14 shrink-0 opacity-60 @lg/u-list:block" />
              <ListSkeleton.Bar class="h-2 w-10 shrink-0 opacity-60 @lg/u-list:w-[6ch]" />
            </div>
            <Show when={result.snippet}>
              {(snippet) => (
                <div class="hidden min-w-0 items-center gap-1.5 pb-1.5 pl-[calc(var(--soup-row-indicator-width)+var(--soup-row-column-gap)+1.5rem)] @lg/u-list:flex">
                  <ListSkeleton.Bar
                    class={cn(snippet()[0], 'h-2 opacity-50')}
                  />
                  <ListSkeleton.Bar
                    class={cn(snippet()[1], 'h-2 opacity-50')}
                  />
                </div>
              )}
            </Show>
          </div>
        )}
      </For>
    </ListSkeleton.Root>
  );
}
