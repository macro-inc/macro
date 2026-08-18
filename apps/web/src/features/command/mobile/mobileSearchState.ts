import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { type Accessor, batch, createSignal } from 'solid-js';

interface IMobileSearchState {
  /**
   * Whether a search session is active: the dock input is focused, or the
   * user is browsing scoped results with the keyboard dismissed.
   */
  isOpen: Accessor<boolean>;
  open: () => void;
  close: () => void;

  /** query (the dock input's live value) */
  query: Accessor<string>;
  setQuery: (value: string) => void;
}

function createMobileSearchState(): IMobileSearchState {
  const [isOpen, setIsOpen] = createControlledOpenSignal(false, {
    id: 'command',
  });
  const [query, setQuery] = createSignal('');

  function open() {
    setIsOpen(true);
  }

  /**
   * Ends and resets the session. Passes `shouldReturnFocus: false` — the
   * session opened from the input's own focus, so returning focus would
   * re-raise the keyboard.
   */
  function close() {
    batch(() => {
      setIsOpen(false, false);
      setQuery('');
    });
  }

  return {
    isOpen,
    open,
    close,

    query,
    setQuery,
  };
}

/**
 * Global mobile search session singleton — the dock input whose query feeds
 * the active view's own soup search.
 */
export const SearchState = createMobileSearchState();
