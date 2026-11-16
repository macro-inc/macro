import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { getActiveCommandByToken } from '@core/hotkey/utils';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { Button, cn } from '@ui';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import {
  clearListSearch,
  hasListSearch,
  registerListSearch,
} from './list-search-escape';
import { SearchBar } from './SearchBar';
import { ViewShell } from './ViewShell';

export function ListHeader(props: {
  title: JSX.Element;
  /** Islands and controls after the title; omit for a title-only header. */
  children?: JSX.Element;
}) {
  return (
    <ViewShell.TopBar class="gap-2 pr-4">
      {/* Reserve title width before actions; padding keeps focus rings unclipped. */}
      <div class="-m-1 min-w-0 flex-initial truncate p-1">{props.title}</div>
      <div class="-m-1 flex min-w-0 max-w-full flex-1 items-center justify-end-safe gap-2 overflow-x-auto p-1 [scrollbar-width:none]">
        {props.children}
      </div>
    </ViewShell.TopBar>
  );
}

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
};

/**
 * The query belongs to the view; only the expanded presentation is local.
 *
 * The field hands the keyboard to the results instead of trapping it:
 * ArrowDown or Enter moves to the first result, and Escape leaves the field
 * with the query and its results intact. Escape pressed again, in the list,
 * clears the search.
 */
export function ListHeaderSearch(props: {
  label: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Moves keyboard focus into the view's result list. */
  focusResults?: () => void;
  registerFocus: (focus: () => void) => void;
  /**
   * The open field takes the rest of the header, and closes again when it is
   * left empty. The view hides its other header actions while it is open.
   */
  wide?: boolean;
  onOpenChange?: (open: boolean) => void;
  onFocusChange?: (focused: boolean) => void;
  suggestions?: ListSearchSuggestions;
  ref?: (element: HTMLDivElement) => void;
}) {
  const panel = useSplitPanel();
  const [expanded, setExpandedState] = createSignal(Boolean(props.value));
  const setExpanded = (open: boolean) => {
    if (open === expanded()) return;

    setExpandedState(open);
    props.onOpenChange?.(open);
  };
  let input: HTMLInputElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const focus = () => {
    setExpanded(true);
    queueMicrotask(() => {
      input?.focus();
      input?.select();
    });
  };
  const clear = () => {
    props.onValueChange('');
    setExpanded(false);
  };
  const close = () => {
    clear();
    trigger?.focus();
  };
  // Escape leaves the list where it was; ArrowDown and Enter start at the top.
  const leave = (row: 'first' | 'current') => {
    // An empty field has no search to keep on screen.
    const collapses = !props.value.trim();
    // Without a list to move to, a collapsed field hands focus to its button.
    const collapseToButton = () => {
      clear();
      queueMicrotask(() => trigger?.focus());
    };

    if (!props.focusResults) {
      input?.blur();
      if (collapses) collapseToButton();
      return;
    }

    props.focusResults();
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

    if (collapses) clear();
    // The list's own "go to first item" also scrolls that row into view.
    if (row !== 'first') return;
    const goToFirst = getActiveCommandByToken(TOKENS.entity.jump.home);
    if (goToFirst?.condition?.() ?? true) goToFirst?.keyDownHandler?.();
  };
  onMount(() => {
    props.registerFocus(focus);
    // A view restored with a search starts with its field open.
    if (expanded()) props.onOpenChange?.(true);
  });

  // Returns whether a suggestion took the key instead of the results.
  const moveInSuggestions = (event: KeyboardEvent) => {
    const suggestions = props.suggestions;
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
      suggestions.pick(active);
      leave('first');
      return true;
    }

    return false;
  };

  // Escape in the list steps back out of the search. The field has left the
  // header whenever a thread or other detail has replaced the list, so that
  // view's own Escape runs instead.
  if (panel) {
    const scopeId = panel.splitHotkeyScope;
    // A list that overrides the split's Escape clears the search through the
    // same registration, so the step exists whichever handler runs.
    onCleanup(
      registerListSearch(scopeId, {
        isActive: () => props.value.trim().length > 0,
        clear,
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

  return (
    <div
      ref={props.ref}
      class={cn(
        !expanded() && 'w-8 shrink-0',
        expanded() && !props.wide && 'w-56 max-w-[40cqw] min-w-24 shrink-0',
        expanded() && props.wide && 'min-w-24 flex-1'
      )}
    >
      <Show
        when={expanded()}
        fallback={
          <Button
            aria-label={props.label}
            tooltip={props.label}
            ref={trigger}
            variant="secondary"
            size="icon-md"
            aria-expanded="false"
            onClick={focus}
          >
            <SearchIcon class="size-4" />
          </Button>
        }
      >
        <SearchBar
          ref={input}
          size="sm"
          label={props.label}
          placeholder={props.placeholder ?? props.label}
          value={props.value}
          onValueChange={props.onValueChange}
          // The browser's own history popup would take ArrowDown and Enter.
          autocomplete="off"
          onClose={close}
          onKeyDown={(event) => {
            // A view without a keyboard list keeps the keys for the field.
            if (!props.focusResults) return;
            if (isComposing(event) || hasModifier(event)) return;
            if (moveInSuggestions(event)) {
              event.preventDefault();
              return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'Enter') return;

            event.preventDefault();
            leave('first');
          }}
          onFocus={() => props.onFocusChange?.(true)}
          onBlur={() => {
            props.onFocusChange?.(false);
            if (props.wide && !props.value.trim()) setExpanded(false);
          }}
          onEscape={() => leave('current')}
        />
      </Show>
    </div>
  );
}

// Safari reports the Enter that commits a composition as not composing; its
// key code still marks it.
function isComposing(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229;
}

function hasModifier(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}
