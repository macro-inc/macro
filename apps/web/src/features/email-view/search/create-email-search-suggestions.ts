import type { ListSearchSuggestions } from '@app/components/view-shell/list-search-keys';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import {
  completeEmailSearch,
  type EmailSearchScopeId,
  emailSearchScopesStartingWith,
  parseEmailSearch,
} from './email-search-scope';
import {
  createRecentEmailSearches,
  matchRecentSearches,
} from './recent-searches';

export const SEARCH_SUGGESTIONS_LIST_ID = 'email-search-suggestions';
export const searchSuggestionOptionId = (index: number) =>
  `${SEARCH_SUGGESTIONS_LIST_ID}-${index}`;

/** A handful stays above the results without pushing them off screen. */
const MAX_LISTED = 5;

/** An `in:` being typed at the end of the field: the view's name so far. */
const TYPED_FILTER = /(?:^|\s)in:(\S*)$/i;

/** A row under the search field. */
export type EmailSearchSuggestion =
  | { kind: 'recent'; search: string }
  | { kind: 'view'; scope: EmailSearchScopeId };

export type EmailSearchSuggestions = ListSearchSuggestions & {
  /** The header's search field is open, so it owns the header. */
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
  /**
   * Rows to list, only while the field has focus: the views an `in:` being
   * typed can name, otherwise recent searches.
   */
  listed: Accessor<EmailSearchSuggestion[]>;
  setFocused: (focused: boolean) => void;
  /**
   * A picked search has no results yet when the keyboard moves to the list,
   * so the list takes its first row once they arrive. Typing again cancels.
   */
  awaitsPickedResults: Accessor<boolean>;
  pickedResultsTaken: () => void;
};

/**
 * The rows offered under Email's search field. A search is remembered once
 * the field is left with words in it, not on every keystroke, and with its
 * `in:` filter.
 */
export function createEmailSearchSuggestions(options: {
  userId: Accessor<string | undefined>;
  search: Accessor<string>;
  setSearch: (search: string) => void;
  /** Whether the person has the view, such as Focus behind its flag. */
  scopeAvailable: (scope: EmailSearchScopeId) => boolean;
}): EmailSearchSuggestions {
  const recent = createRecentEmailSearches(options.userId);
  const [open, setOpen] = createSignal(false);
  const [focused, setFocusedState] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const [awaitsPickedResults, setAwaitsPickedResults] = createSignal(false);

  // The text split at an `in:` being typed at its end.
  const typedFilter = () => {
    const text = options.search();
    const typed = TYPED_FILTER.exec(text);
    if (!typed) return undefined;

    return {
      before: text.slice(0, typed.index),
      prefix: typed[1] ?? '',
    };
  };

  const listed = createMemo((): EmailSearchSuggestion[] => {
    if (!focused()) return [];

    const typing = typedFilter();
    if (typing) {
      return emailSearchScopesStartingWith(typing.prefix)
        .filter(options.scopeAvailable)
        .map((scope) => ({ kind: 'view', scope }));
    }

    return matchRecentSearches(recent.recent(), options.search())
      .slice(0, MAX_LISTED)
      .map((search) => ({ kind: 'recent', search }));
  });

  return {
    open,
    setOpen,
    listed,
    setFocused: (next) => {
      if (next) setAwaitsPickedResults(false);
      // Remembered as it searched, without an `in:` still being typed.
      else if (parseEmailSearch(options.search()).query)
        recent.add(completeEmailSearch(options.search()));

      setActive(-1);
      setFocusedState(next);
    },
    listId: SEARCH_SUGGESTIONS_LIST_ID,
    activeId: () => {
      const index = Math.min(active(), listed().length - 1);
      return index < 0 ? undefined : searchSuggestionOptionId(index);
    },
    count: () => listed().length,
    // Typing can shorten the list under the active row.
    active: () => Math.min(active(), listed().length - 1),
    setActive,
    editsQuery: (index) => listed()[index]?.kind === 'view',
    pick: (index) => {
      const suggestion = listed()[index];
      if (!suggestion) return;

      // The view replaces the `in:` being typed, where it was typed.
      if (suggestion.kind === 'view') {
        const before = typedFilter()?.before ?? '';
        options.setSearch(
          `${before}${before ? ' ' : ''}in:${suggestion.scope} `
        );
        setActive(-1);
        return;
      }

      options.setSearch(suggestion.search);
      setAwaitsPickedResults(true);
    },
    awaitsPickedResults,
    pickedResultsTaken: () => setAwaitsPickedResults(false),
  };
}
