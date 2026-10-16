import { SearchBar } from '@app/components/view-shell';
import type { JSX, ParentProps } from 'solid-js';
import { Show } from 'solid-js';

/** Shared toolbar and scrolling content for a record's associated tabs. */
export function RecordSection(
  props: ParentProps<{
    title: string;
    search: string;
    onSearchChange: (value: string) => void;
    searchPlaceholder?: string;
    onSearchEscape?: () => void;
    actions?: JSX.Element;
  }>
) {
  return (
    <section
      aria-label={props.title}
      class="@container/record flex size-full min-h-0 flex-col"
    >
      <div class="flex min-h-12 min-w-0 shrink-0 flex-wrap items-center gap-3 px-4 py-2">
        <SearchBar
          size="sm"
          label={`Search ${props.title.toLowerCase()}`}
          placeholder={
            props.searchPlaceholder ?? `Search ${props.title.toLowerCase()}…`
          }
          class="w-64 max-w-full"
          value={props.search}
          onValueChange={props.onSearchChange}
          onEscape={props.onSearchEscape}
        />
        <Show when={props.actions}>
          <div class="ml-auto flex shrink-0 flex-wrap items-center gap-2.5">
            {props.actions}
          </div>
        </Show>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {props.children}
      </div>
    </section>
  );
}
