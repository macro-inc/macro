import { isTouchDevice } from '@core/mobile/isTouchDevice';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { Button, cn } from '@ui';
import {
  children,
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  type ListSearchSuggestions,
  useListSearchKeys,
} from './list-search-keys';
import { SearchBar } from './SearchBar';
import { ViewShell } from './ViewShell';

export function ListHeader(props: {
  title: JSX.Element;
  /** Islands and controls after the title; omit for a title-only header. */
  children?: JSX.Element;
  /** The row the actions sit in, for a view that makes room when they overflow it. */
  actionsRef?: (element: HTMLDivElement) => void;
}) {
  return (
    <ViewShell.TopBar class="gap-2 pr-4">
      {/* Reserve title width before actions; padding keeps focus rings unclipped. */}
      <div class="-m-1 min-w-0 flex-initial truncate p-1">{props.title}</div>
      <div
        ref={props.actionsRef}
        class="-m-1 flex min-w-0 max-w-full flex-1 items-center justify-end-safe gap-2 overflow-x-auto p-1 [scrollbar-width:none]"
      >
        {props.children}
      </div>
    </ViewShell.TopBar>
  );
}

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
  /**
   * Shown in the field before the text, such as the filter the search is
   * narrowed to. While it shows, an empty field stays open.
   */
  leading?: JSX.Element;
  /** Empties the field and whatever `leading` holds; defaults to the text. */
  onClear?: () => void;
  /** Runs before the field's own keys; `preventDefault` skips them. */
  onKeyDown?: (event: KeyboardEvent) => void;
  ref?: (element: HTMLDivElement) => void;
}) {
  const leading = children(() => props.leading);
  const hasContent = () => Boolean(props.value.trim() || leading());
  const [expanded, setExpandedState] = createSignal(hasContent());
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
    if (props.onClear) props.onClear();
    else props.onValueChange('');
    setExpanded(false);
  };
  const close = () => {
    clear();
    trigger?.focus();
  };
  const keys = useListSearchKeys({
    value: () => props.value,
    hasQuery: hasContent,
    clear,
    focusResults: () => props.focusResults,
    input: () => input,
    trigger: () => trigger,
    suggestions: () => props.suggestions,
  });
  onMount(() => {
    props.registerFocus(focus);
    // A view restored with a search starts with its field open.
    if (expanded()) props.onOpenChange?.(true);
  });
  // The view keeps its own copy of these; a field that unmounts while open
  // (a tab that cannot search, a thread over the list) must not leave it set.
  onCleanup(() => {
    props.onOpenChange?.(false);
    props.onFocusChange?.(false);
  });
  // A wide field hides the header's other actions, so it closes as soon as
  // the view clears its search from outside (a tab change) and nobody is
  // typing in it.
  createEffect(
    on(
      hasContent,
      (content) => {
        if (!props.wide || content) return;
        if (document.activeElement !== input) setExpanded(false);
      },
      { defer: true }
    )
  );

  return (
    <div
      ref={props.ref}
      class={cn(
        !expanded() && 'w-8 shrink-0 touch:w-10',
        expanded() && !props.wide && 'w-56 max-w-[40cqw] min-w-24',
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
            variant={isTouchDevice() ? 'ghost' : 'secondary'}
            size={isTouchDevice() ? 'icon-lg' : 'icon-md'}
            class="touch:island"
            aria-expanded="false"
            onClick={focus}
          >
            <SearchIcon class="size-4 touch:size-6" />
          </Button>
        }
      >
        <SearchBar
          ref={input}
          size="sm"
          class="touch:island touch:h-10"
          label={props.label}
          placeholder={props.placeholder ?? props.label}
          value={props.value}
          onValueChange={props.onValueChange}
          // The browser's own history popup would take ArrowDown and Enter.
          autocomplete="off"
          aria-controls={props.suggestions?.listId}
          aria-activedescendant={props.suggestions?.activeId?.()}
          leading={leading()}
          onClose={close}
          onKeyDown={(event) => {
            props.onKeyDown?.(event);
            if (!event.defaultPrevented) keys.onKeyDown(event);
          }}
          onFocus={() => props.onFocusChange?.(true)}
          onBlur={() => {
            props.onFocusChange?.(false);
            if (props.wide && !hasContent()) setExpanded(false);
          }}
          onEscape={keys.onEscape}
        />
      </Show>
    </div>
  );
}
