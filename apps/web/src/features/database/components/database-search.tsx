import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import { InputGroup } from '@ui/components/InputGroup';
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import type {
  DatabaseSearchExcerpt,
  DatabaseSearchGroup,
  DatabaseSearchMatch,
} from '../core/database-search';
import type { DatabaseSearchResults } from '../primitives/database-search';

/** A chosen match: the table it is in and its record. */
export type DatabaseSearchChoice = { tableId: string; rowId: string };

/**
 * The toolbar's search over every table of the database. Its state is the
 * block's, so it survives the toolbar remounting on a table switch.
 */
export function DatabaseSearch(props: {
  term: string;
  isOpen: boolean;
  results: DatabaseSearchResults;
  onTermChange: (term: string) => void;
  onOpen: () => void;
  onClose: (restoreFocus: boolean) => void;
  inputRef: (element: HTMLInputElement) => void;
  onChoose: (choice: DatabaseSearchChoice) => void;
}) {
  const listId = createUniqueId();
  const [active, setActive] = createSignal(0);
  const groups = (): DatabaseSearchGroup[] =>
    props.results.status === 'ready' || props.results.status === 'searching'
      ? props.results.groups
      : [];
  const choices = createMemo(() =>
    groups().flatMap((group) =>
      group.matches.map((match) => ({ tableId: group.tableId, match }))
    )
  );
  const optionId = (index: number) => `${listId}-${index}`;
  const choose = (index: number) => {
    const choice = choices()[index];
    if (!choice) return;
    props.onClose(false);
    props.onChoose({ tableId: choice.tableId, rowId: choice.match.rowId });
  };
  let searchButton: HTMLButtonElement | undefined;
  /** Back where the search was opened from, or on its button when that is gone. */
  const closeAndRestore = () => {
    props.onClose(true);
    if (!document.activeElement || document.activeElement === document.body)
      searchButton?.focus();
  };
  const changeTerm = (term: string) => {
    setActive(0);
    props.onTermChange(term);
  };
  return (
    <Show
      when={props.isOpen}
      fallback={
        <button
          ref={searchButton}
          type="button"
          aria-label="Search"
          aria-keyshortcuts="Control+F Meta+F"
          title="Search every table"
          onClick={() => props.onOpen()}
          class="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/50"
        >
          <MagnifyingGlassIcon class="size-3.5" />
        </button>
      }
    >
      <div
        class="relative"
        onFocusOut={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next))
            return;
          props.onClose(false);
        }}
      >
        <InputGroup size="sm" class="w-40 @min-[640px]/view-toolbar:w-56">
          <InputGroup.Addon align="inline-start">
            <MagnifyingGlassIcon class="size-3.5" />
          </InputGroup.Addon>
          <InputGroup.Input
            ref={(element) => {
              props.inputRef(element);
              queueMicrotask(() => element.focus());
            }}
            type="search"
            role="combobox"
            aria-label="Search every table"
            aria-expanded={!!props.term.trim()}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              choices().length ? optionId(active()) : undefined
            }
            placeholder="Search all tables…"
            value={props.term}
            onInput={(event) => changeTerm(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeAndRestore();
              } else if (event.key === 'ArrowDown' && choices().length) {
                event.preventDefault();
                setActive((index) => (index + 1) % choices().length);
              } else if (event.key === 'ArrowUp' && choices().length) {
                event.preventDefault();
                setActive(
                  (index) => (index - 1 + choices().length) % choices().length
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(active());
              }
            }}
            class="text-xs"
          />
          <InputGroup.Addon align="inline-end">
            <InputGroup.Button
              size="icon-xs"
              label={props.term ? 'Clear search' : 'Close search'}
              tooltipDisabled
              onClick={() => {
                if (props.term) changeTerm('');
                else closeAndRestore();
              }}
            >
              <XIcon class="size-3" />
            </InputGroup.Button>
          </InputGroup.Addon>
        </InputGroup>
        <Show when={props.term.trim()}>
          <div
            id={listId}
            role="listbox"
            aria-label="Search results"
            tabIndex={-1}
            class="menu-surface absolute top-full right-0 z-action-menu mt-1 max-h-96 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl p-1.5 text-xs"
          >
            <Switch>
              <Match when={props.results.status === 'failed'}>
                <p class="px-2 py-1.5 text-failure-ink">
                  The search could not finish. Try again.
                </p>
              </Match>
              <Match
                when={props.results.status === 'searching' && !choices().length}
              >
                <p class="px-2 py-1.5 text-ink-muted">Searching…</p>
              </Match>
              <Match
                when={props.results.status === 'ready' && !choices().length}
              >
                <p class="px-2 py-1.5 text-ink-muted">No records match.</p>
              </Match>
            </Switch>
            <For each={groups()}>
              {(group) => (
                <div role="group" aria-label={group.tableName}>
                  <p class="px-2 pt-1.5 pb-1 text-[10px] font-medium text-ink-extra-muted">
                    {group.tableName}
                  </p>
                  <For each={group.matches}>
                    {(match) => {
                      const index = () =>
                        choices().findIndex((choice) => choice.match === match);
                      return (
                        <SearchOption
                          id={optionId(index())}
                          match={match}
                          selected={active() === index()}
                          onHover={() => setActive(index())}
                          onChoose={() => choose(index())}
                        />
                      );
                    }}
                  </For>
                  <Show when={group.more}>
                    <p class="px-2 py-1 text-ink-extra-muted">
                      {group.more} more in {group.tableName}
                    </p>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function SearchOption(props: {
  id: string;
  match: DatabaseSearchMatch;
  selected: boolean;
  onHover: () => void;
  onChoose: () => void;
}) {
  const titleExcerpt = () => {
    const excerpt = props.match.excerpt;
    return excerpt?.columnName === undefined ? excerpt : undefined;
  };
  const fieldExcerpt = () => {
    const excerpt = props.match.excerpt;
    return excerpt?.columnName === undefined ? undefined : excerpt;
  };
  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.selected}
      class="rounded-md px-2 py-1.5"
      classList={{ 'bg-hover': props.selected }}
      onMouseMove={() => {
        if (!props.selected) props.onHover();
      }}
      // Keep focus in the input, so choosing does not first close the search.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => props.onChoose()}
    >
      <Show
        when={titleExcerpt()}
        fallback={
          <p class="truncate font-medium text-ink">{props.match.title}</p>
        }
      >
        {(excerpt) => (
          <p class="truncate font-medium text-ink">
            <Highlighted excerpt={excerpt()} />
          </p>
        )}
      </Show>
      <Show when={fieldExcerpt()}>
        {(excerpt) => (
          <p class="truncate text-ink-muted">
            <span class="text-ink-extra-muted">{excerpt().columnName}: </span>
            <Highlighted excerpt={excerpt()} />
          </p>
        )}
      </Show>
    </div>
  );
}

function Highlighted(props: { excerpt: DatabaseSearchExcerpt }) {
  return (
    <>
      {props.excerpt.before}
      <mark class="rounded-sm bg-accent/20 text-ink">
        {props.excerpt.match}
      </mark>
      {props.excerpt.after}
    </>
  );
}
