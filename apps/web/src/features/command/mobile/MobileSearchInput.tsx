import {
  useForegroundMobileView,
  useMobileNavNavigate,
} from '@components/app/mobile/use-mobile-nav';
import { usePreserveFocusOnButtonTaps } from '@core/mobile/usePreserveFocusOnButtonTaps';
import XIcon from '@phosphor/x.svg';
import { SearchState } from './mobileSearchState';

// The input lives in app chrome, outside result/category boundaries, and stays
// mounted throughout the session so switching categories preserves the keyboard.
export function MobileSearchInput() {
  let containerRef: HTMLDivElement | undefined;

  const foregroundView = useForegroundMobileView();
  const navigate = useMobileNavNavigate();

  // iOS ends the editing session (dropping the keyboard) while processing
  // button taps even when pointerdown is cancelled. This keeps the input
  // focused for taps on its own buttons and on [data-keep-keyboard] regions —
  // notably the category pills, so switching categories keeps the keyboard up.
  usePreserveFocusOnButtonTaps(() => containerRef);

  // The X explicitly ends search: close() resets
  // the query and unmounts the search row with its input (dropping the
  // keyboard). The Search view only exists for searching, so exiting from it
  // returns to the default view.
  const handleClear = () => {
    SearchState.close();
    if (foregroundView() === 'search') navigate('home');
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
        placeholder="Search…"
        value={SearchState.query()}
        // Blurring never ends the session — the keyboard drops but search
        // mode stays until the X is pressed or navigation covers this entry.
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
        }}
        onClick={handleClear}
      >
        <XIcon class="size-4" />
      </button>
    </div>
  );
}
