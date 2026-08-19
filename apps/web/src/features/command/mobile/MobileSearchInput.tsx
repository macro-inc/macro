import { openChatWithMessage } from '@app/features/chat/ChatWithAgentButton';
import { pressPulse } from '@components/app/mobile/pressPulse';
import {
  useForegroundMobileView,
  useMobileNavNavigate,
} from '@components/app/mobile/use-mobile-nav';
import { hapticImpact } from '@core/mobile/haptics';
import { usePreserveFocusOnButtonTaps } from '@core/mobile/usePreserveFocusOnButtonTaps';
import XIcon from '@phosphor/x.svg';
import { cn } from '@ui';
import { createEffect, on } from 'solid-js';
import { SearchState } from './mobileSearchState';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

// This component only writes the global session state. The active split's
// bridge effect (see soup-view-context) mirrors the session into its own
// search text — the input lives in the app chrome outside every split and
// stays mounted for the whole session, so switching scope views never
// remounts (and thereby blurs) it. It mounts and unmounts only with the
// session itself (see MobileDockRow's search layout).

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
 * (see MobileDockRow's search layout).
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
        hasQuery() ? 'bg-accent text-chrome' : 'text-ink-extra-muted'
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
  let containerRef: HTMLDivElement | undefined;

  const foregroundView = useForegroundMobileView();
  const navigate = useMobileNavNavigate();

  // iOS ends the editing session (dropping the keyboard) while processing
  // button taps even when pointerdown is cancelled. This keeps the input
  // focused for taps on its own buttons and on [data-keep-keyboard] regions —
  // notably the pill rows, so switching search scope keeps the keyboard up.
  usePreserveFocusOnButtonTaps(() => containerRef);

  const hasQuery = () => SearchState.query().trim().length > 0;

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

  // The X is how search mode ends (besides opening a result): close() resets
  // the query and unmounts the search row with its input (dropping the
  // keyboard). The All view only exists for searching, so exiting from it
  // returns to the default view.
  const handleClear = () => {
    SearchState.close();
    if (foregroundView() === 'search') navigate('inbox');
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
        type="text"
        enterkeyhint="search"
        class="h-full min-w-0 flex-1 border-0 bg-transparent text-ink outline-none ring-0 placeholder:text-ink-placeholder focus:outline-none focus:ring-0"
        placeholder="Search or ask AI..."
        value={SearchState.query()}
        onFocus={() => {
          if (!SearchState.isOpen()) SearchState.open();
          // With nothing typed a search starts from the everything ("All")
          // view; an existing term keeps its current scope.
          if (!hasQuery() && foregroundView() !== 'search') navigate('search');
        }}
        // Blurring never ends the session — the keyboard drops but search
        // mode stays until the X is pressed (or a result opens).
        onInput={(e) => SearchState.setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Enter (the keyboard's Search key) drops the keyboard; the view is
          // already live-filtering. Not while an IME composition is being
          // confirmed.
          if (e.key !== 'Enter' || e.isComposing) return;
          e.currentTarget.blur();
        }}
      />
      {/* The input only mounts while a session is open, so the X is always
          available as the exit. */}
      <button
        type="button"
        class="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted"
        aria-label="Close search"
        onPointerDown={(e) => {
          e.preventDefault();
          hapticImpact('light');
        }}
        onClick={handleClear}
      >
        <XIcon class="size-4" />
      </button>
    </div>
  );
}
