import { openChatWithMessage } from '@app/features/chat/ChatWithAgentButton';
import { useForegroundMobileView } from '@components/app/mobile/mobile-nav-state';
import { pressPulse } from '@components/app/mobile/pressPulse';
import { hapticImpact } from '@core/mobile/haptics';
import { usePreserveFocusOnButtonTaps } from '@core/mobile/usePreserveFocusOnButtonTaps';
import XIcon from '@phosphor/x.svg';
import { cn } from '@ui';
import { createEffect, on, Show } from 'solid-js';
import { SearchState } from './mobileSearchState';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

// This component only writes the global session state. The active split's
// bridge effect (see soup-view-context) mirrors the session into its own
// search text — the input mounts once in the stable app chrome, outside
// every split, so navigation never remounts (and thereby blurs) it.

/**
 * Sends the current query to a new AI chat and ends the search session.
 * Same wiring as the desktop command menu's "Ask AI about" row.
 */
function submitAskAi() {
  const query = SearchState.query().trim();
  if (!query) return;
  openChatWithMessage(query);
  SearchState.close();
}

/**
 * "Ask AI" island shown beside the search input while a session is active
 * (it takes the Create button's slot — see MobileSearchRow).
 */
export function MobileAskAiButton() {
  const hasQuery = () => SearchState.query().trim().length > 0;

  return (
    <button
      type="button"
      use:pressPulse
      // Tapping it must not drop the keyboard before the action runs.
      data-keep-keyboard
      class={cn(
        'island pointer-events-auto flex h-11 shrink-0 items-center rounded-full px-3 text-xs font-medium',
        hasQuery() ? 'text-ink' : 'text-ink-extra-muted'
      )}
      onPointerDown={(e) => {
        // Keep the input focused while tapping.
        e.preventDefault();
        hapticImpact('light');
      }}
      onClick={() => submitAskAi()}
    >
      Ask AI
    </button>
  );
}

/**
 * The dock search bar ("Search or ask AI..."). Focusing it opens the search
 * session while the current view stays visible; a typed term feeds the
 * selected view's own soup search directly.
 */
export function MobileSearchInput() {
  let inputRef: HTMLInputElement | undefined;
  let containerRef: HTMLDivElement | undefined;

  const foregroundView = useForegroundMobileView();

  // iOS ends the editing session (dropping the keyboard) while processing
  // button taps even when pointerdown is cancelled. This keeps the input
  // focused for taps on its own buttons and on [data-keep-keyboard] regions —
  // notably the pill rows, so switching search scope keeps the keyboard up.
  usePreserveFocusOnButtonTaps(() => containerRef);

  const hasQuery = () => SearchState.query().trim().length > 0;

  // External closes (result taps, back navigation) drop the keyboard too.
  createEffect(() => {
    if (!SearchState.isOpen() && document.activeElement === inputRef) {
      inputRef?.blur();
    }
  });

  // Opening an entity ends the session (and with it the view's search
  // filter). Pill navigation between views keeps it —
  // and a session started while an entity is already foregrounded stays too
  // (both sides undefined).
  createEffect(
    on(foregroundView, (view, prevView) => {
      if (!SearchState.isOpen()) return;
      if (prevView !== undefined && view === undefined) SearchState.close();
    })
  );

  const handleClear = () => {
    if (hasQuery()) {
      SearchState.setQuery('');
      inputRef?.focus();
    } else {
      SearchState.close();
    }
  };

  return (
    <div
      ref={(el) => {
        containerRef = el;
      }}
      class="island pointer-events-auto flex h-11 min-w-0 flex-1 items-center gap-1 rounded-full pr-1 pl-4"
    >
      <input
        id="mobile-search-input"
        ref={(el) => {
          inputRef = el;
        }}
        type="text"
        enterkeyhint="search"
        class="h-full min-w-0 flex-1 border-0 bg-transparent text-ink outline-none ring-0 placeholder:text-ink-placeholder focus:outline-none focus:ring-0"
        placeholder="Search or ask AI..."
        value={SearchState.query()}
        onFocus={() => {
          if (!SearchState.isOpen()) SearchState.open();
        }}
        onBlur={() => {
          // Dismissing the keyboard with nothing typed ends the session; with
          // a query it stays so the scoped results remain browsable.
          if (SearchState.isOpen() && !hasQuery()) SearchState.close();
        }}
        onInput={(e) => SearchState.setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Enter (the keyboard's Search key) drops the keyboard; the view is
          // already live-filtering. Not while an IME composition is being
          // confirmed.
          if (e.key !== 'Enter' || e.isComposing) return;
          e.currentTarget.blur();
        }}
      />
      <Show when={SearchState.isOpen() || hasQuery()}>
        <button
          type="button"
          class="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted"
          aria-label={hasQuery() ? 'Clear search' : 'Close search'}
          onPointerDown={(e) => {
            e.preventDefault();
            hapticImpact('light');
          }}
          onClick={handleClear}
        >
          <XIcon class="size-4" />
        </button>
      </Show>
    </div>
  );
}
