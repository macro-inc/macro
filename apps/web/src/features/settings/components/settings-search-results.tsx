import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { SettingsSearchResult } from '../core/settings-search';

export function SettingsSearchResults(props: {
  results: SettingsSearchResult[];
  selectedId?: string;
  onSelect: (result: SettingsSearchResult) => void;
}) {
  return (
    <nav aria-label="Settings search results" class="flex flex-col gap-1">
      <span class="sr-only" role="status">
        {props.results.length} settings found
      </span>
      <Show
        when={props.results.length}
        fallback={
          <div class="px-3 py-6 text-sm text-ink-muted">
            No settings found. Try “signature”, “theme”, or “calendar”.
          </div>
        }
      >
        <For each={props.results}>
          {(result) => (
            <button
              type="button"
              aria-current={props.selectedId === result.id ? 'true' : undefined}
              onClick={() => props.onSelect(result)}
              class="flex w-full items-start gap-(--sidebar-label-gap) rounded-lg px-(--sidebar-item-inset) py-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent aria-[current=true]:bg-active"
            >
              <Dynamic
                component={result.page.icon}
                class="mt-0.5 size-(--sidebar-icon-slot) shrink-0 p-0.5 text-ink"
              />
              <span class="min-w-0">
                <span class="block text-sm leading-5 text-ink">
                  {result.title}
                </span>
                <Show when={result.title !== result.page.label}>
                  <span class="mt-1 block text-sm text-ink/50">
                    {result.page.label}
                  </span>
                </Show>
              </span>
            </button>
          )}
        </For>
      </Show>
    </nav>
  );
}
