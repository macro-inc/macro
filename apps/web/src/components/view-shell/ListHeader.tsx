import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { registerHotkey } from '@core/hotkey/hotkeys';
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

/** Where the keyboard lands when the search field hands it to the results. */
export type ListSearchResultsRow = 'first' | 'current';

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
  focusResults?: (row: ListSearchResultsRow) => void;
  registerFocus: (focus: () => void) => void;
  ref?: (element: HTMLDivElement) => void;
}) {
  const panel = useSplitPanel();
  const [expanded, setExpanded] = createSignal(Boolean(props.value));
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
  const leave = (row: ListSearchResultsRow) => {
    // An empty field has no search to keep on screen.
    const collapses = !props.value.trim();
    if (collapses) clear();

    input?.blur();
    if (props.focusResults) {
      props.focusResults(row);
      return;
    }

    // Without a list to move to, a collapsed field hands focus to its button.
    if (collapses) queueMicrotask(() => trigger?.focus());
  };
  onMount(() => props.registerFocus(focus));

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
      class={cn('shrink-0', expanded() ? 'w-56 max-w-[40cqw] min-w-24' : 'w-8')}
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
          onClose={close}
          onKeyDown={(event) => {
            // A view without a keyboard list keeps the keys for the field.
            if (!props.focusResults) return;
            if (event.key !== 'ArrowDown' && event.key !== 'Enter') return;
            if (isComposing(event) || hasModifier(event)) return;

            event.preventDefault();
            leave('first');
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
