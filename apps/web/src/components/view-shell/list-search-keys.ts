import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { getActiveCommandByToken } from '@core/hotkey/utils';
import { onCleanup } from 'solid-js';
import {
  clearListSearch,
  hasListSearch,
  registerListSearch,
} from './list-search-escape';

/**
 * Rows a view lists under the field, such as recent searches. ArrowDown walks
 * them before it reaches the results, and Enter picks the active one.
 */
export type ListSearchSuggestions = {
  count: () => number;
  /** The active row's index, or -1 while the field itself is active. */
  active: () => number;
  setActive: (index: number) => void;
  pick: (index: number) => void;
  /**
   * Whether picking the row edits the query (adds a filter) rather than
   * running a search, so the keyboard stays in the field to go on typing.
   */
  editsQuery?: (index: number) => boolean;
  /** The list's element id and its active row's, announced from the field. */
  listId?: string;
  activeId?: () => string | undefined;
};

export type ListSearchKeysOptions = {
  value: () => string;
  /** Empties the query and collapses the field. */
  clear: () => void;
  /** Moves keyboard focus into the view's result list. */
  focusResults: () => (() => void) | undefined;
  input: () => HTMLInputElement | undefined;
  /** The button that opens the collapsed field. */
  trigger: () => HTMLElement | undefined;
  suggestions?: () => ListSearchSuggestions | undefined;
  /**
   * Whether the results hold a row to land on. Without it the list's own "go
   * to first item" answers, which is any list in the split that registered
   * one last, so a view sharing its split with another list passes this.
   */
  hasResults?: () => boolean;
  /**
   * Whether an Escape pressed away from the field is this search's to clear;
   * without it, any Escape in the split that nothing else takes is.
   */
  ownsEscape?: () => boolean;
};

/**
 * The keys a search field over a list shares, wherever it sits (a list
 * header, or a sidebar that is the list). The field hands the keyboard to the
 * results instead of trapping it: ArrowDown or Enter moves to the first
 * result, and Escape leaves the field with the query and its results intact.
 * Escape pressed again, in the list, clears the search.
 */
export function useListSearchKeys(options: ListSearchKeysOptions) {
  const panel = useSplitPanel();

  // Escape leaves the list where it was; ArrowDown and Enter start at the top.
  // A picked suggestion has started a new search, so its rows are still on
  // their way: the view lands on them when they arrive.
  const leave = (row: 'first' | 'current', rowsPending = false) => {
    const input = options.input();
    // An empty field has no search to keep on screen.
    const collapses = !options.value().trim();
    // Without a list to move to, a collapsed field hands focus to its button.
    const collapseToButton = () => {
      options.clear();
      queueMicrotask(() => options.trigger()?.focus());
    };

    const focusResults = options.focusResults();
    if (!focusResults) {
      input?.blur();
      if (collapses) collapseToButton();
      return;
    }

    // With no rows to land on, ArrowDown and Enter stay with the field, as in
    // a view without a list, so typing goes on.
    if (row === 'first' && !landsOnFirstRow(rowsPending)) return;

    focusResults();
    // A view whose results are not on screen (a tab without a list) has
    // nowhere to send the keyboard: ArrowDown and Enter stay with the field,
    // and Escape leaves it as it would without a list. Escape has already
    // blurred the field, so focus left on the page counts as not moved.
    const focused = document.activeElement;
    if (focused === input || focused === document.body) {
      if (row === 'first') return;

      input?.blur();
      if (collapses) collapseToButton();
      return;
    }

    if (collapses) options.clear();
  };

  // Moves the list to its first row, unless it has none to land on.
  const landsOnFirstRow = (rowsPending: boolean) => {
    if (!rowsPending && options.hasResults?.() === false) return false;

    const landed = goToFirstRow();
    return rowsPending || Boolean(options.hasResults) || landed !== false;
  };

  // Returns whether a suggestion took the key instead of the results.
  const moveInSuggestions = (event: KeyboardEvent) => {
    const suggestions = options.suggestions?.();
    if (!suggestions) return false;

    const active = suggestions.active();
    if (event.key === 'ArrowDown' && active < suggestions.count() - 1) {
      suggestions.setActive(active + 1);
      return true;
    }
    if (event.key === 'ArrowUp' && active >= 0) {
      suggestions.setActive(active - 1);
      return true;
    }
    if (event.key === 'Enter' && active >= 0) {
      const editsQuery = suggestions.editsQuery?.(active) ?? false;
      suggestions.pick(active);
      if (!editsQuery) leave('first', true);
      return true;
    }

    return false;
  };

  // Escape in the list steps back out of the search. A list header's field
  // has left the view whenever a thread or other detail has replaced the
  // list, so that view's own Escape runs instead. A sidebar's field stays
  // beside the detail, so it passes `ownsEscape` to leave that Escape alone.
  if (panel) {
    const scopeId = panel.splitHotkeyScope;
    // A list that overrides the split's Escape clears the search through the
    // same registration, so the step exists whichever handler runs.
    onCleanup(
      registerListSearch(scopeId, {
        isActive: () =>
          options.value().trim().length > 0 && (options.ownsEscape?.() ?? true),
        clear: options.clear,
      })
    );
    registerHotkey({
      hotkey: 'escape',
      scopeId,
      description: 'Clear search',
      condition: () => panel.isPanelActive() && hasListSearch(scopeId),
      keyDownHandler: () => clearListSearch(scopeId),
      registrationType: 'add',
    });
  }

  return {
    onKeyDown: (event: KeyboardEvent) => {
      // A view without a keyboard list keeps the keys for the field.
      if (!options.focusResults()) return;
      if (isComposing(event) || hasModifier(event)) return;
      if (moveInSuggestions(event)) {
        event.preventDefault();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'Enter') return;

      event.preventDefault();
      leave('first');
    },
    onEscape: () => leave('current'),
  };
}

// Safari reports the Enter that commits a composition as not composing; its
// key code still marks it.
function isComposing(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229;
}

function hasModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}

// The list's own "go to first item" also scrolls that row into view. It
// answers false when the list has no rows.
function goToFirstRow() {
  const goToFirst = getActiveCommandByToken(TOKENS.entity.jump.home);
  if (!goToFirst || !(goToFirst.condition?.() ?? true)) return undefined;

  return goToFirst.keyDownHandler?.();
}
