import type { ListSearchSuggestions } from '@app/components/view-shell/list-search-keys';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import {
  createRecentEmailSearches,
  matchRecentSearches,
} from './recent-searches';

export const RECENT_SEARCHES_LIST_ID = 'email-recent-searches';
export const recentSearchOptionId = (index: number) =>
  `${RECENT_SEARCHES_LIST_ID}-${index}`;

/** A handful stays above the results without pushing them off screen. */
const MAX_LISTED = 5;

export type EmailSearchSuggestions = ListSearchSuggestions & {
  /** The header's search field is open, so it owns the header. */
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
  /** Recent searches to list: only while the field has focus. */
  listed: Accessor<string[]>;
  setFocused: (focused: boolean) => void;
  /**
   * A picked search has no results yet when the keyboard moves to the list,
   * so the list takes its first row once they arrive. Typing again cancels.
   */
  awaitsPickedResults: Accessor<boolean>;
  pickedResultsTaken: () => void;
};

/**
 * Recent searches offered under Email's search field. A search is remembered
 * once the field is left with it, not on every keystroke.
 */
export function createEmailSearchSuggestions(options: {
  userId: Accessor<string | undefined>;
  search: Accessor<string>;
  setSearch: (search: string) => void;
}): EmailSearchSuggestions {
  const recent = createRecentEmailSearches(options.userId);
  const [open, setOpen] = createSignal(false);
  const [focused, setFocusedState] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const [awaitsPickedResults, setAwaitsPickedResults] = createSignal(false);

  const listed = createMemo(() =>
    focused()
      ? matchRecentSearches(recent.recent(), options.search()).slice(
          0,
          MAX_LISTED
        )
      : []
  );

  return {
    open,
    setOpen,
    listed,
    setFocused: (next) => {
      if (next) setAwaitsPickedResults(false);
      else recent.add(options.search());

      setActive(-1);
      setFocusedState(next);
    },
    listId: RECENT_SEARCHES_LIST_ID,
    activeId: () => {
      const index = Math.min(active(), listed().length - 1);
      return index < 0 ? undefined : recentSearchOptionId(index);
    },
    count: () => listed().length,
    // Typing can shorten the list under the active row.
    active: () => Math.min(active(), listed().length - 1),
    setActive,
    pick: (index) => {
      const query = listed()[index];
      if (query === undefined) return;

      options.setSearch(query);
      setAwaitsPickedResults(true);
    },
    awaitsPickedResults,
    pickedResultsTaken: () => setAwaitsPickedResults(false),
  };
}
