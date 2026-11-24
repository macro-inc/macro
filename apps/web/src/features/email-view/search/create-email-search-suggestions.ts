import type { ListSearchSuggestions } from '@app/components/view-shell/list-search-keys';
import { searchTextRuns } from '@app/components/view-shell/search-operator-text';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import {
  completeEmailSearchOperator,
  EMAIL_SEARCH_VIEWS_LEFT_OUT,
  type EmailSearchOperatorCompletion,
  emailSearchCompletionText,
} from './email-search-operators';
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

/**
 * An `in:` being typed as the field's last token, or a `-in:` that leaves a
 * view out: the view's name so far.
 */
const TYPED_FILTER = /^(-?)in:(\S*)$/i;

/** A row under the search field. */
export type EmailSearchSuggestion =
  | { kind: 'recent'; search: string }
  | { kind: 'view'; scope: EmailSearchScopeId; exclude: boolean }
  | EmailSearchOperatorCompletion;

/** The token typed at the end of the field, with the text before it. */
function typedToken(text: string) {
  const token = searchTextRuns(text).at(-1);
  if (!token || /^\s/.test(token)) return undefined;
  return { before: text.slice(0, text.length - token.length), token };
}

export type EmailSearchSuggestions = ListSearchSuggestions & {
  /**
   * Rows to list, only while the field has focus: the views an `in:` being
   * typed can name; otherwise the operators that finish the token being
   * typed (`sub` gives `subject:`, `is:` its values), then recent searches.
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
  const [focused, setFocusedState] = createSignal(false);
  // Each edit of the search is a new object, so a row picked out by the
  // keyboard before an edit no longer counts, even when the edit brings the
  // same text back: typing changes the rows under it.
  const searchEdit = createMemo(() => ({ search: options.search() }));
  const [activeRow, setActiveRow] = createSignal({
    index: -1,
    edit: searchEdit(),
  });
  const setActive = (index: number) =>
    setActiveRow({ index, edit: searchEdit() });
  const active = () => {
    const row = activeRow();
    if (row.edit !== searchEdit()) return -1;
    return Math.min(row.index, listed().length - 1);
  };
  const [awaitsPickedResults, setAwaitsPickedResults] = createSignal(false);

  // The text split at an `in:` being typed at its end, outside quotes.
  const typedFilter = () => {
    const typed = typedToken(options.search());
    if (!typed || typed.token.includes('"')) return undefined;
    const parts = TYPED_FILTER.exec(typed.token);
    if (!parts) return undefined;

    return {
      before: typed.before,
      exclude: parts[1] === '-',
      prefix: parts[2] ?? '',
    };
  };

  const listed = createMemo((): EmailSearchSuggestion[] => {
    if (!focused()) return [];

    const typing = typedFilter();
    if (typing) {
      const prefix = typing.prefix.toLowerCase();
      const scopes = typing.exclude
        ? EMAIL_SEARCH_VIEWS_LEFT_OUT.filter((scope) =>
            scope.startsWith(prefix)
          )
        : emailSearchScopesStartingWith(prefix);
      return scopes
        .filter(options.scopeAvailable)
        .map((scope) => ({ kind: 'view', scope, exclude: typing.exclude }));
    }

    // Operators whose names or values finish what is typed come first.
    const token = typedToken(options.search())?.token;
    const completions = token ? completeEmailSearchOperator(token) : [];
    const recentRows = matchRecentSearches(
      recent.recent(),
      options.search()
    ).map((search): EmailSearchSuggestion => ({ kind: 'recent', search }));
    return [...completions, ...recentRows].slice(0, MAX_LISTED);
  });

  return {
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
      const index = active();
      return index < 0 ? undefined : searchSuggestionOptionId(index);
    },
    count: () => listed().length,
    active,
    setActive,
    editsQuery: (index) => {
      const kind = listed()[index]?.kind;
      return kind !== undefined && kind !== 'recent';
    },
    pick: (index) => {
      const suggestion = listed()[index];
      if (!suggestion) return;

      match(suggestion)
        .with({ kind: 'recent' }, ({ search }) => {
          options.setSearch(search);
          setAwaitsPickedResults(true);
        })
        // The view replaces the `in:` being typed, where it was typed.
        .with({ kind: 'view' }, ({ scope, exclude }) => {
          const before = typedFilter()?.before ?? '';
          const minus = exclude ? '-' : '';
          options.setSearch(`${before}${minus}in:${scope} `);
          setActive(-1);
        })
        // An operator replaces the token it finishes.
        .with({ kind: 'operator' }, { kind: 'value' }, (completion) => {
          const before = typedToken(options.search())?.before ?? '';
          options.setSearch(
            `${before}${emailSearchCompletionText(completion)}`
          );
          setActive(-1);
        })
        .exhaustive();
    },
    awaitsPickedResults,
    pickedResultsTaken: () => setAwaitsPickedResults(false),
  };
}
