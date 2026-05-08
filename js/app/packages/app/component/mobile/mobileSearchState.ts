import type { CommandWithInfo } from '@core/hotkey/getCommands';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { type Accessor, createSignal, type Setter } from 'solid-js';
import type { CategoryFilter } from '../command/types';

/** timestamp threshold for resetting state after menu close */
const STATE_RESET_THRESHOLD_MS = 2_000;

export interface ICommandState {
  /** visibility */
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
  toggle: () => void;
  open: () => void;
  close: () => void;

  /** query */
  query: Accessor<string>;
  setQuery: Setter<string>;
  clearQuery: () => void;

  /** category filter */
  categoryFilter: Accessor<CategoryFilter>;
  setCategoryFilter: Setter<CategoryFilter>;
  resetCategoryFilter: () => void;

  /** command scope (for multi-stage commands) */
  commandScopeCommands: Accessor<CommandWithInfo[]>;
  setCommandScopeCommands: Setter<CommandWithInfo[]>;
  clearCommandScopeCommands: () => void;
  isInCommandScope: Accessor<boolean>;

  /** full text search mode */
  isFullTextMode: Accessor<boolean>;
  enableFullTextMode: () => void;
  disableFullTextMode: () => void;

  /** lifecycle */
  maybeResetState: () => void;
  forceReset: () => void;
  onMenuClose: () => void;
  onMenuOpen: () => void;
}

function createSearchState(): ICommandState {
  const [isOpen, setIsOpen] = createControlledOpenSignal(false, {
    id: 'command',
  });
  const [query, setQuery] = createSignal('');
  const [categoryFilter, setCategoryFilter] =
    createSignal<CategoryFilter>('all');
  const [lastClosedTime, setLastClosedTime] = createSignal(0);
  const [commandScopeCommands, setCommandScopeCommands] = createSignal<
    CommandWithInfo[]
  >([]);
  const [isFullTextMode, setIsFullTextMode] = createSignal(false);

  function toggle() {
    setIsOpen((prev) => !prev);
  }

  function open() {
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
  }

  function clearQuery() {
    setQuery('');
  }

  function resetCategoryFilter() {
    setCategoryFilter('all');
  }

  function clearCommandScopeCommands() {
    setCommandScopeCommands([]);
  }

  function enableFullTextMode() {
    setIsFullTextMode(true);
  }

  function disableFullTextMode() {
    setIsFullTextMode(false);
  }

  function isInCommandScope() {
    return commandScopeCommands().length > 0;
  }

  function maybeResetState() {
    const now = Date.now();
    if (now - lastClosedTime() >= STATE_RESET_THRESHOLD_MS) {
      forceReset();
    }
  }

  function forceReset() {
    clearQuery();
    resetCategoryFilter();
    clearCommandScopeCommands();
    disableFullTextMode();
    setIsFullTextMode(false);
  }

  function onMenuClose() {
    setLastClosedTime(Date.now());
    clearCommandScopeCommands();
    disableFullTextMode();
  }

  function onMenuOpen() {
    clearQuery();
    setIsFullTextMode(false);
  }

  return {
    isOpen,
    setIsOpen,
    toggle,
    open,
    close,

    query,
    setQuery,
    clearQuery,

    categoryFilter,
    setCategoryFilter,
    resetCategoryFilter,

    commandScopeCommands,
    setCommandScopeCommands,
    clearCommandScopeCommands,
    isInCommandScope,

    isFullTextMode,
    enableFullTextMode,
    disableFullTextMode,

    maybeResetState,
    forceReset,
    onMenuClose,
    onMenuOpen,
  };
}

/** Global command menu state singleton */
export const SearchState = createSearchState();
