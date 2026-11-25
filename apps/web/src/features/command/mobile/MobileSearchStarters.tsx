import { SearchOperatorText } from '@app/components/view-shell/search-operator-text';
import { readsAsEmailSearchOperator } from '@app/features/email-view/search/email-search-operators';
import {
  searchOperatorBeingTyped,
  searchOperatorCompletions,
  searchTokenAtEnd,
} from '@app/features/next-soup/core/search-operator-completions';
import type { SearchOperatorBinding } from '@app/features/next-soup/core/search-operators';
import { SearchOperatorSuggestions } from '@app/features/next-soup/soup-view/filters-bar/search-operator-suggestions';
import { createSearchOperatorValues } from '@app/features/next-soup/soup-view/filters-bar/search-operator-values';
import { t } from '@app/lib/i18n';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { followContentInsetBottom } from '@core/mobile/viewport-insets';
import { type Accessor, createMemo, createUniqueId, For, Show } from 'solid-js';
import {
  SEARCH_DATE_SPANS,
  SEARCH_STARTERS,
  type SearchStarter,
  searchStarterApplies,
  searchStarterLabel,
  searchStarterValue,
  startSearchOperator,
} from './search-starters';

/** The phone Search's field, kept in app chrome by the dock. */
const searchInput = () =>
  document.getElementById('mobile-search-input') as HTMLTextAreaElement | null;

/** Back to the field, the caret after what was written, keyboard up. */
function focusSearchAtEnd() {
  queueMicrotask(() => {
    const input = searchInput();
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

/**
 * The starters across the top of the phone's Search: each writes its
 * operator into the field and opens its suggestions, or edits the one the
 * text already sets, whose value it shows.
 */
export function MobileSearchStarters(props: {
  query: Accessor<string>;
  setQuery: (text: string) => void;
  /** What the opener's tokens stand for, which only these read as operators. */
  bindings?: Accessor<readonly SearchOperatorBinding[]>;
}) {
  const bindings = () => props.bindings?.() ?? [];
  const items = createMemo(() =>
    // A starter whose operator no kind left can meet is left out (Date and
    // Unread beside `type:task`), rather than written as a word.
    SEARCH_STARTERS.filter((starter) =>
      searchStarterApplies(props.query(), starter, bindings())
    ).map((starter) => {
      const set = searchStarterValue(props.query(), starter, bindings());
      return {
        value: starter,
        label: (
          <span class={set ? 'text-accent-ink' : undefined}>
            {searchStarterLabel(starter, set)}
          </span>
        ),
      };
    })
  );
  const start = (starter: SearchStarter) => {
    props.setQuery(startSearchOperator(props.query(), starter, bindings()));
    focusSearchAtEnd();
  };
  return (
    <header
      aria-label={t('searchOperators.starters')}
      class="pointer-events-none absolute inset-x-0 top-0 z-split-panel-chrome flex pt-[calc(var(--safe-top,0px)+0.5rem)]"
    >
      <PillTabs
        scrollable
        contentClass="px-(--mobile-chrome-gutter)"
        items={items()}
        value={undefined}
        onChange={start}
      />
    </header>
  );
}

const DATE_TOKEN = /^(newer_than|older_than|after|before):/i;

/**
 * The rows offered for the operator typed at the end of the phone's field:
 * PR 2's names and values, and for a date operator, spans and a picked date.
 */
export function createMobileSearchSuggestions(
  query: Accessor<string>,
  setQuery: (text: string) => void
) {
  const typing = createMemo(() => searchOperatorBeingTyped(query()));
  const personTyped = () => {
    const typed = typing();
    if (!typed || !('name' in typed)) return undefined;
    const names = ['assignee', 'author', 'from'];
    return names.includes(typed.name) ? typed.value : undefined;
  };
  const values = createSearchOperatorValues(personTyped);
  // Rows open once an operator's colon is typed: offering names for any two
  // letters would cover the results while typing words like "status".
  const rows = createMemo(() => {
    const typed = typing();
    return typed && 'name' in typed
      ? searchOperatorCompletions(query(), values())
      : [];
  });
  // A date operator still being typed, not a whole one such as Unread left
  // at the end when it goes.
  const typesDate = createMemo(() => {
    const token = searchTokenAtEnd(query()) ?? '';
    return DATE_TOKEN.test(token) && !readsAsEmailSearchOperator(token);
  });
  // A whole operator is followed by a space, so the next word starts, as in
  // the desktop field.
  const write = (insert: string, whole: boolean) => {
    const text = query();
    const token = searchTokenAtEnd(text) ?? '';
    setQuery(
      `${text.slice(0, text.length - token.length)}${insert}${whole ? ' ' : ''}`
    );
    focusSearchAtEnd();
  };
  return {
    showing: () => rows().length > 0 || typesDate(),
    rows,
    typesDate,
    pickRow: (index: number) => {
      const row = rows()[index];
      if (row) write(row.insert, row.kind !== 'name');
    },
    pickSpan: (value: string) => write(`newer_than:${value}`, true),
    pickDate: (date: string) => {
      if (date) write(`after:${date.replaceAll('-', '/')}`, true);
    },
  };
}

export type MobileSearchSuggestions = ReturnType<
  typeof createMobileSearchSuggestions
>;

/** The suggestion rows, in place of the results while an operator is typed. */
export function MobileSearchSuggestionRows(props: {
  suggestions: MobileSearchSuggestions;
}) {
  const listId = createUniqueId();
  const keepKeyboard = (event: Event) => event.preventDefault();
  return (
    <div
      ref={followContentInsetBottom}
      data-keep-keyboard
      class="h-full overflow-y-auto overscroll-none px-3 touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)"
    >
      <Show when={props.suggestions.rows().length > 0}>
        <SearchOperatorSuggestions
          inline
          rows={props.suggestions.rows()}
          active={-1}
          listId={listId}
          onPick={props.suggestions.pickRow}
        />
      </Show>
      <Show when={props.suggestions.typesDate()}>
        <div
          role="listbox"
          aria-label={t('searchOperators.starterDate')}
          class="flex flex-col"
        >
          <For each={SEARCH_DATE_SPANS}>
            {(span) => (
              <div
                role="option"
                aria-selected={false}
                class="flex h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-sm text-ink"
                onPointerDown={keepKeyboard}
                onMouseDown={keepKeyboard}
                onClick={() => props.suggestions.pickSpan(span.value)}
              >
                <span class="min-w-0 flex-1 truncate whitespace-pre">
                  <SearchOperatorText
                    parts={[
                      { text: `newer_than:${span.value}`, operator: true },
                    ]}
                  />
                </span>
                <span class="min-w-0 shrink truncate text-xs text-ink-extra-muted">
                  {t(span.label)}
                </span>
              </div>
            )}
          </For>
          <label class="relative flex h-11 min-w-0 items-center rounded-lg px-2 text-sm text-ink">
            {t('searchOperators.pickDate')}
            <input
              type="date"
              aria-label={t('searchOperators.pickDate')}
              class="absolute inset-0 opacity-0"
              onChange={(event) =>
                props.suggestions.pickDate(event.currentTarget.value)
              }
            />
          </label>
        </div>
      </Show>
    </div>
  );
}
