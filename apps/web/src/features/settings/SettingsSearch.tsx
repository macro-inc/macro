import { getSettingsTabItem } from '@core/constant/settingsTabsConfig';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import { Button, NavRow } from '@ui';
import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type {
  SettingsSearchEntry,
  SettingsSearchResult,
} from './settingsSearch';

/**
 * The search field at the top of the settings sidebar plus, while a query is
 * typed, the ranked results that stand in for the category groups. Results are
 * pages and things inside pages (see `settingsSearch.ts`); picking one opens
 * its page. Arrow keys move the highlight, Enter opens it, Escape clears the
 * query (or hands off to `onEscape` when there's nothing to clear).
 */
export function SettingsSearch(props: {
  query: string;
  onQueryChange: (query: string) => void;
  results: SettingsSearchResult[];
  onSelect: (entry: SettingsSearchEntry) => void;
  /** Escape pressed on an already-empty field. */
  onEscape?: () => void;
}) {
  const [highlighted, setHighlighted] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const searching = () => props.query.trim().length > 0;

  // A new result set means the old highlight index points at something else.
  createEffect(
    on(
      () => props.results,
      () => setHighlighted(0)
    )
  );

  const clear = () => {
    props.onQueryChange('');
    inputRef?.focus();
  };

  const select = (entry: SettingsSearchEntry) => {
    props.onSelect(entry);
    props.onQueryChange('');
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        setHighlighted((i) => Math.min(i + 1, props.results.length - 1));
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        setHighlighted((i) => Math.max(i - 1, 0));
        break;
      }
      case 'Enter': {
        const result = props.results[highlighted()];
        if (result) {
          event.preventDefault();
          select(result.entry);
        }
        break;
      }
      case 'Escape': {
        event.preventDefault();
        if (searching()) clear();
        else props.onEscape?.();
        break;
      }
    }
  };

  return (
    <>
      <div class="relative flex items-center">
        <MagnifyingGlassIcon class="pointer-events-none absolute left-2.5 size-4 text-ink-extra-muted" />
        <input
          ref={inputRef}
          type="text"
          class="settings-input h-8 w-full pl-8 pr-8 text-xs"
          placeholder="Search settings"
          aria-label="Search settings"
          autocomplete="off"
          spellcheck={false}
          value={props.query}
          onInput={(event) => props.onQueryChange(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <Show when={props.query}>
          <Button
            variant="ghost"
            size="icon-xs"
            class="absolute right-1.5 rounded-md"
            label="Clear search"
            aria-label="Clear search"
            onClick={clear}
          >
            <XIcon class="size-3.5" />
          </Button>
        </Show>
      </div>

      <Show when={searching()}>
        <Show
          when={props.results.length > 0}
          fallback={
            <p class="px-2 py-1.5 text-xs text-ink-extra-muted">
              No settings match “{props.query.trim()}”
            </p>
          }
        >
          <div class="flex flex-col" role="listbox" aria-label="Search results">
            <For each={props.results}>
              {(result, index) => (
                <SearchResultRow
                  entry={result.entry}
                  highlighted={highlighted() === index()}
                  onHighlight={() => setHighlighted(index())}
                  onSelect={() => select(result.entry)}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
    </>
  );
}

function SearchResultRow(props: {
  entry: SettingsSearchEntry;
  highlighted: boolean;
  onHighlight: () => void;
  onSelect: () => void;
}) {
  const icon = () => getSettingsTabItem(props.entry.tab)?.icon;
  // Inner results say where they live ("Connections · MCP integrations") since
  // the title alone ("Linear") doesn't tell you which page opens.
  const breadcrumb = () =>
    props.entry.section
      ? `${props.entry.page} · ${props.entry.section}`
      : props.entry.page;

  return (
    <NavRow
      role="option"
      aria-selected={props.highlighted}
      active={props.highlighted}
      class="px-2 py-1.5 text-xs"
      onClick={(event: MouseEvent) => {
        event.preventDefault();
        props.onSelect();
      }}
      onMouseMove={props.onHighlight}
    >
      <Show when={icon()}>
        {(icon) => (
          <div class="size-4 shrink-0">
            <Dynamic component={icon()} />
          </div>
        )}
      </Show>
      <span class="flex min-w-0 flex-col items-start text-left">
        <span class="w-full truncate">{props.entry.title}</span>
        <Show when={!props.entry.isPage}>
          <span class="w-full truncate text-[11px] text-ink-extra-muted">
            {breadcrumb()}
          </span>
        </Show>
      </span>
    </NavRow>
  );
}
